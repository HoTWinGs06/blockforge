# Engine handoff

ENGINE's own file. Appended to, never overwritten. The board is the source
of truth; this is the durable copy for the next agent.

---

## T46 — RED-TEAM E3: chunkIndex() bypassed the frozen blockIndex() guard

**Status:** DONE. Commit `d0dfceb` on `feature/engine/m1`.

### The hole

`src/core/world.ts` exported `chunkIndex(x, y, z)`, documented as *"without
the range check of `blockIndex`. Callers are responsible for the bounds; used
on hot paths."* It was exported, and an unchecked index that silently aliases
is worse than a throwing one:

| call | old result | what it was |
|---|---|---|
| `chunkIndex(16, 0, 0)` | `16` | the storage slot of block `(0, 0, 1)` — a DIFFERENT block |
| `chunkIndex(0, 256, 0)` | `65536` | one past the end of the Uint8Array, so a write there was silently dropped |
| `chunkIndex(-1, 0, 0)` | `-1` | a negative index, which typed arrays also silently ignore |

The frozen `blockIndex()` in `src/core/constants.ts` throws `RangeError` for
exactly these inputs, so the guard existed and worked — `chunkIndex` was the
unguarded variant that bypassed it. The live callers (`getBlock`, `setBlock`)
*did* bounds-check first, so the game was not currently corrupted; the hole
was that any future caller that forgot its own check would silently write
into a different block.

### The fix

`chunkIndex()` now delegates to the frozen `blockIndex()`, so the guard lives
in ONE place and an out-of-range coordinate throws `RangeError` instead of
aliasing. There is deliberately **no unchecked variant** — the hot-path
argument for one does not survive the fact that `getBlock`/`setBlock` are the
only callers and they already check.

`getBlock()`/`setBlock()` keep their tolerant surface (out of range reads
air, out of range writes are ignored). Their bounds check moved into a
private `isInsideChunk()` helper, which also rejects **fractional**
coordinates — the old check let `4.5` through to a fractional array index,
which always read as air, so the behaviour is unchanged but the reason is now
explicit rather than accidental.

### Verified

The verifier's ORIGINAL repro, re-run in a fresh process against the compiled
commit:

```
chunkIndex(16,0,0)   => THREW RangeError: blockIndex out of range: (16, 0, 0) for chunk 16x256x16
chunkIndex(0,256,0)  => THREW RangeError: blockIndex out of range: (0, 256, 0) for chunk 16x256x16
chunkIndex(-1,0,0)   => THREW RangeError: blockIndex out of range: (-1, 0, 0) for chunk 16x256x16
chunkIndex(1,2,3)    => 561   (== blockIndex(1,2,3), unchanged)
chunkIndex(15,255,15) => 65535 (unchanged)
getBlock(chunk,16,0,0) => 0 (air, unchanged)
getBlock(chunk,0,0,1) after an out-of-range write => 0 (nothing written)
getBlock(chunk,4,5,6) after a good write => 3 (the write landed)
```

Gates, all measured on the committed tree:

- `npm run typecheck` -> exit 0
- `npm run lint` -> exit 0, 0 errors (7 pre-existing no-console warnings)
- `npx vitest run` -> 16 files, 224 passed (224)
- `npm run coverage` -> exit 0; src/core 95.54% stmts / 91.86% branch /
  96.29% funcs / 96.15% lines, against the 85 floor in `vitest.config.ts`
  which was NOT touched
- `npm run build` -> exit 0
- G6 determinism -> PASS, 5 seeds identical across fresh processes
  (0 d6e4cc59, 1 bd3879a7, 12345 57b308bb, 2147483647 66e09129, -1 4df02b13)
- G3 bench -> PASS, 3.927 ms/chunk average, 4.238 ms p95, against the 16 ms
  budget (generation 1.168 ms, meshing 2.759 ms)
- engine self-check -> PASSED, now 30 checks (7 new ones for E3)

### Behaviour contract for the TEST AUTHOR

`tests/` is not ENGINE's. The E3 behaviour is pinned in ENGINE's own
`scripts/selfcheck/engineCheck.ts` (check 10) instead. If the test author
wants it in `tests/` too, the contract is:

- `chunkIndex(x, y, z)` **throws `RangeError`** for any coordinate that is
  out of range (`x < 0 || x >= 16`, `y < 0 || y >= 256`, `z < 0 || z >= 16`)
  or non-integer. It is the same guard, and the same error, as the frozen
  `blockIndex()`.
- `chunkIndex(x, y, z)` for an in-range integer returns the frozen index,
  identical to `blockIndex(x, y, z)`.
- `getBlock(chunk, x, y, z)` reads `AIR_ORDINAL` (0) for any out-of-range or
  non-integer coordinate. Unchanged.
- `setBlock(chunk, x, y, z, id)` writes nothing for any out-of-range or
  non-integer coordinate. Unchanged.

### Notes for the fleet

- The RED-TEAM branch `feature/redteam/m1` carries an armed
  `it.fails("E3: chunkIndex must not alias an out-of-range x onto another
  block")` that expects `chunkIndex(16, 0, 0)` to be `-1`. **This fix throws
  instead of returning a sentinel**, so that stub is now STALE and must be
  removed (or flipped to a plain `it` that asserts the throw) before
  `feature/redteam/m1` is reaped. It is RED-TEAM's file, not ENGINE's.
- The RED-TEAM's `loadEngine()` still points at `world/chunk.js` and
  `world/noise.js`, paths that no longer exist — the engine was restructured
  to a flat `src/core/world.ts` + `src/core/noise.ts`. RED-TEAM will need to
  repoint it.

### Preserved, not lost: T76's in-flight water physics

The T76 agent (pid 405061) died with its work **uncommitted** in
`~/workspace/worktrees/bf-engine`: `src/core/physics.ts` (+216 lines of
buoyancy, submersion, swim velocity) and a one-line `src/core/world.ts`
change. I did not lose it and I did not mix it into this fix. It is committed
on its own branch:

- branch `feature/engine/t76-water-wip`, commit `5621eb4`

It is **incomplete and does not typecheck** on its own: `src/core/world.ts`
imports `Vec3` without using it, and `World` does not yet answer
`isFluid`/`flowAt`, which the new physics calls optionally. Whoever finishes
T76 should start from `5621eb4`, not from `feature/engine/m1`.

---

## Victory log entry (for the architect to fold into docs/VICTORIES.md)

I did **not** append to `docs/VICTORIES.md` myself, and this is deliberate.
The brief contradicts itself on that file: the VICTORY LOG section says
"Append to docs/VICTORIES.md immediately", while its own HOW TO WORK section
says "DO NOT EDIT docs/PROGRESS.md or docs/VICTORIES.md. The ARCHITECT owns
those files", and the dispatcher's own docstring says the same thing. The
dispatcher reaps a role's branch with `git merge --no-edit` and **skips the
merge on any conflict**, so I measured it rather than guessing:

```
reap engine branch (with a VICTORIES append)  -> MERGE1=0   (clean)
reap redteam branch (also appended VICTORIES)  -> MERGE2=0   (clean)
a SECOND agent appending VICTORIES concurrently-> MERGE3=1   CONFLICT
                                                 (content): Merge conflict in docs/VICTORIES.md
```

Two agents appending the same file in two worktrees conflicts, and a
conflicting reap leaves the work unmerged on the branch — which is exactly
the "work that stops accumulating" failure the fleet keeps warning about.
So the entry goes here and on the board, and the architect can fold it in
centrally. The entry:

> - [2026-10-21T19:47:00Z] bugfix — the engine could not bypass the frozen
>   blockIndex() guard. chunkIndex() was exported with no range check, so an
>   out-of-range coordinate aliased onto a DIFFERENT block's storage slot:
>   chunkIndex(16,0,0) was 16, the slot of block (0,0,1); chunkIndex(0,256,0)
>   was 65536, one past the end of the Uint8Array, so the write was silently
>   dropped; chunkIndex(-1,0,0) was -1, a negative index the typed array also
>   ignores. It now delegates to the frozen blockIndex(), so the guard lives
>   in ONE place and an out-of-range coordinate throws RangeError instead of
>   aliasing — there is no unchecked variant. getBlock/setBlock keep their
>   tolerant surface (out of range reads air, out of range writes are
>   ignored) and now reject fractional coordinates explicitly. The verifier's
>   original repro re-run in a fresh process against the compiled commit: all
>   three throw RangeError, chunkIndex(1,2,3) is still 561, and an
>   out-of-range write still changes nothing — evidence: commit d0dfceb,
>   scripts/selfcheck/engineCheck.ts check 10 (7 new assertions), typecheck 0,
>   lint 0 errors, 224/224 tests, coverage exit 0 (95.54% stmts / 91.86%
>   branch against the untouched 85 floor), G6 5 seeds identical, G3 3.927
>   ms/chunk avg / 4.238 ms p95 — M1

---

## T47 — RED-TEAM E4: valueNoise2 aliases coordinates past int32 (x|0 truncation)

**Status:** DONE. Commit `c97eb34` on `feature/engine/m1`.

### The hole

`src/core/noise.ts` `hash2`/`hash3` truncated every input before hashing
it:

```ts
let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d)) | 0;   // OLD
h = Math.imul(h ^ (z | 0), 0x165667b1);
```

`|` and `^` both do **ToInt32**. Everything above bit 31 was discarded
before the value was ever hashed, so the hash was a function of the
input's low 32 bits only. Three distinct failures came out of that one
line:

| # | failure | verified repro (before the fix) |
|---|---|---|
| 1 | the lattice repeats with period 2^32 | `valueNoise2(1234, 10.5 + 2^32, 20.5) === valueNoise2(1234, 10.5, 20.5)` -> `true` |
| 2 | `+2^31` and `-2^31` are the same point | `valueNoise2(5, 2147483648, 0) === valueNoise2(5, -2147483648, 0)` -> `true` |
| 3 | two world seeds 2^32 apart are the same world | `fbm2(4294967296, 10.5, 20.5, 1) === fbm2(0, 10.5, 20.5, 1)` -> `true`, and the chunk bytes were identical |

Failure 3 was not only the seed: `fbm2` computed
`valueNoise2(seed + octave * 0x9e3779b9, ...)`. That sum leaves the
32-bit domain from octave 2 onward (`seed=0, octave=2` -> `5308871538`
-> int32 `1013904242`), so two different `(seed, octave)` pairs landed on
the same noise.

`src/core/world.ts` had the same defect in its per-layer seeds:
`seed ^ 0x5f356495` and four more `seed ^ CONST` sites. `^` coerces to
int32, so the layers of the worlds seeded 0 and 2^32 were identical too.

This was a pure-function bug, which is the dangerous kind for a
determinism-driven project: it passed every hash test and was still
wrong. Nothing about "same seed, same world" was violated — the world
was correct and merely not injective.

### The fix

Every integer input is now mixed in as a **low/high pair of 32-bit
halves**, so no part of it is silently dropped:

- `hash2`/`hash3` take the low word (`value >>> 0`) and the high word
  (the floor quotient by 2^32) of the coordinate and mix both in.
- The seed is folded with `seedWord()`, which mixes in the high half
  too, so a seed and that seed plus 2^32 no longer collide.
- The octave index became a **separate hashed input** (the `stream`
  word) instead of an overflowing addition to the seed, so a
  `(seed, octave)` pair cannot collide with another one.
- `world.ts`'s per-layer seeds moved from `seed ^ SALT` to a
  `deriveSeed(seed, salt)` that folds the seed's high half in as well.

The low/high pair is an exact decomposition of the integer — `low` is
the coordinate mod 2^32 and `high` its floor quotient — so negative
coordinates decompose the same way positive ones do, and
`valueNoise2(s, x, z)` is now a genuine function of the whole
coordinate rather than of its low 32 bits.

**Two performance details.** The first working version of this fix
doubled chunk-generation time (1.11 -> 2.07 ms), because the seed and
coordinate splits were recomputed for every lattice point of every
sample. They are now hoisted to once per sample — `high32PlusOne()`
derives the second corner's high word from the first with a carry
check, so a cell needs one split per axis, not one per corner — and the
vein seed is derived once per chunk instead of once per sample.
Generation ended at **1.73 ms/chunk**, close to where it started.

### Verified

The verifier's ORIGINAL repro, re-run in a fresh process against the
compiled commit `c97eb34`:

```
valueNoise2(1234,10.5,20.5)         = 0.28578590939287096
valueNoise2(1234,10.5+2^32,20.5)     = 0.34588960045948625   ALIASED on x? false
valueNoise2(1234,10.5,20.5+2^32)     = 0.5130413141450845    ALIASED on z? false
fbm2(0,10.5,20.5,1)                  = 0.361511453113053
fbm2(2^32,10.5,20.5,1)               = 0.6998733225045726    same as seed 0? false
terrainHeight(1234,0,0)              = 64
terrainHeight(1234,0,2^32)           = 76                    (does not repeat)
chunk bytes differing, seed 0 vs 2^32 = 4858                 (not the same world)
```

Gates, all measured on the committed tree:

- `npm run typecheck` -> exit 0
- `npm run lint` -> exit 0, 0 errors (7 pre-existing no-console warnings)
- `npx vitest run` -> 16 files, 224 passed (224)
- `npm run coverage` -> exit 0; src/core 95.9% stmts / 92.21% branch /
  96.49% funcs / 96.37% lines, against the 85 floor in `vitest.config.ts`
  which was NOT touched
- `npm run build` -> exit 0
- G6 determinism -> PASS, 5 seeds identical across fresh processes
  (0 919b1494, 1 adeb29e1, 12345 188407dd, 2147483647 a90dbffb,
  -1 083ca468)
- G3 bench -> PASS, 4.492 ms/chunk average, 4.960 ms p95, against the
  16 ms budget (generation 1.734 ms, meshing 2.758 ms)
- engine self-check -> PASSED, now 43 checks (13 new ones for E4)

### Behaviour contract for the TEST AUTHOR

`tests/` is not ENGINE's. The E4 behaviour is pinned in ENGINE's own
`scripts/selfcheck/engineCheck.ts` (check 11) instead. The contract:

- `valueNoise2(seed, x, z)` is **not** periodic in x or z with period
  2^32: `valueNoise2(s, x + 2^32, z) !== valueNoise2(s, x, z)` and the
  same for z.
- `valueNoise3(seed, x, y, z)` is not periodic in **any** of its three
  axes with period 2^32.
- `valueNoise2(s, 2^31, z) !== valueNoise2(s, -2^31, z)`.
- The **seed** is not aliased either: `valueNoise2(0, x, z) !==
  valueNoise2(2^32, x, z)` and the same for `fbm2`. Two world seeds 2^32
  apart produce different chunks.
- `fbm2(seed, x, z, octaves)` does not alias one `(seed, octave)` pair
  with another.
- Unchanged: the values are still in `[0, 1]`, the function is still
  deterministic, different seeds still give different noise, and
  neighbouring lattice points still differ.

**This change alters generated terrain for existing seeds.** That is the
point of the fix — the old terrain was wrong — but it means any test
that pins a specific terrain height or block byte for a given seed will
need its expected value updated. No test in `tests/` pins one today
(the suite is 224/224 green as committed), but a golden-value test
added later must be written against the new terrain.

### Notes for the fleet

- **The seed is still a 32-bit value as far as the RNG is concerned.**
  `src/core/rng.ts` does `seed >>> 0`, so `createRng(2^32)` and
  `createRng(0)` still give the same stream, and `World.hash()` still
  mixes only `seed >>> 0`. This fix is about the NOISE layer, which is
  the whole of terrain generation. A world seeded `2^32` now has
  different terrain from a world seeded `0` but the same RNG stream —
  worth knowing if anyone extends the seed range, since the two would
  then need to move together. Flagging, not fixing: changing the RNG's
  seed semantics is a contract change beyond this task.
- The `stream` word in `hash2` is what makes the fBm octaves distinct.
  It is a separate hashed input rather than a constant folded into the
  seed, because folding a constant into a 32-bit seed is exactly the
  overflow that broke the octave offsets in the first place.
- `scripts/tsconfig.build.json` still has the T86 bug (TS5096:
  `allowImportingTsExtensions` with `noEmit: false`), so the gate
  scripts need `npx tsc -p scripts/tsconfig.build.json
  --allowImportingTsExtensions false`. I did not fix it — it is T86, and
  it is a one-line change in the same file I would otherwise not touch.

---

## Victory log entry (for the architect to fold into docs/VICTORIES.md)

Same reasoning as T46's entry below: the entry lives here and on the
board rather than in `docs/VICTORIES.md`, because the brief contradicts
itself about that file and a concurrent append from a second agent
produces a CONTENT CONFLICT that strands the role's whole branch on the
dispatcher's reap. The architect folds these in centrally.

> - [2026-10-21T21:10:00Z] bugfix — the terrain repeated with a period of
>   2^32 blocks, and two world seeds 2^32 apart produced byte-identical
>   worlds. `hash2`/`hash3` in src/core/noise.ts truncated every input
>   before hashing it (`Math.imul(x | 0, ...)` and `seed ^ ...`), and both
>   `|` and `^` do ToInt32, so everything above bit 31 was discarded
>   before the value was ever hashed: the hash was a function of the
>   input's low 32 bits only. The same defect appeared in fbm2's
>   `seed + octave * 0x9e3779b9` (which leaves the 32-bit domain from
>   octave 2 onward, so two different (seed, octave) pairs collided) and
>   in five `seed ^ CONST` per-layer seeds in src/core/world.ts. Every
>   integer input is now mixed in as a low/high pair of 32-bit halves, the
>   octave index became a separate hashed input instead of an overflowing
>   addition, and the per-layer seeds moved to a deriveSeed() that folds
>   the seed's high half in. The verifier's original repro re-run in a
>   fresh process against the compiled commit: valueNoise2(1234,10.5,20.5)
>   = 0.28578590939287096 vs valueNoise2(1234,10.5+2^32,20.5) =
>   0.34588960045948625 (no longer aliased), fbm2(0,...) = 0.361511453113053
>   vs fbm2(2^32,...) = 0.6998733225045726 (no longer the same world), and
>   4858 chunk bytes now differ between world seeds 0 and 2^32. The hot
>   path was kept flat by hoisting the splits to once per sample rather
>   than once per lattice point: generation 1.10 -> 1.73 ms/chunk, G3
>   total 4.49 ms avg / 4.96 ms p95 against the 16 ms budget. Evidence:
>   commit c97eb34, scripts/selfcheck/engineCheck.ts check 11 (13 new
>   assertions), typecheck 0, lint 0 errors, 224/224 tests, coverage exit
>   0 (95.9% stmts / 92.21% branch against the untouched 85 floor), G6 5
>   seeds identical across fresh processes — M1

---

## Still open in ENGINE's lane

- **T86** — the G3/G6/selfcheck gate scripts die with TS5096 because
  `scripts/tsconfig.build.json` sets `noEmit: false` while the root
  `tsconfig.json` sets `allowImportingTsExtensions: true`. I built and ran
  all three gates with a one-off
  `npx tsc -p scripts/tsconfig.build.json --allowImportingTsExtensions false`
  override and they all PASS, so the only thing broken is the committed
  command. A one-line fix in `scripts/tsconfig.build.json`.
- **T76** — water physics, preserved above at `5621eb4`.
