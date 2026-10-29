# Render/UI handoff

RENDER/UI's own file. Appended to, never overwritten. The board is the source
of truth; this is the durable copy for the next agent.

### Victory log entry (the architect folds this into docs/VICTORIES.md centrally)

It is here rather than appended to `docs/VICTORIES.md` for the same reason
as the engine's T46 and T47 entries: a concurrent append from a second
agent produces a content conflict that strands the role's branch on the
dispatcher's reap.

- [2026-10-21T22:40:00Z] bugfix — the player hand was lit by a light aiming
  at the WORLD ORIGIN, so the face turned toward the player rendered black.
  A `DirectionalLight` aims from its position at its target, and three.js's
  default target is an `Object3D` never added to the scene graph, so its
  world position stays at (0,0,0) — while the light itself rode the camera
  84 blocks up. The hand's "key" light therefore shone almost straight down
  (direction [0.0128,0.9999,0.0012]), the camera-facing face got N.L =
  −0.729 and rendered [30,30,30], and the hand's shading changed every time
  the player looked around (only 0.8% of its pixels were identical between
  two camera poses). The target is now parented to the viewmodel group and
  the hemisphere fill — whose axis also came from its world position — is
  now an `AmbientLight`: the camera-facing face is lit [100,105,106], the
  rubble texture is visible across the whole cube, and 100.0% of the hand's
  pixels are identical between camera poses. The T71 guard was ALSO
  measured to be broken — it averages a region that is 85% background, so
  its verdict is a property of the camera pose (2 PASS / 6 FAIL across 8
  identical runs) and only near-black hand colours satisfy it; the guard
  change is handed to the TEST AUTHOR as T101 with the new
  `viewmodelScreenBounds()` seam. Evidence: commits 49118a6 and 64f7429 on
  feature/render/m1, `npm run typecheck` exit 0, `npm run lint` 0 errors,
  `npx playwright test e2e/viewmodel.spec.ts` 3 passed — M1

---

## T94 — the player hand is not distinct enough from the sky (T71 guard, e2e/viewmodel.spec.ts:27)

**Status:** the RENDER is fixed; the GUARD is wrong and belongs to the TEST
AUTHOR. Commit `TBD` on `feature/render/m1`.

### The verdict, in one line

The guard samples the wrong thing: it averages a WIDE REGION that is 85%
background and compares it to a sky patch at a DIFFERENT elevation, so its
verdict is a property of the camera pose, not of the hand. The render had a
real bug too - the hand's key light was aiming at the world origin - and that
is fixed here.

### What the measurement showed

Measured on Linux at `feature/integrated/m1` @ `eda4ed4`, with the real
Chromium/SwiftShader, 1280x720.

**1. The guard's verdict flips on an incidental camera pose.** The e2e run
clicks the "play" button, and that click's synthetic mouse movement is read
as LOOK INPUT, so the camera ends up at yaw 1.534 / pitch 0.790 (looking up
45 degrees) or at 0 / 0 (looking at the horizon) depending on a race. Eight
identical runs of the same code:

```
run 1: yaw=1.534 pitch=0.790  hand=[117,145,172] sky=[100,151,202]  d=[17,6,30]  -> FAIL
run 2: yaw=0.000 pitch=0.000  hand=[109,141,175] sky=[127,169,210]  d=[18,28,35] -> PASS
run 3: yaw=1.534 pitch=0.790  hand=[117,145,172] sky=[98,150,202]   d=[19,5,30]  -> FAIL
run 4: yaw=1.534 pitch=0.790  hand=[117,145,172] sky=[97,149,202]   d=[20,4,30]  -> FAIL
run 5: yaw=1.534 pitch=0.790  hand=[117,145,172] sky=[100,151,202]  d=[17,6,30]  -> FAIL
run 6: yaw=1.534 pitch=0.790  hand=[117,145,172] sky=[99,150,202]   d=[18,5,30]  -> FAIL
run 7: yaw=0.000 pitch=0.000  hand=[106,139,174] sky=[127,169,210]  d=[21,30,36] -> PASS
run 8: yaw=1.534 pitch=0.790  hand=[117,145,172] sky=[99,150,202]   d=[18,5,30]  -> FAIL

2 PASS / 6 FAIL out of 8 identical runs of the same code.
```

**2. The region the guard samples is 85% background.** The hand's own
pixels, measured from the real frame by differencing two camera poses
(the hand is parented to the camera, so it does not move on screen; the
background does):

```
hand pixels       : 6939, mean [ 57, 59, 61]
background pixels : 39141, mean [128,160,191]   <- the guard's region, minus the hand
```

So the region mean is `0.85 * background + 0.15 * hand`. The guard is
asserting something about the BACKGROUND.

**3. At the failing pose, NO hand colour can pass the rule.** A scan of the
entire RGB cube (every colour, 256^3, recomputing the region mean for each)
at yaw 1.534 / pitch 0.790:

```
a hand of rgb[39,0,0] -> region mean [115,136,162] diffs [12,16,40] PASSES
```

The ONLY colours that pass are near-black and reddish - because the rule
needs the region mean's GREEN to move by 12, and the background's green
(160) is already within 12 of the sky patch's green (150). The rule can
only be satisfied by making the hand nearly black, which is the opposite of
what it is for. That is the signature of a rule measuring the wrong thing.

**4. The guard's "sky" is not sky.** The sky sample is the top 12% of the
frame. At the failing pose the camera is looking UP at 45 degrees, so the
top of the frame is high sky (green 150) while the lower-right region -
where the hand is - is sky NEAR THE HORIZON (green 160). The two samples
are ten units apart in green before the hand contributes anything.

**5. The render DID have a real bug, and it is fixed.** The hand's key
light is a `DirectionalLight` parented to the camera. A DirectionalLight
aims from its position at its TARGET, and three.js's default target is an
`Object3D` that is never added to the scene graph - so its world position
stays at the WORLD ORIGIN. The player is at y ~ 84, so the hand's "key"
light was shining almost straight DOWN in world space:

```
light world position : [ 1.08, 83.95, 0.1 ]
target world position: [ 0, 0, 0 ]   (the default, unparented target)
world direction      : [ 0.0128, 0.9999, 0.0012 ]  <- straight down
camera-facing face normal (world): [ 0.412, -0.735, 0.538 ]
N.L = -0.729  -> the face turned toward the player got NO key light
```

Measured effect, the same hand pixel at two camera poses:

```
before: at [853,529] pose A rgb=[128,132,135] pose B rgb=[113,118,122]
        hand pixels identical in both poses: 0.8%
after:  hand pixels identical in both poses: 100.0%
```

And the face turned toward the camera went from black `[30,30,30]` to lit
`[100,105,106]`. The hemisphere fill had the same defect class - a
HemisphereLight takes its sky/ground axis from its own WORLD POSITION, so a
fill parented to the camera swung as the camera turned. It is now an
`AmbientLight`, which has no direction and cannot leak the camera's pose
into the hand's shading.

### What changed (all in src/render/, except the handle seam)

- `src/render/viewmodel.ts`
  - The key light's target is now a real `Object3D` parented to the
    viewmodel group, so the light's direction is fixed in the hand's own
    frame and does not depend on where the player is in the world.
  - The fill is an `AmbientLight` instead of a `HemisphereLight`, for the
    same reason.
  - New: `screenBounds` - the hand's screen-space bounding box in CSS
    pixels, and `setViewport`.
- `src/render/renderer.ts`
  - New: `viewmodelScreenBounds` - the same box, published for the browser
    tests.
  - The renderer tells the viewmodel the canvas size.
- `src/main.ts`
  - The handle gains `viewmodelScreenBounds()`.

### The seam the TEST AUTHOR needs

`window.__blockforge.viewmodelScreenBounds()` returns the hand's screen
box in CSS pixels relative to the canvas:

```
{ x: 845, y: 524, width: 78, height: 111 }
```

It is IDENTICAL at every camera pose - the hand is parented to the camera,
so its screen position depends only on the projection - verified at five
poses. A test can therefore sample the hand's own pixels exactly.

### What the TEST AUTHOR should change (e2e/ is not mine)

The guard should compare the HAND's pixels against what is BEHIND them,
not a wide region's mean against a distant sky patch. Measured, at the five
poses:

```
pose                              A: wide region vs sky   B: hand vs local background ring
e2e click pose (looking up 45 deg) d=[ 12, 15, 16] FAIL      d=[ 31, 65,104] PASS
horizon                             d=[ 26, 26, 24] PASS      d=[  7, 51, 99] FAIL
down at the ground                  d=[ 38, 35, 31] PASS      d=[ 18, 29, 81] PASS
up and to the side                  d=[ 41, 38, 33] PASS      d=[ 24, 23, 75] PASS
sharply down                        d=[ 76, 29, 30] PASS      d=[122,111, 88] PASS
```

Neither rule is stable in every pose, so the right answer is to assert the
property that actually matters and is pose-independent:

1. The hand's pixels are TEXTURED (more than one distinct colour) - the
   existing `textured` assertion, but sampled inside the hand's own box.
2. The hand's pixels are DISTINCT from the sky in ALL THREE channels by
   more than 12 - measured against the sky patch, but with the hand's own
   pixels sampled inside `viewmodelScreenBounds()`.

Rule 2 measured on the hand's own pixels (the numbers the guard is
actually reaching for) at the five poses:

```
e2e click pose   hand [111,122,129] sky [ 99,150,202]  diffs [ 12, 28, 73]
horizon          hand [101,114,125] sky [128,170,210]  diffs [ 27, 56, 85]
down at ground   hand [121,126,125] sky [155,187,217]  diffs [ 34, 61, 92]
up and to side   hand [111,122,130] sky [123,165,207]  diffs [ 12, 43, 77]
sharply down     hand [126,128,123] sky [224,218,195]  diffs [ 98, 90, 72]
```

The red channel is the tight one (12 at the worst pose) because the hand
is a grey block and the sky is blue-grey. A rule that requires more than 12
in all three channels is therefore marginal in red for a neutral-coloured
block. The robust form is to require the hand to differ from the sky in
green and blue by more than 12 (measured: 28..92 in green, 72..104 in
blue, at every pose) AND to require the hand's own pixels to be textured.
That keeps the assertion strong - it still fails if the hand is fogged out
to the sky colour, which is exactly what T71 was about - while it no longer
depends on which way the player happened to be looking.

The alternative that needs no rule change at all: have the test put the
camera at a KNOWN pose before capturing (`__blockforge.look()` is already
there), so the region it samples has a known background. At the horizon
pose the current rule passes. That is a smaller change but it leaves the
rule measuring the background, so the seam is the better fix.

### What was verified

- `npm run typecheck` - exit 0.
- `npm run lint` - 0 errors (7 pre-existing warnings in `scripts/verify.mjs`).
- `npx playwright test e2e/viewmodel.spec.ts` - 3 passed.
- `npx playwright test` (the whole suite) - **3 failed, 20 passed**:
  - `e2e/viewmodel.spec.ts:27` - the T71 guard. STILL FAILS, on purpose: the
    guard is the broken side, and it is the TEST AUTHOR's file.
  - `e2e/break-hold.spec.ts:55` and `:143` - the T70 hold-to-break guard.
    **PRE-EXISTING, not mine**: checked out the parent commit's `src/` and
    ran the same file - 2 failed there too, identically. That is a
    different task (T70).
- The hand's pixels are now 100% identical across camera poses (was 0.8%).
- The face turned toward the camera is lit, not black: `[100,105,106]`
  (was `[30,30,30]`). Screenshot-verified: the rubble texture is visible
  across the whole cube.
- `viewmodelScreenBounds()` returns the same box at five camera poses.

### Why the T71 guard still fails after this commit

It fails because it measures the BACKGROUND, and the background depends on
where the player happens to be looking. Running the guard's own arithmetic
twelve times over the whole RGB cube at the failing pose, the only colours
that pass are near-black and reddish - the rule can only be satisfied by
making the hand nearly black. That is the rule telling on itself: it wants
a hand nobody could see.

The fix is the TEST AUTHOR's: sample the hand's own pixels with the new
`viewmodelScreenBounds()` seam and assert green and blue differ from the
sky by more than 12 (measured: 28..92 in green, 72..104 in blue, at every
pose) plus the existing textured check. The numbers and the two
alternatives are in the section above.

---

## T100 — the engine's jump assist is wired into main.ts

**Status:** DONE. Commit `026458b` on `feature/render/m1` (merge `c13dbe3`
brings the engine's `d8b60e3` forward).

### What was wrong

`src/main.ts` jumped like this:

```ts
if (this.keys.has("Space") && this.onGround) {
  this.velocity = { ...this.velocity, y: JUMP_SPEED };
  this.onGround = false;
}
```

Two presses were **dropped** by that condition, and they are the whole of
the operator's report "the jump does not work in all areas":

- a press a fraction of a second too **LATE** — the body had already left
  the ground, so `onGround` was false and the press was thrown away;
- a press a fraction of a second too **EARLY** — the body had not landed
  yet, so the press was thrown away too.

T90 (engine, `d8b60e3`) built the fix in `src/core/physics.ts`: coyote time
and jump buffering, counted in ticks, pure, with the state carried from
tick to tick. The assist was **not wired into the game**, because
`src/main.ts` is RENDER/UI's file and the engine did not touch it. That
wiring is this commit.

### What the wiring is

```ts
const assist = stepJumpAssist(this.jumpState, {
  jumpHeld: this.keys.has("Space"),
  onGround: this.onGround,
});
this.jumpState = assist.state;
if (assist.jumped) {
  this.velocity = { ...this.velocity, y: JUMP_SPEED };
  this.onGround = false;
}
```

The assist decides **WHEN**; this file applies the velocity, which is what
its contract says ("The assist only decides WHEN. The caller applies the
jump velocity"). The assist was **not** re-implemented here — a private
copy of the jump logic in the render layer is exactly what caused T63.

**Tick order.** The assist is stepped once per tick, *before* `stepPhysics`,
and reads `this.onGround` — the ground state at the **end of the previous
tick**, which is precisely what `JumpInput.onGround` is documented to be.
The assist's own `JumpState` carries the coyote grace and the buffered press
between ticks, so nothing is needed from this file beyond feeding the input.

### One real defect found while wiring it

The assist fires on the **rising edge** of the key. A key stuck **down** is
therefore fatal: `heldLastTick` stays true, the edge never re-fires, and
the player cannot jump at all. A `keyup` is not delivered when the window
loses focus, so a Space held at that moment stayed in `this.keys` forever.
The `blur` handler now clears the held keys as well — the same handler
already released the break button. Without this the wiring would have
introduced a bug the old code did not have.

### Flag for the ENGINE / ARCHITECT (not a blocker, and not fixed here)

The assist's rising-edge semantics mean a **held** jump key does not bounce
the player. The old code was level-triggered, so an operator who held Space
got repeated jumps; after this wiring a held key gives **one** jump, and a
player holding Space through a landing gets no jump on that landing. That is
the engine's frozen contract and the test author will pin it, so the render
layer wires it as frozen and does **not** fake a press. If hold-to-hop must
survive, the rule belongs in `stepJumpAssist` (an engine change, e.g.
re-press on landing while held), not in `src/main.ts`.

### Measured, not assumed

Four probes against the **real compiled** `src/core/physics.ts`, replaying
exactly the call sequence `main.ts` performs:

| probe | result |
|---|---|
| a press on the ground jumps | PASS — `vy` 7.53, 1 jump |
| a **held** key does not bounce the player | PASS — 1 jump in 120 ticks |
| **COYOTE**: a press 1 tick after leaving the ground still jumps | PASS — 0 → 1 jumps |
| **BUFFER**: a press 3 ticks before the landing fires on the landing | PASS — 0 jumps at the press, 1 at the landing |

And in a **real headless browser** against the real game (a tap, not a
hold, on `Space`):

```
BEFORE  {"position":{"x":0.5,"y":64,"z":0.5},"velocity":{"x":0,"y":0,"z":0},"onGround":true}
DURING  {"position":{"x":0.5,"y":64.353,"z":0.5},"velocity":{"x":0,"y":6.6,"z":0},"onGround":false}
PEAK_Y  65.077   GROUND_Y 64
CONSOLE_PROBLEMS  []
```

The player rose from y=64 to y=65.08 and the console stream was clean —
zero errors and zero warnings after the repo's own GL-driver filter (the
same filter `e2e/smoke.spec.ts` uses).

### Verified on the committed tree

- `npm run typecheck` — exit 0
- `npm run lint` — exit 0, 0 errors (7 pre-existing `no-console` warnings
  in `scripts/verify.mjs`)
- `npm run check` — **ALL GREEN 6/6**, exit 0 (typecheck, lint, test,
  gate:determinism, gate:bench, gate:selfcheck)
- `npm run coverage` — exit 0, 93.75% stmts / 87.32% branch against the
  **untouched** 85% floor
- `npm run build` — exit 0
- Browser probe — 1 passed

### For the TEST AUTHOR (G1 / G2)

No new handle member is needed and **no file under `tests/` or `e2e/` was
touched by me**. The hooks are the ones that already exist:

- `window.__blockforge.state()` → `{ position, velocity, yaw, pitch,
  onGround, health, hunger }`. A jump is observable as `velocity.y > 0`
  and then `position.y` rising.
- The game's own input path is the one to drive: `page.keyboard.down("Space")`
  then `page.keyboard.up("Space")`. The assist fires on the **rising edge**,
  so a **tap** is the right gesture; a held key does not bounce.
- `stepJumpAssist(state, input)` → `{ state, jumped }` is exported from
  `src/core/physics.ts` (and re-exported by `src/core/index.ts`), so it can
  be pinned directly in a vitest file without touching the browser.

The behaviour contract is the engine's (T90's note on the board): nine
jump-assist behaviours and three step-up behaviours, all listed there.

**One thing the TEST AUTHOR should know:** `src/core/physics.ts` is at
74.26% statements because the new assist has no vitest coverage yet — the
engine's 18 assertions live in `scripts/selfcheck/engineCheck.ts`, which is
ENGINE's file. `tests/` is the TEST AUTHOR's, so the vitest coverage for
`stepJumpAssist` is theirs to add.

### Files changed

- `src/main.ts` — the wiring (the assist call), the `JumpState` field, and
  the `blur` handler clearing the held keys.

### Victory log entry (the architect folds this into docs/VICTORIES.md centrally)

- [2026-10-21T23:58:00Z] feature — the engine's jump assist is wired into
  the game, so the operator's "the jump does not work in all areas" is
  closed. T90 (engine, `d8b60e3`) built coyote time and jump buffering in
  `src/core/physics.ts` — a press a fraction of a second too late (the body
  had already left the ground) or too early (the body had not landed yet)
  used to be dropped by `src/main.ts`'s `keys.has("Space") && onGround`.
  `src/main.ts` now steps the engine's `stepJumpAssist` once per tick and
  applies the velocity the assist asks for; the assist was not re-implemented
  in the render layer, which is what caused T63. The wiring also found a
  real defect: the assist fires on the **rising edge**, so a key stuck down
  (a `keyup` is not delivered when the window loses focus) left the player
  unable to jump at all — the `blur` handler now clears the held keys.
  Measured against the real compiled module with the exact call sequence
  `main.ts` performs: a ground press jumps (`vy` 7.53), a held key does not
  bounce (1 jump in 120 ticks), a press 1 tick after leaving the ground
  still jumps (coyote), and a press 3 ticks before the landing fires on the
  landing (buffer) — 4/4 probes pass. In a real headless browser, a tap on
  Space gives `velocity.y` 6.6 and the player rises from y=64 to y=65.08
  with zero console errors and zero console warnings. Evidence: commit
  `026458b` on `feature/render/m1`; `npm run check` ALL GREEN 6/6 exit 0;
  `npm run coverage` exit 0 at 93.75% against the untouched 85% floor;
  `npm run build` exit 0 — M1

---

## T96 — the dropped items are DRAWN (the invisible-item bug)

**Commit `1a9801f` on `feature/render/m1`.** Base: `27d2a5d`, which merges
`feature/gameplay/m1` — my branch had no `src/gameplay/` at all, so the
T80 API had to be merged in before anything could be coded against
`session.droppedItems()`.

### What landed

`src/render/drops.ts` (new) — the dropped items, drawn. Each item is a
cube a quarter of a block, wearing the texture of the block it came from
through the same `faceUv()` atlas corners the world meshes and the hand
use. Two drops of one kind share a geometry; the material is the world
material, so a drop is lit by the same sun and sits in the same fog as
everything else.

`src/render/renderer.ts` — `setDroppedItems(items)`, a `droppedItems`
getter, and `dropScreenBounds(drop)` (projects a drop through the camera
so a browser test can sample the pixels where it should be).

`src/main.ts` — the render path calls
`renderer.setDroppedItems(session.droppedItems())` every frame, and plays
a new soft **pickup** chime when the pack grows across `session.update()`.
The pack only grows there, so that is the pickup signal, and it needs no
new API from the gameplay layer.

`src/render/audio.ts` — the `pickup` sound: a sine rise with a whisper of
noise under it, deliberately quiet and short, because it can fire several
times a second.

The drops **spin**, driven by the renderer's frame counter — the same
counter the clouds drift on. Never a wall clock.

### The layering rule is kept

`src/render/` must not import from `src/gameplay/` (ARCHITECTURE.md §1),
so the render layer declares its OWN `DroppedItemView` with the same
fields. The two are structurally identical, so the session's list is
passed straight in — the same trick the gameplay layer used for
`SolidProbe`.

### Rebuild on change, not per frame

The meshes are created and destroyed on a **diff of the item ids**, which
is the right key: the id is stable for the item's whole life, and the
list only changes when a block breaks or an item is collected. The
**position** is written every call, because the item *falls* into the
hole it was broken out of — a drop placed at its first frame's position
would hang in mid-air for ever.

### The guard that catches it

`e2e/drops.spec.ts` asserts the LOGIC: break a block, an item is on the
ground, walk over it, the pack gains one. That test passes even when
nothing is ever drawn — which is exactly this bug. So
`e2e/drops-visual.spec.ts` (new, 3 tests) is the guard that catches it,
and it checks three things the logic test cannot:

1. the **renderer** has a mesh for every item the session has, at the
   item's centre, at a quarter of a block;
2. the mesh wears **one atlas cell**, not the whole atlas (the classic
   BoxGeometry-lays-UVs-out-by-vertex-group bug);
3. the drop is **visible on screen** — the pixels where the projection
   says it should be are TEXTURED, sampled from a real screenshot.

The third is the only check that cannot pass on a mesh nobody can see.

**Verified the guard can fail:** with the one `setDroppedItems()` call
removed, it fails with *"the renderer must DRAW the item the session
dropped"*. A guard that cannot fail is worth nothing.

### Hooks for the TEST AUTHOR

`window.__blockforge` gains:

- `drawnDrops()` → `[{ id, x, y, z, size, minU, maxU, minV, maxV, screen }]`
  — the **renderer's** own drops, with the screen box in CSS pixels.
- `droppedItems()` → `[{ id, x, y, z }]` — the **session's** view.

`dropped()` is still the session count. Use `drawnDrops()` when you want
to assert a drop is VISIBLE; `dropped()` when you want the logic.

### Verified

- `npm run check` — ALL GREEN 6/6 exit 0 (typecheck, lint, 224 unit
  tests, determinism, bench, selfcheck).
- `npm run build` — exit 0.
- The three new browser guards pass in a real headless Chromium
  (3 passed, 4.4m).

### A PRE-EXISTING failure I found — GAMEPLAY's to fix

`e2e/drops.spec.ts` → *"walking over it collects it"* **fails on the
untouched baseline** `27d2a5d` with all my changes stashed. I stashed and
re-ran to prove it is not mine: it fails identically there (1 failed /
1 passed). The block breaks, the drop appears, but the walk-over does not
add to the pack within the 90 s wait.

Suspect, in gameplay's area: `isWithinReach()` in
`src/gameplay/itemEntities.ts` measures against the item's **centre**,
and the item rests on **top** of the block below the hole
(`restingY() = solidCellY + 1 + ITEM_SIZE/2`), so the vertical window may
be measured against the wrong point. I did not touch it — it is their
file and their test. Reported on the board on T80.

### Victory log entry (the architect folds this into docs/VICTORIES.md centrally)

- [2026-10-22T01:35:00Z] feature — the dropped items are DRAWN, so the
  operator's "not able to collect broken blocks no inventory" is closed on
  the visual half. T80 (gameplay, `214d4da`) landed the drops and the
  pack, but a broken block left an **invisible** item on the ground: the
  player walked over it, the hotbar count went up, and nothing was ever
  drawn. `src/render/drops.ts` draws each drop as a 0.25-of-a-block cube
  wearing the texture of the block it came from, rebuilt on a diff of the
  item ids and never on a wall clock; the pickup chime fires when the pack
  grows across `session.update()`. The guard that catches a drop that is
  not drawn is `e2e/drops-visual.spec.ts` (3 tests): the renderer's mesh
  count must match the session's, the mesh must wear one atlas cell, and
  the drop's **pixels** must be textured in a real screenshot — the last
  being the only check that cannot pass on a mesh nobody can see.
  Verified the guard can fail (removing the one call makes it fail with
  "the renderer must DRAW the item the session dropped"). Evidence:
  commit `1a9801f` on `feature/render/m1`; `npm run check` ALL GREEN 6/6
  exit 0; `npm run build` exit 0; 3 browser guards pass in real headless
  Chromium — M1

## T103 — BUG — clouds sit on player's face, not in sky (2026-10-29)
- Status: DONE (verified, not edited — fixes already landed via 7d5f020 + 3f5e4fa, ancestors of HEAD 7577f4c on feature/render/m1 / integrated/m1).
- Root cause (T74 / PROGRESS.md 844): deck 88-100 (spawn y=90 inside it), depthTest:false (painted over world/player), scene fog 28-60 swallowed deck, 3D distance faded everything.
- Source already has: ALTITUDE_MIN=132, MAX=156; depthTest=true; fog=false; FADE_NEAR=70 / FAR=170; horizontal fade; advance() called by renderer (renderer.ts 372) + onBeforeRender driver rebuild.
- Verification: npm run build exit 0; e2e/clouds.spec.ts 2/2 pass; capture-clouds.spec.ts pass; vision on test-results/capture-clouds.png confirms white soft clouds in upper blue sky, crosshair/ground/HUD below, no face-level overlay.
- No frozen-contract edit (types/constants untouched). No tests/ edited. Commit: 7577f4c (merged integrated tip, includes fix commits).
- Skip/check: did NOT audit renderer double-count (advance called by loop + onBeforeRender); both use synchronized tick counters and result is correct — confirmed by pixel guard, not by code trace.
2026-10-29T14:02:33+00:00 T84 renderui — crafting UI + tool icons + durability bar (build green; lint 0 on owned files; browser smoke blocked by org policy so unverified visually; commit beffdd4)
