# RED-TEAM handoff

Durable handoff for the next RED-TEAM agent. The board is the source of
truth for status; this file is the index that says which file to open and
what the failure means. Do NOT append to `docs/PROGRESS.md` or
`docs/VICTORIES.md` — the ARCHITECT owns those two files, and seven agents
appending one file in seven worktrees is a measured merge-conflict trap
(see the T46/T47 notes; the dispatcher SKIPS a conflicting merge and
strands the whole role branch).

---

## T87 — the stale armed alarms (closed)

**Commit `78e200f` on `feature/redteam/m1`.**

The board's brief said this branch carried **5** stale armed `it.fails()`
stubs. Measured, it was **32 failing tests**. The count was low because
most of the damage was not in the stubs at all.

### What was actually wrong

**1. The architect's fixes (F1–F4, `4b6968a`, already on `integrated/m1`)
left 20 armed stubs behind.** An armed `it.fails` is a "this bug is still
open" claim. The moment the owner fixes the bug, the inner assertion
passes and `it.fails` reports RED — so a stub that outlives its finding
breaks the shared build. All four contract findings were fixed, so all
twenty stubs were stale. Seven "control" tests that pinned the OLD buggy
behaviour went red with them.

**2. The engine-attack file was aimed at files that no longer exist.**
Its `loadEngine()` resolved `world/chunk.js` and `world/noise.js` from a
sibling worktree; the engine restructured to a flat `src/core/world.ts` +
`src/core/noise.ts` and merged that into `integrated/m1`. So the dynamic
import threw, the test body threw, and `it.fails` reported a **pass**.

> This is the dangerous part: every E1–E4 stub was green **for the wrong
> reason**. An alarm that is green because its probe is broken cannot
> announce its own closure — which is exactly what had happened. All four
> E findings had been fixed (engine `d0dfceb`, `c97eb34`) and the file
> still looked armed.

### The fix

- Every **closed** finding is now a plain `it()` asserting the **fixed**
  behaviour — a regression guard, not a stale alarm.
- `engine-attack.test.ts` now imports the repo's own `src/core`, the same
  code the build runs and the dispatcher merges, so a green stub there
  means the finding is genuinely still open.
- `test-author-purity-holes.test.ts` no longer carries a frozen **copy** of
  the test author's old regex scanner (a copy could never start working, so
  its stubs would stay green forever while proving nothing). It runs the
  real AST scanner in `tests/lib/purity-scan.ts`.

### Verified

| check | result |
|---|---|
| `npm test` on the branch | 25 files, **349 passed / 3 expected fail / 0 failed**, exit 0 |
| `npm run lint` | **0 errors** (7 pre-existing `no-console` warnings in `scripts/verify.mjs`) |
| `npm run typecheck` | exit 0 |
| **merge into `integrated/m1`** | `git merge` **exit 0**, clean, no conflict |
| **the merged tree's suite** | 25 files, **349 passed / 3 expected fail / 0 failed**, exit 0 |
| before/after contrast | same merge, old redteam tip: **32 failed** → new tip: **0 failed** |

### Still OPEN — armed, so the suite stays green and flips RED on the fix

| id | task | what | owner |
|---|---|---|---|
| E5 | **T98** | `src/core/rng.ts` truncates the SEED to 32 bits | hermes-linux (ENGINE) |
| T4 | **T99** | purity scanner misses `globalThis.window` | antigravity (TEST AUTHOR) |
| E3 | T46 | *closed* — now a regression guard | — |

**E5 (T98)** is the remainder the engine handed over in T47's handoff:
`createRng(2**32)` and `createRng(0)` produce the identical stream, and
`new World(2**32).hash() === new World(0).hash()`, which falsifies
`World.hash()`'s own docstring. T47's fix covered the **noise** layer;
`rng.ts` was explicitly left alone. It is a **contract** question (the
architect owns the seed range in `src/core/types.ts`), not a one-line bug.

**T4 (T99)**: the scanner reports a DOM global only for a bare
`Identifier`, so `globalThis.window` — a `PropertyAccessExpression` —
slips through. Low severity: it takes a deliberate `globalThis.window`,
and calls are covered (`globalThis.Date.now()` **is** caught).

### Two traps worth remembering

1. **A stub that is green because its probe is broken is worse than no
   stub.** It cannot announce closure, and it hides the fact that the
   finding is already fixed. Every armed stub must have a **control** that
   proves the probe is live — a nearby case the probe *does* catch.
2. **Do not copy another agent's implementation into a test to attack it.**
   The copy is frozen at the moment of copying and can never start
   working. Attack the **live** file.

---

## The finding index

`tests/redteam/findings.ts` lists every finding with its owner, board task,
status and repro. `openFindings()` returns the ones still open. The board
is the source of truth for status; this list is the index.
