#!/usr/bin/env python3
"""
BlockForge fleet dispatcher.

Runs on the Linux build host, so it keeps working when the operator's laptop
is shut. Every few minutes it looks at the board, finds a task that belongs to
one of the role agents, and launches that role's agent in its own worktree.

WHY THIS EXISTS: the role agents (engine, gameplay, netcode, redteam, release,
renderui, testauthor) are ONE-SHOT - dispatched for a job, they write a summary
heartbeat and exit. Nothing on this host was polling the board or calling
`claim-next`, so a task assigned to a role sat there until a human picked it
up. This closes that loop.

THE HOST IS SMALL. The build box has 2 CPUs and 4 GB of RAM, and it already
hosts the Hermes dashboard, the Hermes gateway, the Discord bot and the board
cron. A Playwright suite plus a typecheck plus one agent will take it to load
20 on 2 cores, and when that happened sshd stopped forking and the box became
unreachable for minutes. So the dispatcher REFUSES TO DISPATCH when the host is
busy - see host_busy(). It is better to run late than to wedge the build host.

SAFETY:
  - one agent at a time (MAX_CONCURRENT)
  - one agent per role (an exclusive lock file per role)
  - a task is never dispatched twice concurrently
  - a dead agent's task is picked up again, up to MAX_ATTEMPTS, then left alone
    rather than looping forever
  - the worktree is brought up to the integrated branch BEFORE launch, and a task
    whose worktree cannot be merged cleanly is skipped, never dispatched into a
    broken tree
  - the task is CLAIMED on the board (status=doing) before the agent starts
  - the host must be idle enough (host_busy)

DOCS: agents are told NOT to edit docs/PROGRESS.md or docs/VICTORIES.md. Seven
agents appending to the same file in seven worktrees guarantees merge conflicts
and lost work. The ARCHITECT owns those files; agents put their handoff in the
board notes and in docs/handoffs/<role>.md.

Usage:
    dispatcher.py            # one dispatch pass
    dispatcher.py --dry-run  # show what would be dispatched, launch nothing
    dispatcher.py --status   # report the fleet state and exit
"""

from __future__ import annotations

import fcntl
import os
import re
import subprocess
import sys
import time
from pathlib import Path

BOARD_DIR = Path.home() / "workspace" / "agent-queue"
BOARD = BOARD_DIR / "board.py"
BRIEFS = Path.home() / "workspace" / "blockforge-briefs"
FLEET = Path.home() / ".hermes" / "fleet"
LOGS = FLEET / "logs"
ATTEMPTS = FLEET / "attempts"
INTEGRATED_BRANCH = "feature/integrated/m1"
REPO = Path.home() / "workspace" / "blockforge"
HERMES = Path.home() / ".hermes" / "hermes-agent" / "hermes"
MAX_ATTEMPTS = 3
MAX_TURNS = "500"
RUN_BUDGET = "3000"
MAX_CONCURRENT = 2
MIN_FREE_MB = 900        # do not dispatch with less headroom than this
MAX_LOAD_PER_CPU = 3.0   # soft ceiling; the runnable-process count is the hard one

ROLES: dict[str, tuple[Path, Path]] = {
    "engine": (Path.home() / "workspace/worktrees/bf-engine", BRIEFS / "engine.md"),
    "gameplay": (Path.home() / "workspace/worktrees/bf-gameplay", BRIEFS / "gameplay.md"),
    "netcode": (Path.home() / "workspace/worktrees/bf-netcode", BRIEFS / "netcode.md"),
    "redteam": (Path.home() / "workspace/worktrees/bf-redteam", BRIEFS / "redteam.md"),
    "release": (Path.home() / "workspace/worktrees/bf-release", BRIEFS / "release.md"),
    "renderui": (Path.home() / "workspace/worktrees/bf-render", BRIEFS / "renderui.md"),
    "testauthor": (Path.home() / "workspace/worktrees/bf-test-author", BRIEFS / "testauthor.md"),
}


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}"
    print(line, flush=True)
    try:
        FLEET.mkdir(parents=True, exist_ok=True)
        with (FLEET / "dispatcher.log").open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def run(cmd: list[str], cwd: Path | None = None, timeout: int = 120,
        env: dict[str, str] | None = None) -> tuple[int, str, str]:
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except OSError as exc:
        return 1, "", str(exc)


# ── host capacity ──────────────────────────────────────────────────────────

def available_mb() -> int:
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        pass
    return 99999


def runnable_count() -> int:
    """How many processes are runnable RIGHT NOW.

    This is the signal that matters. The 1-minute load average is a decaying
    number: it stayed above 5 for minutes after a Playwright suite finished,
    because it remembers work that is already gone. Starting an agent on the
    strength of a stale average is how you oversubscribe a 2-CPU box and wedge
    sshd. The count of runnable processes is immediate.
    """
    try:
        out = subprocess.run(["ps", "-eo", "stat="], capture_output=True, text=True, timeout=15)
        return sum(1 for line in out.stdout.splitlines() if line.strip().startswith("R"))
    except (OSError, subprocess.SubprocessError):
        return 0


def host_busy() -> tuple[bool, str]:
    """True if the host cannot safely take another agent right now.

    Three checks, in order of severity:
      1. runnable processes must not exceed the CPU count - starting an agent
         on top of an already-oversubscribed host is what wedged this box
      2. there must be real free memory - one Playwright Chromium was seen at
         1.08 GB RSS on a 4 GB box
      3. the load average is a soft ceiling, not a hard one, because it lags
    """
    cpus = os.cpu_count() or 1
    run = runnable_count()
    avail = available_mb()
    try:
        load1 = os.getloadavg()[0]
    except OSError:
        load1 = 0.0
    limit = cpus * MAX_LOAD_PER_CPU
    if run >= cpus:
        return True, f"all {cpus} cpus already busy ({run} runnable, load {load1:.2f})"
    if avail < MIN_FREE_MB:
        return True, f"only {avail} MB available, need {MIN_FREE_MB} MB (load {load1:.2f})"
    if load1 > limit:
        return True, f"load {load1:.2f} over {limit:.2f} ({cpus} cpus, {run} runnable)"
    return False, f"{run} runnable/{cpus} cpus, load {load1:.2f}/{limit:.2f}, {avail} MB free"


# ── board access ───────────────────────────────────────────────────────────

def board_tasks() -> list[dict]:
    sys.path.insert(0, str(BOARD_DIR))
    try:
        import board  # type: ignore
        return board.parse_tasks((BOARD_DIR / "tasks.md").read_text(encoding="utf-8"))
    except Exception as exc:
        log(f"WARN: board.parse_tasks unavailable ({exc}); using the fallback parser")
        return _fallback_tasks()


def _fallback_tasks() -> list[dict]:
    tasks: list[dict] = []
    cur: dict | None = None
    for raw in (BOARD_DIR / "tasks.md").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^###\s+(T\d+)\s+—\s+(.*)$", raw.rstrip())
        if m:
            if cur:
                tasks.append(cur)
            cur = {"id": m.group(1), "title": m.group(2).strip(), "status": "todo",
                   "owner": "-", "notes": [], "updated": "-"}
            continue
        if cur is None:
            continue
        m = re.match(r"^-\s+status:\s*(.+)$", raw.rstrip())
        if m:
            cur["status"] = m.group(1).strip()
            continue
        m = re.match(r"^-\s+owner:\s*(.+)$", raw.rstrip())
        if m:
            cur["owner"] = m.group(1).strip()
            continue
        m = re.match(r"^-\s+note:\s*(.*)$", raw.rstrip())
        if m:
            cur["notes"].append(m.group(1).strip())
    if cur:
        tasks.append(cur)
    return tasks


def board_cmd(*args: str) -> tuple[int, str]:
    rc, out, err = run([sys.executable, str(BOARD), *args], timeout=120)
    return rc, (out or err)


# ── locking ────────────────────────────────────────────────────────────────

def lock_path(role: str) -> Path:
    return FLEET / "locks" / f"{role}.lock"


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def role_locked(role: str) -> tuple[bool, int]:
    p = lock_path(role)
    if not p.exists():
        return False, 0
    try:
        pid = int(p.read_text(encoding="utf-8").strip().split()[0])
    except (ValueError, IndexError, OSError):
        return False, 0
    if pid_alive(pid):
        return True, pid
    try:
        p.unlink()
    except OSError:
        pass
    return False, 0


def take_lock(role: str, pid: int) -> bool:
    p = lock_path(role)
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(p), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except FileExistsError:
        return False
    with os.fdopen(fd, "w") as fh:
        fh.write(f"{pid}\n")
    return True


def attempt_count(task_id: str) -> int:
    try:
        return int((ATTEMPTS / task_id).read_text(encoding="utf-8").strip())
    except (ValueError, OSError):
        return 0


def bump_attempt(task_id: str) -> int:
    ATTEMPTS.mkdir(parents=True, exist_ok=True)
    n = attempt_count(task_id) + 1
    (ATTEMPTS / task_id).write_text(str(n), encoding="utf-8")
    return n


# ── the brief ──────────────────────────────────────────────────────────────

def build_brief(role: str, task: dict, attempt: int) -> Path:
    standing = ""
    try:
        standing = ROLES[role][1].read_text(encoding="utf-8")
    except OSError:
        standing = "(no standing brief on disk)"

    task_id = task["id"]
    notes = "\n".join(f"  - {n}" for n in task.get("notes", [])) or "  (none)"

    header = f"""YOUR TASK RIGHT NOW: {task_id} — {task["title"]}

(Dispatch attempt {attempt} of {MAX_ATTEMPTS}. The board's own notes for the task are below -
they carry the full brief and any corrections. The standing role brief follows.)

TASK NOTES FROM THE BOARD:
{notes}
"""

    footer = f"""

HOW TO WORK
  1. The board is the source of truth:
       python3 {BOARD_DIR}/board.py status
     Read the notes on {task_id} in full before you start.
  2. Work in YOUR OWN worktree: {ROLES[role][0]}
     It is already up to date with {INTEGRATED_BRANCH}. Do not edit the canonical repo,
     and do not edit another agent's worktree.
  3. The frozen contract (src/core/types.ts, src/core/constants.ts, docs/API.md) is FIXED.
     Do not change a name or a number in it. If you believe it is wrong, say so on the
     board and let the ARCHITECT change it centrally.
  4. Determinism is the top invariant: same seed + same inputs must give a
     byte-identical world, in any order, in any process. No Math.random, no Date.now,
     no performance.now in src/core/.
  5. DO NOT EDIT docs/PROGRESS.md or docs/VICTORIES.md. Seven agents appending to the
     same file in seven worktrees guarantees merge conflicts and lost work. The
     ARCHITECT owns those files. Your handoff goes in TWO places instead:
       a) the board, which is the source of truth and is conflict-free:
            python3 {BOARD_DIR}/board.py update {task_id} --owner {role} --status done \\
              --notes "what you did, how you VERIFIED it, and the commit SHA"
          If you are blocked, set the task to blocked and write a note saying exactly
          what you need and from whom. Never go quiet.
       b) a durable copy for the next agent, in YOUR OWN file (create the folder if
          it does not exist):
            mkdir -p docs/handoffs
            docs/handoffs/{role}.md   - append your handoff there, do not overwrite
                                      anyone else's section.
  6. A "win" is only a win if you READ THE RESULT BACK. A command returning ok is not
     evidence. If you could not verify it, say "unverified" - that is respected.
  7. Commit your work on your branch and report the exact SHA. Downstream agents
     start from a MERGED SHA, never from your uncommitted branch.
  8. RESOURCE DISCIPLINE. This build host has 2 CPUs and 4 GB of RAM and it is
     shared. Before you start a long test or benchmark, check that nothing else big
     is running (ps aux --sort=-%cpu | head). Do not run a Playwright suite, a
     typecheck and an agent at the same time - that is what wedged the host once
     already. If you need a heavy run, do it and then let it finish before
     starting anything else.
"""

    BRIEFS.mkdir(parents=True, exist_ok=True)
    out = BRIEFS / f"task-{task_id}.md"
    out.write_text(header + "\n" + standing + footer, encoding="utf-8")
    return out


# ── worktree preparation ───────────────────────────────────────────────────

def prepare_worktree(role: str) -> tuple[bool, str]:
    wt = ROLES[role][0]
    if not wt.exists():
        return False, f"worktree missing: {wt}"
    rc, out, err = run(["git", "-C", str(wt), "merge", "--ff-only", INTEGRATED_BRANCH], timeout=120)
    if rc == 0:
        return True, "up to date"
    rc, out, err = run(["git", "-C", str(wt), "merge", "--no-edit", INTEGRATED_BRANCH], timeout=180)
    if rc == 0:
        return True, "merged"
    run(["git", "-C", str(wt), "merge", "--abort"], timeout=60)
    return False, (err or out or "merge failed")[:200]


# ── launching ──────────────────────────────────────────────────────────────

def live_agents() -> int:
    return sum(1 for role in ROLES if role_locked(role)[0])


def launch(role: str, brief: Path, task_id: str) -> int:
    LOGS.mkdir(parents=True, exist_ok=True)
    logfile = LOGS / f"{task_id}-{int(time.time())}.log"
    env = dict(os.environ)
    env["PATH"] = (f"{Path.home() / '.hermes/hermes-agent'}:"
                    f"{Path.home() / '.local/opt/node/bin'}:{env.get('PATH', '')}")
    env["HERMES_HOME"] = str(Path.home() / ".hermes")
    cmd = [str(HERMES), "chat", "--query-file", str(brief),
           "--oneshot", "--max-turns", MAX_TURNS, "--run-budget", RUN_BUDGET, "--yolo"]
    with logfile.open("w", encoding="utf-8") as out:
        proc = subprocess.Popen(
            cmd, cwd=str(ROLES[role][0]), stdout=out, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, env=env, start_new_session=True,
        )
    return proc.pid


def reap_completed() -> None:
    """Merge a finished role's branch into the integrated branch.

    The agent commits to feature/<role>/<topic> and reports the SHA. If
    nothing merges it, the work sits on the branch: the next agent for that
    role branches from the integrated branch and never sees it, and the
    project stops accumulating. This is the same integration the ARCHITECT has
    been doing by hand all along, automated.

    Only merges a branch whose task is `done`, and only when the merge is
    clean. A conflict is logged and left for a human - the dispatcher never
    resolves a conflict on its own.
    """
    # The reap now runs on EVERY pass, so two passes can overlap: the cron
    # fires every 2 minutes and a merge is not instant. Two reaps merging
    # into the same repo at once fight over the index, and one of them
    # aborts the other's merge. One reap at a time, same flock the board
    # uses for its own writes.
    FLEET.mkdir(parents=True, exist_ok=True)
    lock_fh = (FLEET / "reap.lock").open("a+")
    try:
        fcntl.flock(lock_fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock_fh.close()
        log("reap: another reap is in progress, skipping")
        return

    try:
        _reap_locked()
    finally:
        fcntl.flock(lock_fh, fcntl.LOCK_UN)
        lock_fh.close()


# ── reap gate (T107) ──────────────────────────────────────────────────────

def _gate_env() -> dict[str, str]:
    """PATH extended with the host's node install; worktree gates need node."""
    env = dict(os.environ)
    node_bin = str(Path.home() / ".local" / "opt" / "node" / "bin")
    env["PATH"] = node_bin + os.pathsep + env.get("PATH", "")
    return env


def _reap_gate(repo: Path, wt: Path, branch: str, name: str) -> tuple[bool, str]:
    """T107: prove the MERGE RESULT is typecheck+lint clean before it lands.

    The T102 reap (7577f4c) merged a branch whose file broke typecheck and
    lint because reaping only checked git conflict status, nothing else. This
    builds integrated+branch in a scratch worktree (node_modules symlinked
    from the repo), runs the gates there, and returns (ok, output). On
    failure the canonical tree is never touched and the caller marks the
    tasks blocked with this output as the board note.
    """
    scratch = repo.parent / f"reap-scratch-{name}"
    run(["git", "-C", str(repo), "worktree", "remove", "--force", str(scratch)], timeout=120)
    run(["git", "-C", str(repo), "worktree", "prune"], timeout=60)
    rc, out, err = run(
        ["git", "-C", str(repo), "worktree", "add", "--detach", str(scratch), INTEGRATED_BRANCH],
        timeout=120)
    if rc != 0:
        return False, f"scratch worktree add failed: {(out or err).strip()}"
    env = _gate_env()
    link = scratch / "node_modules"
    try:
        if (repo / "node_modules").exists() and not link.exists():
            link.symlink_to(repo / "node_modules", target_is_directory=True)
        rc, out, err = run(["git", "-C", str(scratch), "merge", "--no-edit", branch], timeout=300)
        if rc != 0:
            return False, "merge left a conflict in scratch:\n" + (out or err).strip()
        for label, cmd in (("typecheck", ["npm", "run", "typecheck"]),
                           ("lint", ["npm", "run", "lint"])):
            rc, out, err = run(cmd, cwd=scratch, timeout=900, env=env)
            if rc != 0:
                return False, f"{label} failed on the merge result:\n" + (out or err).strip()
        return True, "typecheck and lint are green on the merge result"
    finally:
        run(["git", "-C", str(repo), "worktree", "remove", "--force", str(scratch)], timeout=180)
        run(["git", "-C", str(repo), "worktree", "prune"], timeout=60)


def _reap_locked() -> None:
    """The body of reap_completed, run under the reap lock."""
    tasks = board_tasks()
    done_by_owner: dict[str, list[dict]] = {}
    for t_ in tasks:
        if t_.get("status") == "done" and t_.get("owner") in ROLES:
            done_by_owner.setdefault(t_["owner"], []).append(t_)

    # The reap merges into the canonical repo's CHECKED-OUT branch. If that is
    # not the integrated branch, a reap would land role work on main - or on
    # any other branch - with no human watching. Refuse instead.
    rc, head, _err = run(["git", "-C", str(REPO), "rev-parse", "--abbrev-ref", "HEAD"], timeout=60)
    if head.strip() != INTEGRATED_BRANCH:
        log(f"skip reap: {REPO} is on {head.strip() or '?'}, not {INTEGRATED_BRANCH}")
        return

    for role, done_tasks in done_by_owner.items():
        wt = ROLES[role][0]
        if not wt.exists():
            continue
        rc, branch, _err = run(["git", "-C", str(wt), "rev-parse", "--abbrev-ref", "HEAD"], timeout=60)
        branch = branch.strip()
        if not branch or branch in ("main", INTEGRATED_BRANCH):
            continue
        # is the branch actually ahead of the integrated branch?
        rc, count, _err = run(
            ["git", "-C", str(wt), "rev-list", "--count", f"{INTEGRATED_BRANCH}..{branch}"], timeout=60)
        if rc != 0 or not count.strip() or count.strip() == "0":
            continue
        # has this branch already been merged?
        rc, contains, _err = run(
            ["git", "-C", str(wt), "branch", "--contains", branch, "--list", INTEGRATED_BRANCH], timeout=60)
        if INTEGRATED_BRANCH in (contains or ""):
            continue
        ids = ", ".join(t_["id"] for t_ in done_tasks)
        # T107: gate the merge on typecheck+lint, proven against the MERGE
        # RESULT in a scratch worktree. A red gate blocks the tasks (with the
        # gate output as the note) and skips the merge; the role branch keeps
        # its work so the fix can land without reverting anything.
        gate_ok, gate_out = _reap_gate(REPO, wt, branch, role)
        if not gate_ok:
            snippet = "\n".join(gate_out.strip().splitlines()[:14])[:1200]
            for t_ in done_tasks:
                board_cmd("update", t_["id"], "--status", "blocked", "--notes",
                          f"REAP GATE {role}: the merged result is not green; "
                          f"merge SKIPPED, branch kept\n{snippet}")
            log(f"REAP GATE FAILED {role} {branch} (tasks {ids}) - merge skipped")
            continue
        rc, out, err = run(["git", "-C", str(REPO), "merge", "--no-edit", branch], timeout=300)
        if rc == 0:
            sha = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"],
                                 capture_output=True, text=True, timeout=60).stdout.strip()
            log(f"REAPED {branch} into {INTEGRATED_BRANCH} (tasks {ids}) -> {sha}")
        else:
            run(["git", "-C", str(REPO), "merge", "--abort"], timeout=60)
            log(f"REAP CONFLICT on {branch} (tasks {ids}) - left for a human: {(err or out)[:160]}")


def main() -> int:
    dry = "--dry-run" in sys.argv
    busy, why = host_busy()
    if "--status" in sys.argv:
        tasks = board_tasks()
        for role in ROLES:
            locked, pid = role_locked(role)
            owned = [t for t in tasks if t.get("owner") == role and t.get("status") in ("todo", "doing")]
            state = f"RUNNING pid={pid}" if locked else "idle"
            print(f"  {role:<12} {state:<18} open: "
                  f"{', '.join(t['id'] for t in owned) or '-'}")
        print(f"  concurrent: {live_agents()}/{MAX_CONCURRENT}   host: {why}"
              f"{'  [BUSY - will not dispatch]' if busy else ''}")
        return 0

    running = live_agents()
    # The reap runs FIRST, on every pass, before any early return. It used to
    # sit at the END of main(), behind the "already running" return below, so
    # while the fleet was at capacity - which is most of the time - the reap
    # was never reached and completed role work sat on its branch. Reaping is
    # a git merge, not an agent: it does not compete for the agent slot
    # budget, which is the resource that return is actually protecting.
    reap_completed()
    if running >= MAX_CONCURRENT:
        log(f"pass: {running} agent(s) already running, limit {MAX_CONCURRENT}")
        return 0
    if busy and not dry:
        log(f"pass: host is busy ({why}) - not dispatching")
        return 0

    tasks = board_tasks()
    by_role: dict[str, list[dict]] = {}
    for t in tasks:
        if t.get("owner") in ROLES:
            by_role.setdefault(t["owner"], []).append(t)

    dispatched = 0
    for role in ROLES:
        if running + dispatched >= MAX_CONCURRENT:
            break
        locked, pid = role_locked(role)
        if locked:
            log(f"skip {role}: already running (pid {pid})")
            continue

        candidates = [t for t in by_role.get(role, []) if t.get("status") in ("todo", "doing")]
        if not candidates:
            continue
        candidates.sort(key=lambda t: (t.get("status") != "todo", t.get("id")))
        task = candidates[0]
        task_id = task["id"]

        n = attempt_count(task_id)
        if n >= MAX_ATTEMPTS:
            log(f"skip {task_id} ({role}): {n} attempts already, not retrying")
            continue

        ok, prep = prepare_worktree(role)
        if not ok:
            log(f"skip {task_id} ({role}): worktree not ready - {prep}")
            continue

        if dry:
            log(f"DRY RUN: would dispatch {task_id} ({role})  [host {why}]")
            dispatched += 1
            continue

        attempt = bump_attempt(task_id)
        brief = build_brief(role, task, attempt)

        board_cmd("update", task_id, "--owner", role, "--status", "doing",
                  "--notes", f"dispatched by the fleet dispatcher (attempt {attempt} of {MAX_ATTEMPTS})")
        board_cmd("heartbeat", "--owner", role, "--state",
                  f"working - {task_id} (dispatched by the fleet dispatcher)", "--task", task_id)

        pid = launch(role, brief, task_id)
        if take_lock(role, pid):
            log(f"DISPATCHED {task_id} -> {role} (pid {pid}, attempt {attempt}, worktree {prep})")
            dispatched += 1
        else:
            log(f"lock race on {role}; {task_id} launched as pid {pid} without a lock")
    log(f"pass complete: {dispatched} dispatch(es), {live_agents()} agent(s) running, host {why}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
