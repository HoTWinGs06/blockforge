# Test Author handoff

The TEST AUTHOR's own file. Appended to, never overwritten. The board is the
source of truth; this is the durable copy for the next agent.

### Victory log entry (the architect folds this into docs/VICTORIES.md centrally)

It is here rather than appended to `docs/VICTORIES.md` for the same reason
as the engine's T46/T47 and the render's T94 entries: a concurrent append
from a second agent produces a CONTENT CONFLICT, and the dispatcher's reap
skips any merge that conflicts, so an append from a role branch can strand
the role's own work.

- [2026-10-22T02:41:00Z] testfix — the player-hand guard now measures the
  HAND, not the background. The T71 guard averaged a wide region that was
  85% world (6939 hand pixels out of 46080) and compared it against a sky
  patch at a different elevation, so its verdict was a property of the
  camera pose (2 PASS / 6 FAIL across 8 identical runs) and it REWARDED a
  broken hand: a scan of the whole RGB cube showed the only colours that
  could satisfy it were near-black, so the black hand of the T94 bug
  passed while a correctly lit hand failed. The rewrite uses the fact that
  the hand is a child of the CAMERA — it does not move on screen when the
  player looks around and, since the T94 lighting fix, its shading does not
  depend on where the player looks either, while the world behind it does
  move: take a frame, move the camera, take a second frame, and the pixels
  inside the hand's screen box that are IDENTICAL in both frames are the
  hand's own pixels. Measured at seven camera poses including the one that
  broke the old guard, the hand fills 0.801 of its box and shows 14
  distinct colours at EVERY pose and sits 99..139 from the sky. ARMED and
  proven: with the T94 lighting bug put back in a scratch tree the same
  guard fails on "0 of 8658 pixels held still while the world moved" — red
  on the bug, green on the fix. Evidence: commit 3ae7cb0 on
  feature/test-author/m1, `npx playwright test e2e/viewmodel.spec.ts` 3
  passed, `npx vitest run` 224 passed, `npm run typecheck` exit 0, `npm run
  lint` 0 errors — M1

---

## T101 — the T71 hand guard measured the background, not the hand

**Status:** DONE. Commit `3ae7cb0` on `feature/test-author/m1`. The change
is `e2e/viewmodel.spec.ts` only — one file, in the TEST AUTHOR's area.

### The brief

T94 (RENDER/UI, commit `49118a6` on `feature/render/m1`) fixed the RENDER
half of the player's-hand bug and handed the GUARD half to the TEST AUTHOR:
`e2e/viewmodel.spec.ts:27` was the TEST AUTHOR's file, RENDER/UI did not
edit it, and the guard had a real defect.

The defect, in the render's own words: the guard averaged a WIDE REGION in
the lower-right corner (6939 hand pixels out of 46080 — 85% background) and
compared that mean against a sky patch at a DIFFERENT elevation. So its
verdict was a property of the camera pose, not of the hand. Measured by
RENDER/UI: 2 PASS / 6 FAIL across 8 identical runs of the same code.

### What the new guard does

The hand is a child of the CAMERA. That is the fact the guard is built on:

  - it does not move on screen when the player looks around, and
  - since the T94 lighting fix, its shading does not depend on where the
    player is looking either,

while the WORLD behind it does move. So the guard:

1. puts the camera at a KNOWN pose (the play button's click is read as
   look input, so the camera otherwise starts at an unknown pose — this
   was the source of the 2-PASS/6-FAIL race);
2. hides the DOM HUD, whose static pixels would otherwise be counted as
   hand pixels that never move;
3. reads the hand's own screen box from the new
   `__blockforge.viewmodelScreenBounds()` seam;
4. takes a frame, MOVES THE CAMERA, takes a second frame;
5. the pixels inside the hand's box that are IDENTICAL in both frames are
   the hand's own pixels.

That isolates the hand exactly — no guesswork about where it is — and makes
the verdict independent of the camera pose.

### The assertions, and what each one is for

- **the world behind the hand must have moved between the two frames**
  (control). If this fails, nothing else below means anything: "the pixels
  that did not move" would be true of a frozen frame.
- **the hand must fill its own screen box** (>50%; measured 0.801 at every
  pose). The box is the bounding box of a rotated cube, so a fifth of it is
  world showing through the corners — but the bulk must be the hand, and
  every one of those pixels must be the SAME in both frames, which is only
  true of something parented to the camera.
- **the hand must show a TEXTURED block, not a flat shape** (>3 distinct
  colours; measured 14). A cube shows at most three flat faces, so more
  than three distinct colours means the block's own texture is showing.
- **the hand must be visibly distinct from the sky** (Euclidean RGB
  distance > 40; measured 99..139). A hand fogged out would BE the sky's
  colour. The distance is ONE number over all three channels, so a hand
  that differs in only one channel cannot sneak past — which is exactly
  what the old per-channel rule did: it passed a BLACK hand and failed a
  correctly lit one.

### Measured, not guessed

Seven camera poses, including the one that made the old guard fail
(yaw 1.534 / pitch 0.790):

```
pose                      fill   distinct   distance from sky
old failing pose          0.801      14              109.8
horizon                   0.801      14              136.9
up and to the side        0.801      14              115.5
down at the ground        0.801      14               99.1
sharply down              0.801      14              128.3
up and to the side (2)    0.819      16              139.2
up and to the side (3)    0.801      14              108.0
```

The thresholds (0.5 / 3 / 40) sit well clear of the worst measurement on
every axis, and the verdict is the SAME at every pose — which is the whole
point of the rewrite. The old guard's own numbers on the same tree:
`hand [125,153,179] against a sky of [103,152,203]` — a FAIL, on a
perfectly correct render.

### The guard is ARMED — proven, not asserted

A green test proves nothing until it is shown to go red on the bug it
exists to catch. So the T94 lighting bug was put back in a scratch copy of
the tree (the key light's target removed from the viewmodel's frame, and
the hemisphere fill restored — the exact defect of `49118a6`):

```
Error: the hand must fill its own screen box (0 of 8658 pixels held still
while the world moved)
```

On the broken tree the hand's pixels change when the camera moves, so the
hand cannot be told from the world — which is precisely the bug. On the
fixed tree the same guard passes. Same file, same code, two trees.

### Verification

- `npx playwright test e2e/viewmodel.spec.ts` — **3 passed**.
- `npx playwright test` (the whole suite) — **26 passed, 2 failed**. Both
  failures are `e2e/break-hold.spec.ts:55` and `:143`, the PRE-EXISTING
  T70 hold-to-break flakes that RENDER/UI also measured on this tree
  before this change, and which are tracked as T92. Not caused by this
  change, not in this file, not fixed here.
- `npx vitest run` — **224 passed (224)**, 16 files.
- `npm run typecheck` — exit 0.
- `npm run lint` — 0 errors, 7 warnings (all pre-existing, in
  `scripts/verify.mjs`).
- The guard itself: 36s, under the 180s timeout it sets for itself. The
  default 60s in `playwright.config.ts` is a coin flip on a loaded CI box,
  and the test reads two full frames and compares them pixel by pixel.

### One thing worth knowing

Two untracked scratch files, `tests/_probe.test.ts` and
`tests/_tsimp.test.ts`, were sitting in `tests/` from an earlier session
and were failing `npm run lint` with 4 `no-explicit-any` errors. They were
never committed (`git log --all` finds them on no branch). Deleted: they
are probe scratch, and they were red on the lint gate. The lint gate is
green because of that, not in spite of it.

### What this does NOT do

- It does not touch the frozen contract, `src/`, or anything outside
  `e2e/`. One file, in the TEST AUTHOR's area.
- It does not fix the T70 break-hold flakes. That is T92, and it is not
  this file.
- It does not add a new testing seam. It uses the one RENDER/UI added in
  `49118a6`.

### A note for whoever picks up the next T-number

The dispatcher's reap is BROKEN and has been for at least an hour:

```
File "/home/hermes/workspace/fleet-dispatcher.py", line 394, in reap_completed
    if not branch or branch in ("main", INTEGRATED):
NameError: name 'INTEGRATED' is not defined
```

`INTEGRATED` is defined at module level as `INTEGRATED_BRANCH`. The name
`INTEGRATED` is used in exactly one place — line 394 — so the reap raises
before it merges anything, and **no role branch has been merged into
`feature/integrated/m1` by the dispatcher since**. That is why this
worktree had to be fast-forwarded to `feature/render/m1` by hand to get
the `viewmodelScreenBounds()` seam. It is a one-word fix in a file that is
NOT the TEST AUTHOR's, so it is reported here and on the board rather than
edited. **Until it is fixed, every agent's finished branch is stranded on
its own branch**, and downstream agents cannot start from a merged SHA.
