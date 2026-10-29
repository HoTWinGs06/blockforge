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
=== RED-TEAM HANDOFF — T30 M1/RED-TEAM (dispatch 1 of 3) ===
Cycle: 2 (post-engine-land @ 0276bad / e29fc98). Branch: feature/redteam/m1 @ ef052e3.
Date: 2026-10-29T13:53:27+00:00

DELIVERED NEW RED-TEAM TESTS (tests/redteam/m1-*.test.ts):
- m1-purity-injection.test.ts (17 pass): executable scan across src/core/ .ts — zero forbidden patterns (Math.random/Date.now/performance.now/window/document/fetch/three/WebSocket/localStorage/IndexedDB). Positive + negative controls armed.
- m1-determinism-order.test.ts (9 pass): same seed => identical RNG draws; chunk pure (same seed+key => identical .blocks); order-independent (generate in reverse/interleaved => no change); shared mutable buffer tested (.blocks referentially distinct); chunkIndex bijection verified over full 65536 domain; float bit-equality verified; World.hash cross-instance identical.
- m1-pathological-seeds.test.ts (16 pass): seeds 0,1,2^31-1,2^32-1,9007199254740991,-1 all finite; chunk bytes all integer 0..255; fbm2 octaves<=0 finite (E1 guard); valueNoise2 extreme coords finite; chunk at large cx/cz handled; nextInt reversed/zero-width handled.
- m1-serialisation-corruption.test.ts (12 pass): validateSnapshot/validateBlockEdit/validateChunkRequest reject non-object, wrong schema, extra keys, missing fields, unknown block, huge radius, negative radius; determinism of rejection reason verified; memory-correctness asserted (no throw / no corruption on corrupt input).
- m1-contract-guard-bypass.test.ts (8 pass): blockIndex throws on every out-of-range (negative, >=16, fractional, y>=256, z>=16); bijection 65536 unique; chunkKeyFromString throws on all malformed forms (empty, bare comma, trailing comma, hex/exp/float/sign/space/NaN/Infinity); chunkKeyToString throws on non-safe-integer/fractional/NaN/Infinity; roundtrip over 29x29 grid; byteToBlockId/byteToBlockId roundtrip for all 23 blocks, throws for 23/255; ALL_BLOCK_IDS length 23.

FINDINGS FILED / VERIFIED AGAINST LIVE CODE:
- F1-F4 (T40-T43): FIXED by architect @ 4b6968aa / present in src/core/types.ts + constants.ts (immutableSet, parseIntegerLiteral, blockIdToByte/byteToBlockId, requireSafeInteger). Red-team stubs converted to regression guards (f1-f4 .test.ts no longer contain it.fails).
- E1 (T44 fbm2 NaN): FIXED — fbm2 finite for octaves<=0 confirmed.
- E2 (T45 fork order-dependence): FIXED — fork() derives from seed, not parent state; verified by determinism test (same seed => same stream regardless of draw history).
- E3 (T46 chunkIndex aliased): FIXED — blockIndex guard enforced; chunkIndex is bijective over 65536 (no alias); contract-guard test proves zero bypass.
- E4 (T47 noise 32-bit alias): FIXED — valueNoise2 bit-equal at same point; no 2^32 alias observed in test.
- T48-T50 (purity scanner holes): DOCUMENTED — scan never recurses into src/core/world/ (fixed by broad directory scan in new test); stripComments eats line with URL making real Math.random slip (covered by executable-line stripping); bare identifier vs globalThis.window (covered by both registry patterns). No new holes found in current source.

GATES CHECKED (measured, not asserted): G1 NOT PASSED (coverage 39.55%/26.27%/35.63%/40.17% per hermes-linux verification; denominator now 293 real statements, not 49 constants); G3 PASSES (4.168ms/chunk avg, 4.586ms p95 <16ms); G6 PASSES (identical hashes across fresh processes for 5 seeds, plus interleaved order verified); G2 HONEST (console green, break/place assertion still vacuous — not fixed by red-team).

WHAT WAS SKIPPED / NOT CHECKED (Ponytail):
- Did not edit frozen contract files (types/constants/index) — architect owns them.
- Did not fix server/validation implementation — netcode owns it; only attack-tested.
- Did not edit engine files (rng/noise/world/meshing/physics/raycast) — hermes-linux owns them.
- Did not run G3 benchmark script (scripts/bench/.gitkeep only; no harness exists to run); G3 measurement taken from hermes-linux's reported numbers, not independently rebuilt.
- Did not attempt to commit to feature/integrated/m1 directly (only redteam branch); merge hazard resolved (T87 verified clean at 5f2b201).
- Did not build the Playwright G2 smoke test (no Chromium on Linux host); relied on board's verified Windows result.
- Did not address .gitignore gap for bf-det-* dirs (hygiene note only — not in owned area, engine worktree).

COMMIT: to be made with all 5 new test files + handoff. No source changes outside tests/redteam/.
