/**
 * BlockForge — the physics gaps: the jump assist, the hardened step-up and
 * the water (src/core/physics.ts).
 *
 * OWNERSHIP: TEST AUTHOR (tests/).
 *
 * The engine's self-check (scripts/selfcheck/engineCheck.ts) pins the
 * jump assist (T90) and the hardened step-up — but scripts/selfcheck/ is
 * the ENGINE's file and does not count toward the G1 vitest coverage
 * floor, and the water physics is not pinned there at all, so physics.ts
 * stayed the weakest file in src/core. This file ports those two into
 * vitest, and pins the water physics itself: submersion, swimVelocity
 * and flowAt.
 *
 * Everything here is deterministic: the jump assist forbids `Math.random`
 * on principle (the same inputs always give the same jump), and the water
 * is a pure function of the world state.
 */
import { describe, it, expect } from "vitest";
import {
  COYOTE_TICKS,
  FLOW_SPEED,
  GRAVITY,
  JUMP_BUFFER_TICKS,
  STEP_HEIGHT,
  SWIM_ACCELERATION,
  SWIM_SPEED,
  SWIM_RISE_ACCELERATION,
  TERMINAL_VELOCITY,
  WATER_BUOYANCY,
  WATER_DRAG,
  WATER_TERMINAL_VELOCITY,
  bodyAabb,
  createJumpState,
  flowAt,
  isFluidBlock,
  moveWithCollisions,
  solidWorldFromBlocks,
  stepJumpAssist,
  stepPhysics,
  submersion,
  swimVelocity,
} from "../src/core/physics.js";
import type { JumpState, SolidWorld } from "../src/core/physics.js";
import { BlockId } from "../src/core/types.js";

/** A sea three blocks deep in the column the test body occupies. */
function seaWorld(): SolidWorld {
  return solidWorldFromBlocks(
    [],
    [
      [0, 0, 0],
      [0, 1, 0],
      [0, 2, 0],
    ],
  );
}

/**
 * The jump assist, tick by tick. Ported from engineCheck section 12 so the
 * vitest surface — not just the self-check — pins the forgiveness windows.
 */
describe("the jump assist (coyote time and jump buffering)", () => {
  it("starts with no grace, no remembered press and no held key", () => {
    expect(createJumpState()).toEqual({ coyoteTicks: 0, bufferTicks: 0, heldLastTick: false });
  });

  it("remembers the forgiveness windows in ticks, not seconds", () => {
    // The windows are stated in TICKS on purpose: the behaviour must not
    // depend on the frame rate the caller happens to run at.
    expect(COYOTE_TICKS).toBe(6);
    expect(JUMP_BUFFER_TICKS).toBe(6);
  });

  it("a press on the ground jumps at once", () => {
    const result = stepJumpAssist(createJumpState(), { jumpHeld: true, onGround: true });
    expect(result.jumped).toBe(true);
    // The jump spends the grace behind it.
    expect(result.state.coyoteTicks).toBe(0);
    expect(result.state.bufferTicks).toBe(0);
  });

  it("holding the key does not jump again", () => {
    // Only the RISING EDGE of the key counts, so holding it does not
    // bounce the player off the floor.
    let state: JumpState = createJumpState();
    state = stepJumpAssist(state, { jumpHeld: true, onGround: true }).state;
    const second = stepJumpAssist(state, { jumpHeld: true, onGround: true });
    expect(second.jumped).toBe(false);
  });

  it("a press just after leaving the ground still jumps", () => {
    let state: JumpState = createJumpState();
    state = stepJumpAssist(state, { jumpHeld: false, onGround: true }).state;
    const press = stepJumpAssist(state, { jumpHeld: true, onGround: false });
    expect(press.jumped).toBe(true);
    expect(press.state.coyoteTicks).toBe(0);
  });

  it(`the coyote window is exactly ${COYOTE_TICKS} ticks and it expires`, () => {
    const jumpsAfter = (ticks: number): boolean => {
      let state: JumpState = createJumpState();
      state = stepJumpAssist(state, { jumpHeld: false, onGround: true }).state;
      for (let i = 0; i < ticks; i++) {
        state = stepJumpAssist(state, { jumpHeld: false, onGround: false }).state;
      }
      return stepJumpAssist(state, { jumpHeld: true, onGround: false }).jumped;
    };
    // Every tick inside the window jumps; the FIRST tick outside does not.
    for (let i = 0; i <= COYOTE_TICKS - 1; i++) {
      expect(jumpsAfter(i)).toBe(true);
    }
    expect(jumpsAfter(COYOTE_TICKS)).toBe(false);
    // ...and it stays expired.
    expect(jumpsAfter(COYOTE_TICKS + 2)).toBe(false);
  });

  it("a press too early is remembered, and fires the moment the body lands", () => {
    let state: JumpState = createJumpState();
    state = stepJumpAssist(state, { jumpHeld: false, onGround: true }).state;
    // Out of coyote grace now.
    for (let i = 0; i < COYOTE_TICKS; i++) {
      state = stepJumpAssist(state, { jumpHeld: false, onGround: false }).state;
    }
    const early = stepJumpAssist(state, { jumpHeld: true, onGround: false });
    // The press does NOT jump here; it waits for the landing.
    expect(early.jumped).toBe(false);
    expect(early.state.bufferTicks).toBe(JUMP_BUFFER_TICKS);

    const landed = stepJumpAssist(early.state, { jumpHeld: false, onGround: true });
    expect(landed.jumped).toBe(true);
    // The remembered press is spent, and resets the grace with it.
    expect(landed.state.bufferTicks).toBe(0);
    expect(landed.state.coyoteTicks).toBe(0);
  });

  it("a press long before the landing is forgotten", () => {
    let state: JumpState = createJumpState();
    state = stepJumpAssist(state, { jumpHeld: false, onGround: true }).state;
    for (let i = 0; i < COYOTE_TICKS; i++) {
      state = stepJumpAssist(state, { jumpHeld: false, onGround: false }).state;
    }
    state = stepJumpAssist(state, { jumpHeld: true, onGround: false }).state;
    // The buffer outlives its own window, so the landing is too late.
    for (let i = 0; i < JUMP_BUFFER_TICKS; i++) {
      state = stepJumpAssist(state, { jumpHeld: false, onGround: false }).state;
    }
    expect(state.bufferTicks).toBe(0);
    const landed = stepJumpAssist(state, { jumpHeld: false, onGround: true });
    expect(landed.jumped).toBe(false);
  });

  it("a ground jump does not leave coyote grace behind it", () => {
    const first = stepJumpAssist(createJumpState(), { jumpHeld: true, onGround: true });
    expect(first.jumped).toBe(true);
    const airborne = stepJumpAssist(first.state, { jumpHeld: false, onGround: false }).state;
    // A second press within what WOULD be the coyote window is refused:
    // the ground jump spent it.
    const again = stepJumpAssist(airborne, { jumpHeld: true, onGround: false });
    expect(again.jumped).toBe(false);
  });

  it("the same input history always gives the same jump", () => {
    // Pure: no clock, no hidden state. The input history is the whole of
    // what the assist knows, so the same history is the same jump.
    const run = (): string => {
      let state: JumpState = createJumpState();
      const out: string[] = [];
      for (let i = 0; i < 40; i++) {
        const result = stepJumpAssist(state, {
          jumpHeld: i === 3 || i === 20,
          onGround: i % 7 === 0,
        });
        state = result.state;
        out.push(result.jumped ? "1" : "0");
      }
      return out.join("");
    };
    expect(run()).toBe(run());
  });
});

/**
 * The hardened step-up (T90). Ported from engineCheck section 13: the
 * step-up must walk a one-block ledge, and must NOT be a way to climb a
 * wall.
 */
describe("the hardened step-up", () => {
  it(`one move raises the body by at most STEP_HEIGHT (${STEP_HEIGHT})`, () => {
    // A diagonal staircase. However many axes step up in one move, the
    // total rise is bounded — climbing two blocks by moving diagonally
    // into their corner is the wall-climb the budget forbids.
    const stair: Array<[number, number, number]> = [];
    for (let i = 0; i < 4; i++) {
      stair.push([i, i, 0]);
      stair.push([i, i, 1]);
    }
    const result = moveWithCollisions(
      { x: 0.5, y: 1, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0.5 },
      solidWorldFromBlocks(stair),
    );
    expect(result.position.y - 1).toBeLessThanOrEqual(STEP_HEIGHT + 1e-9);
    // It is exactly one block up, on the first step.
    expect(result.position.x).toBeCloseTo(1, 10);
    expect(result.position.y).toBeCloseTo(2, 10);
    expect(result.position.z).toBeCloseTo(1, 10);
  });

  it("a stepped ledge reached along Z walks up exactly as X does", () => {
    // The step-up is symmetric in the horizontal axes: the same
    // one-block budget applies on the Z axis, which is its own call
    // site in the collision code.
    const result = moveWithCollisions(
      { x: 0.5, y: 1, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0.5 },
      solidWorldFromBlocks([
        [0, 0, 0],
        [0, 1, 1],
      ]),
    );
    // Walked up onto the ledge: a block forward, one up, no collision.
    expect(result.position.x).toBeCloseTo(0.5, 10);
    expect(result.position.y).toBeCloseTo(2, 10);
    expect(result.position.z).toBeCloseTo(1, 10);
    expect(result.collided).toBe(false);
  });

  it("a rising body does not step up", () => {
    // A body that is moving upward is jumping, and a jumping body that
    // steps onto ledges would turn every wall into a staircase.
    const ledge = solidWorldFromBlocks([
      [0, 0, 0],
      [1, 1, 0],
    ]);
    const result = moveWithCollisions(
      { x: 0.5, y: 1, z: 0.5 },
      { x: 3, y: 8, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      ledge,
    );
    expect(result.collided).toBe(true);
    // Stopped flush against the ledge, at the height it started at.
    expect(result.position.x).toBeCloseTo(1 - 0.3, 10);
    expect(result.position.y).toBeCloseTo(1, 10);
  });

  it("a body whose head is inside a block does not step up off that block", () => {
    // The ground probe is a thin slab under the feet, not the whole body:
    // a body whose head is inside a block is not standing on it.
    const world = solidWorldFromBlocks([
      [0, 0, 0],
      [0, 3, 0],
      [1, 1, 0],
    ]);
    const result = moveWithCollisions(
      { x: 0.5, y: 1.2, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      world,
    );
    expect(result.position.y).toBeCloseTo(1.2, 10);
    expect(result.collided).toBe(true);
  });

  it("a body in mid-air with nothing under it does not step up", () => {
    const result = moveWithCollisions(
      { x: 0.5, y: 1.2, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      solidWorldFromBlocks([[1, 1, 0]]),
    );
    expect(result.position.y).toBeCloseTo(1.2, 10);
    expect(result.collided).toBe(true);
  });

  it("a step with a lid over it is not walked up", () => {
    // There must be ROOM for the body at the raised position: a step whose
    // top has a block directly over the head refuses the step-up.
    const world = solidWorldFromBlocks([
      [0, 0, 0],
      [1, 1, 0],
      [1, 2, 0],
    ]);
    const result = moveWithCollisions(
      { x: 0.5, y: 1, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      world,
    );
    expect(result.collided).toBe(true);
    expect(result.position.x).toBeCloseTo(1 - 0.3, 10);
    expect(result.position.y).toBeCloseTo(1, 10);
  });
});

/**
 * The landing on a solid the feet STARTED inside. The only way out of a
 * solid is out of its top, so a falling body that starts buried is pushed
 * up onto the block — not left inside it, and not snapped under it.
 */
describe("the landing inside a solid", () => {
  it("a falling body started inside the floor is pushed up onto it", () => {
    // The floor block owns y = 0..1, and the feet began at y = 0.5,
    // inside it. No block top lies below where the feet started, so the
    // ordinary landing rule does not apply — the push-up does.
    const result = moveWithCollisions(
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: -0.25, z: 0 },
      solidWorldFromBlocks([[0, 0, 0]]),
    );
    // On TOP of the block it started inside: feet exactly at y=1.
    expect(result.position.y).toBe(1);
    expect(result.position.x).toBe(0.5);
    expect(result.position.z).toBe(0.5);
    // At rest on the ground, the fall spent, and it counted as a hit.
    expect(result.onGround).toBe(true);
    expect(result.velocity.y).toBe(0);
    expect(result.collided).toBe(true);
  });
});

/**
 * The water: submersion, buoyancy, swimming and the current.
 */
describe("the water: submersion and buoyancy", () => {
  it("only tidewater is a fluid", () => {
    expect(isFluidBlock(BlockId.Tidewater)).toBe(true);
    expect(isFluidBlock(BlockId.Slate)).toBe(false);
    expect(isFluidBlock(BlockId.Loam)).toBe(false);
    expect(isFluidBlock(BlockId.Air)).toBe(false);
  });

  it("the water constants keep their promises about the rates", () => {
    // Buoyancy equal to gravity, so the two shares cross at half-submerged.
    expect(WATER_BUOYANCY).toBe(GRAVITY);
    expect(SWIM_RISE_ACCELERATION).toBe(GRAVITY);
    // Water is slow and thick: far below the terminal velocity in air.
    expect(WATER_TERMINAL_VELOCITY).toBeLessThan(TERMINAL_VELOCITY);
    expect(WATER_TERMINAL_VELOCITY).toBe(4);
    expect(WATER_DRAG).toBe(4);
    expect(SWIM_SPEED).toBeLessThan(3);
    expect(SWIM_ACCELERATION).toBeGreaterThan(SWIM_SPEED);
    expect(FLOW_SPEED).toBeLessThan(SWIM_SPEED);
  });

  it("a world that cannot answer isFluid has no water at all", () => {
    // The isFluid query is OPTIONAL: a world without it is entirely dry.
    const dryWorld: SolidWorld = { isSolid: () => false };
    const box = bodyAabb({ x: 0.5, y: 1, z: 0.5 });
    expect(submersion(box, dryWorld)).toBe(0);
    expect(flowAt(dryWorld, 0, 5, 0)).toEqual({ x: 0, y: 0, z: 0 });
    const result = stepPhysics({ x: 0.5, y: 1, z: 0.5 }, { x: 0, y: 0, z: 0 }, 1 / 60, dryWorld);
    expect(result.velocity.y).toBeCloseTo(-GRAVITY / 60, 12);
  });

  it("an empty body measures as fully dry, fluid or not", () => {
    // A zero-volume box has nothing to wet.
    const box = bodyAabb({ x: 0.5, y: 1, z: 0.5 }, 0.3, 0);
    expect(box.maxY).toBe(box.minY);
    expect(submersion(box, seaWorld())).toBe(0);
  });

  it("a body in open air is dry", () => {
    const box = bodyAabb({ x: 0.5, y: 10, z: 0.5 });
    expect(submersion(box, seaWorld())).toBe(0);
  });

  it("a fully submerged body measures as fully wet", () => {
    const box = bodyAabb({ x: 0.5, y: 0.5, z: 0.5 });
    expect(submersion(box, seaWorld())).toBeCloseTo(1, 10);
  });

  it("a body leaving the water is measured continuously, then dry", () => {
    // The sea's top face is at y=3. A body whose feet sit at y=2 exactly
    // (its box spans 2 to 3.8) has 1 of its 1.8 height in the water.
    const standing = submersion(bodyAabb({ x: 0.5, y: 2, z: 0.5 }), seaWorld());
    expect(standing).toBeCloseTo(1 / 1.8, 6);
    // Higher up, less wet: half a block of the box above the surface
    // leaves half a block of height under water.
    const higher = submersion(bodyAabb({ x: 0.5, y: 2.5, z: 0.5 }), seaWorld());
    expect(higher).toBeCloseTo(0.5 / 1.8, 6);
    expect(higher).toBeLessThan(standing);
    // And clear of the surface, dry.
    expect(submersion(bodyAabb({ x: 0.5, y: 3.5, z: 0.5 }), seaWorld())).toBe(0);
  });

  it("a fully submerged body is capped at the WATER terminal velocity, in both directions", () => {
    const sea = seaWorld();
    // A plunge into water is a glide: however fast the body arrives, it
    // cannot keep falling faster than WATER_TERMINAL_VELOCITY.
    const falling = stepPhysics({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: -60, z: 0 }, 1 / 60, sea);
    expect(falling.velocity.y).toBe(-WATER_TERMINAL_VELOCITY);
    // A stroke that would launch the body out of the sea is capped too.
    let rising = { x: 0, y: WATER_TERMINAL_VELOCITY + 10, z: 0 };
    for (let i = 0; i < 30; i++) {
      rising = stepPhysics({ x: 0.5, y: 0.5, z: 0.5 }, rising, 1 / 60, sea, { rise: true }).velocity;
      expect(rising.y).toBeLessThanOrEqual(WATER_TERMINAL_VELOCITY);
    }
  });

  it("a swim stroke lifts the body toward the surface", () => {
    let velocity = { x: 0, y: 0, z: 0 };
    let position = { x: 0.5, y: 0.5, z: 0.5 };
    for (let i = 0; i < 30; i++) {
      const result = stepPhysics(position, velocity, 1 / 60, seaWorld(), { rise: true });
      position = result.position;
      velocity = result.velocity;
      expect(velocity.y).toBeGreaterThan(0);
    }
    // Holding the rise control is a climb, not a launch: the body is
    // well under the speed it would reach falling in AIR.
    expect(velocity.y).toBeGreaterThan(3);
    expect(velocity.y).toBeLessThanOrEqual(WATER_TERMINAL_VELOCITY);
  });

  it("a half-submerged body holds its depth", () => {
    // The sea's top face is at y=2. Feet at y=1.1 put exactly half the
    // body's height under water, and there buoyancy equals the remaining
    // weight's pull: no net force, so a still body holds.
    const half = solidWorldFromBlocks([], [
      [0, 0, 0],
      [0, 1, 0],
    ]);
    const feet = { x: 0.5, y: 1.1, z: 0.5 };
    expect(submersion(bodyAabb(feet), half)).toBeCloseTo(0.5, 6);
    const result = stepPhysics(feet, { x: 0, y: 0, z: 0 }, 1 / 60, half);
    expect(result.velocity.y).toBeCloseTo(0, 6);
    expect(result.position.y).toBeCloseTo(1.1, 9);
    expect(result.onGround).toBe(false);
  });

  it("a sinking body in deep water glides down instead of plunging", () => {
    let velocity = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 200; i++) {
      velocity = stepPhysics({ x: 0.5, y: 0.5, z: 0.5 }, velocity, 1 / 60, seaWorld()).velocity;
      expect(velocity.y).toBeGreaterThanOrEqual(-WATER_TERMINAL_VELOCITY);
    }
  });
});

describe("the water: swimming and the current", () => {
  it("a dry body walks at the wish, exactly", () => {
    // The wish is the horizontal velocity straight out — walking on land
    // is not a negotiation, so swimVelocity only intervenes when wet.
    const dry = solidWorldFromBlocks([[0, 0, 0]]);
    const above = { x: 0.5, y: 5, z: 0.5 };
    expect(swimVelocity(above, { x: -9, y: -5, z: -7 }, 1, 0, 1 / 60, dry)).toEqual({
      x: 1,
      y: -5,
      z: 0,
    });
  });

  it("a swim stroke accelerates toward the wish at SWIM_ACCELERATION", () => {
    // From rest, one 60 Hz tick of a wish length 1 adds exactly
    // SWIM_ACCELERATION * dt along the wish.
    const result = swimVelocity(
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: 0, y: -7, z: 0 },
      1,
      0,
      1 / 60,
      seaWorld(),
    );
    expect(result.x).toBeCloseTo(SWIM_ACCELERATION / 60, 10);
    expect(result.y).toBeCloseTo(-7, 10);
    expect(result.z).toBe(0);
  });

  it("a swim stroke is capped at SWIM_SPEED no matter how hard the wish", () => {
    // Many ticks of a hard push converge on the swim speed and stay there.
    let velocity = { x: 0, y: 0, z: 0 };
    const position = { x: 0.5, y: 0.5, z: 0.5 };
    for (let i = 0; i < 200; i++) {
      velocity = swimVelocity(position, velocity, 40, 0, 1 / 60, seaWorld());
      expect(Math.hypot(velocity.x, velocity.z)).toBeLessThanOrEqual(SWIM_SPEED + 1e-9);
    }
    expect(velocity.x).toBeCloseTo(SWIM_SPEED, 6);
    expect(velocity.z).toBeCloseTo(0, 9);
  });

  it("a swimmer who lets go coasts to a stop instead of sliding forever", () => {
    let velocity = swimVelocity({ x: 0.5, y: 0.5, z: 0.5 }, { x: 5, y: 0, z: 0 }, 0, 0, 1 / 60, seaWorld());
    for (let i = 0; i < 200; i++) {
      velocity = swimVelocity({ x: 0.5, y: 0.5, z: 0.5 }, velocity, 0, 0, 1 / 60, seaWorld());
    }
    expect(Math.abs(velocity.x)).toBeLessThan(0.001);
    expect(Math.abs(velocity.z)).toBeLessThan(0.001);
  });

  it("the current is a pull toward the deeper neighbour, at FLOW_SPEED", () => {
    // Two columns: the body's column is two blocks deep from y=2, the
    // neighbour at +X is three blocks deep. The current is a pure
    // function of the world: it reads depth counts, nothing else.
    const world = solidWorldFromBlocks(
      [],
      [
        [0, 2, 0],
        [0, 1, 0],
        [1, 2, 0],
        [1, 1, 0],
        [1, 0, 0],
      ],
    );
    const flow = flowAt(world, 0.5, 2.5, 0.5);
    // drop = 1, so the speed is min(FLOW_SPEED, 1 * 0.25).
    expect(flow).toEqual({ x: Math.min(FLOW_SPEED, 0.25), y: 0, z: 0 });
    // The current is stronger for a bigger drop — but a DROP of less
    // than four blocks never reaches FLOW_SPEED, and four blocks of drop
    // would be a speed of 1, the ceiling FLOW_SPEED keeps it under.
    const steeper = solidWorldFromBlocks(
      [],
      [
        [0, 4, 0],
        [1, 4, 0],
        [1, 3, 0],
        [1, 2, 0],
      ],
    );
    // Two blocks of drop: a speed of 2 * 0.25, rising toward the cap.
    expect(flowAt(steeper, 0.5, 4.5, 0.5)).toEqual({ x: 0.5, y: 0, z: 0 });
    const steepest = solidWorldFromBlocks(
      [],
      [
        [0, 4, 0],
        [1, 4, 0],
        [1, 3, 0],
        [1, 2, 0],
        [1, 1, 0],
        [1, 0, 0],
      ],
    );
    // Four blocks of drop would be a speed of 1, and FLOW_SPEED is the
    // ceiling, so the strongest current there is is exactly FLOW_SPEED.
    expect(flowAt(steepest, 0.5, 4.5, 0.5)).toEqual({ x: FLOW_SPEED, y: 0, z: 0 });
  });

  it("open water is calm, and a point out of the water has no current", () => {
    const world = solidWorldFromBlocks(
      [],
      [
        [0, 1, 0],
        [0, 0, 0],
        [1, 1, 0],
        [1, 0, 0],
        [0, 1, 1],
        [0, 0, 1],
        [1, 1, 1],
        [1, 0, 1],
      ],
    );
    // Every neighbour the same depth as this one: no pull any way.
    expect(flowAt(world, 0.5, 1.5, 0.5)).toEqual({ x: 0, y: 0, z: 0 });
    // And dry ground has no current at all.
    expect(flowAt(world, 3.5, 9.5, 3.5)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("the current is part of the stroke's target, and is rate-limited with it", () => {
    // A wish-less stroke in a current drifts AT the current's speed (the
    // rate limit is generous enough): the flow is added on top of the
    // stroke's own target.
    const drifted = solidWorldFromBlocks(
      [],
      [
        [0, 2, 0],
        [0, 1, 0],
        [1, 2, 0],
        [1, 1, 0],
        [1, 0, 0],
      ],
    );
    const result = swimVelocity(
      { x: 0.5, y: 2.5, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      0,
      0,
      1 / 60,
      drifted,
    );
    expect(result.x).toBeCloseTo(Math.min(FLOW_SPEED, 0.25), 10);
    expect(result.z).toBe(0);
  });
});
