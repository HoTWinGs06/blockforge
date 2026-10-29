#!/usr/bin/env python3
"""
BlockForge fleet leader - the supervisor's tool.

The leader is a hermes agent, not a script. This script is the tool the leader
calls to answer the three questions it has to answer on every pass:

  roster   - who is in the fleet, what each one is working on, is it alive
  status   - the whole fleet in one screen
  offer    - hand the NEXT task for a role to a named worker (one at a time)
  verify   - did a task actually land? (SHA on the integrated branch?)

WHY THE BOARD IS THE HANDOVER
------------------------------
The workers run in terminals on the operator's laptop, but their EXECUTION
happens on the Linux host, and they cannot see each other's screens. The
board is the only channel every one of them can read and write. So the
handover is: the leader publishes a task with a note "assigned: <worker>",
and the worker, when it finishes what it has, looks for that note.

The rules that keep it sane:
  - ONE task in flight per worker
  - ONE task offered per role at a time
  - a task is offered only if it is todo, and only if its role has no
    task already in flight
  - nothing is offered while the host is too busy to run another agent
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

HOME = Path.home()
FLEET = HOME / ".hermes" / "fleet"
AGENTS = FLEET / "agents.json"
BOARD = HOME / "workspace" / "agent-queue" / "board.py"
AGENT_DIR = HOME / "workspace" / "agent-queue"
REPO = HOME / "workspace" / "blockforge"
INTEGRATED = "feature/integrated/m1"

ROLES = ("engine", "gameplay", "netcode", "redteam", "release", "renderui", "testauthor")


def run(cmd, cwd=None, timeout=120):
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as exc:  # noqa: BLE001 - the leader must never crash
        return 1, f"{type(exc).__name__}: {exc}"


def board(*args):
    return run([sys.executable, str(BOARD), *args], cwd=str(AGENT_DIR))


def parse_tasks():
    """Read the board's tasks.md into a list of dicts."""
    rc, out = board("status")
    tasks = []
    path = AGENT_DIR / "tasks.md"
    if not path.exists():
        return tasks
    text = path.read_text(encoding="utf-8")
    for block in re.split(r"^### ", text, flags=re.M)[1:]:
        head = block.split("\n", 1)[0]
        tid = head.split(" ")[0].strip()
        title = head.split("—", 1)[-1].strip() if "—" in head else head
        st = re.search(r"- status: (\S+)", block)
        ow = re.search(r"- owner: (\S+)", block)
        notes = re.findall(r"- note: (.*)", block)
        tasks.append({
            "id": tid,
            "title": title,
            "status": st.group(1) if st else "?",
            "owner": ow.group(1) if ow else "-",
            "notes": notes,
        })
    return tasks


def assigned_to(task):
    """The worker a task has been offered to, if any."""
    for note in task["notes"]:
        m = re.search(r"assigned:\s*([A-Za-z0-9_.-]+)", note)
        if m:
            return m.group(1)
    return None


def sha_from_notes(task):
    """The commit SHA an agent reported, if it reported one."""
    for note in task["notes"]:
        m = re.search(r"\b([0-9a-f]{7,40})\b", note)
        if m:
            return m.group(1)
    return None


def load_agents():
    if not AGENTS.exists():
        return {}
    try:
        return json.loads(AGENTS.read_text(encoding="utf-8"))
    except Exception:
        return {}


def pid_alive(pid):
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except Exception:
        return False


def worktree_head(worktree):
    if not worktree:
        return None
    rc, out = run(["git", "-C", worktree, "log", "--oneline", "-1"], timeout=60)
    return out.strip() if rc == 0 else None


def host_load():
    rc, out = run(["uptime"], timeout=30)
    m = re.search(r"load average: ([0-9.]+)", out)
    return float(m.group(1)) if m else 0.0


def cmd_roster(args):
    agents = load_agents()
    tasks = {t["id"]: t for t in parse_tasks()}
    print(f"{'WORKER':<16} {'ROLE':<12} {'TASK':<6} {'STATE':<10} {'ALIVE':<6} WORKTREE HEAD")
    print("-" * 100)
    for name, info in sorted(agents.items()):
        tid = info.get("task")
        task = tasks.get(tid) if tid else None
        state = task["status"] if task else "-"
        pid = info.get("pid")
        alive = "?" if not pid else ("yes" if pid_alive(pid) else "no")
        head = worktree_head(info.get("worktree")) or "-"
        print(f"{name:<16} {info.get('role',''):<12} {(tid or '-'):<6} {state:<10} {alive:<6} {head}")
        if task:
            print(f"    task: {task['title'][:88]}")
            if task["notes"]:
                print(f"    last note: {task['notes'][-1][:150]}")
    return 0


def cmd_status(args):
    tasks = parse_tasks()
    by_role = {}
    for t in tasks:
        by_role.setdefault(t["owner"], []).append(t)
    print(f"HOST: load {host_load():.2f}   (the fleet pauses above ~4 on 2 cpus)\n")
    print("OPEN WORK BY ROLE")
    for role in ROLES + ("opencode",):
        open_t = [t for t in by_role.get(role, []) if t["status"] in ("todo", "doing")]
        if not open_t:
            continue
        print(f"  [{role}]")
        for t in open_t:
            who = assigned_to(t) or "-"
            print(f"    {t['id']:<6} {t['status']:<6} assigned={who:<16} {t['title'][:70]}")
    print("\nIN FLIGHT")
    for t in tasks:
        if t["status"] == "doing":
            who = assigned_to(t) or t["owner"]
            print(f"  {t['id']:<6} {who:<16} {t['title'][:70]}")
    print("\nBLOCKED (a human or the architect must look at these)")
    for t in tasks:
        if t["status"] == "blocked":
            print(f"  {t['id']:<6} {t['owner']:<12} {t['title'][:70]}")
    return 0


def cmd_offer(args):
    """Offer the next task for a role to a named worker. ONE at a time."""
    role = args.role
    worker = args.agent
    tasks = parse_tasks()
    agents = load_agents()

    # Is this worker already busy?
    for t in tasks:
        if assigned_to(t) == worker and t["status"] in ("todo", "doing"):
            print(f"REFUSED: {worker} already holds {t['id']} ({t['status']}). "
                  f"One task per worker - verify {t['id']} first.")
            return 1

    # Is the role already in flight?
    for t in tasks:
        if t["owner"] == role and t["status"] == "doing":
            print(f"REFUSED: role {role} is already in flight on {t['id']}.")
            return 1

    roles = ROLES + ("opencode",) if role == "any" else (role,)
    candidates = [
        t for t in tasks
        if t["owner"] in roles and t["status"] == "todo" and not assigned_to(t)
    ]
    # Never offer a task whose role is already being worked on.
    busy_roles = {t["owner"] for t in tasks if t["status"] == "doing"}
    candidates = [t for t in candidates if t["owner"] not in busy_roles]
    if not candidates:
        print(f"NOTHING TO OFFER: no unassigned todo task for role {role}.")
        return 1
    # A task may carry a note "priority: N" (lower is sooner). Without one,
    # the task id decides.
    def rank(task):
        for note in task["notes"]:
            m = re.search(r"priority:\s*(\d+)", note)
            if m:
                return (int(m.group(1)), task["id"])
        return (99, task["id"])
    candidates.sort(key=rank)
    task = candidates[0]

    rc, out = board("update", task["id"], "--owner", task["owner"], "--status", "todo",
                    "--notes", f"assigned: {worker}")
    print(out.strip())
    print(f"\nOFFERED {task['id']} (role {task['owner']}) to {worker}: {task['title']}")
    print("The worker picks it up by reading the board for a note 'assigned: <its name>'.")
    return 0


def cmd_verify(args):
    """Did a task actually land? The SHA must be on the integrated branch."""
    tid = args.task
    tasks = {t["id"]: t for t in parse_tasks()}
    task = tasks.get(tid)
    if not task:
        print(f"NO SUCH TASK: {tid}")
        return 1
    print(f"{tid}  status={task['status']}  owner={task['owner']}")
    print(f"  {task['title']}")
    sha = sha_from_notes(task)
    if not sha:
        print("  NO SHA REPORTED - the agent did not report one, so this has NOT landed.")
        return 1
    rc, out = run(["git", "-C", str(REPO), "branch", "--contains", sha, "--list", INTEGRATED])
    if INTEGRATED in (out or ""):
        print(f"  LANDED: {sha} is on {INTEGRATED}")
        return 0
    rc2, out2 = run(["git", "-C", str(REPO), "cat-file", "-t", sha])
    if rc2 != 0:
        print(f"  NOT LANDED: {sha} is not even a commit in this repo.")
        return 1
    print(f"  NOT LANDED: {sha} exists but is NOT on {INTEGRATED}. It needs a reap.")
    return 1


def cmd_note(args):
    rc, out = board("note", args.task, "--owner", args.owner, "--notes", args.text)
    print(out.strip())
    return rc


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1]
    rest = sys.argv[2:]
    if cmd == "roster":
        return cmd_roster(rest)
    if cmd == "status":
        return cmd_status(rest)
    if cmd == "offer":
        class A:
            role = rest[0]
            agent = rest[1]
        return cmd_offer(A)
    if cmd == "verify":
        class A:
            task = rest[0]
        return cmd_verify(A)
    if cmd == "note":
        class A:
            task = rest[0]
            owner = rest[1]
            text = " ".join(rest[2:])
        return cmd_note(A)
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
