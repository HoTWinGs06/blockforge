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

## Still open in ENGINE's lane

- **T47** — RED-TEAM E4: `valueNoise2` aliases coordinates past int32
  (`x | 0` truncation), so terrain repeats with period 2^32. `src/core/noise.ts`.
  Repro: `valueNoise2(5, 2147483648, 0) === valueNoise2(5, -2147483648, 0)`.
  Not started — T46 was the smaller fix and went first.
- **T86** — the G3/G6/selfcheck gate scripts die with TS5096 because
  `scripts/tsconfig.build.json` sets `noEmit: false` while the root
  `tsconfig.json` sets `allowImportingTsExtensions: true`. I built and ran
  all three gates with a one-off
  `npx tsc -p scripts/tsconfig.build.json --allowImportingTsExtensions false`
  override and they all PASS, so the only thing broken is the committed
  command. A one-line fix in `scripts/tsconfig.build.json`.
- **T76** — water physics, preserved above at `5621eb4`.
