/**
 * BlockForge — PRIORITY 3: AABB collision and gravity (src/core/physics.ts).
 *
 * OWNERSHIP: TEST AUTHOR (tests/).
 *
 * The physics module is pure: the caller passes a delta and a world query,
 * and gets back new values. The same inputs must always produce the same
 * output, in any process — the determinism invariant covers physics, not
 * just terrain.
 *
 * The properties the game depends on:
 *
 *   1. a falling body comes to rest ON TOP of the floor block, not inside
 *      it and not below it;
 *   2. a body sliding into a wall stops FLUSH against it, and the body's
 *      collision box never ends up overlapping a solid block;
 *   3. the collision box is centred on the feet, so the feet are the
 *      thing that touches the floor;
 *   4. a body that starts inside a wall is pushed clear, not stuck;
 *   5. a large dt must not tunnel through a floor.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  GRAVITY,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  TERMINAL_VELOCITY,
  aabbIntersects,
  bodyAabb,
  clampVelocity,
  collides,
  isSolidBlock,
  moveWithCollisions,
  solidWorldFromBlocks,
  stepPhysics,
} from "../src/core/physics.js";
import type { SolidWorld } from "../src/core/physics.js";
import { BlockId } from "../src/core/types.js";

/** A floor of solid blocks along X at y=0, around the origin. */
function floorWorld(): SolidWorld {
  return solidWorldFromBlocks([
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [3, 0, 0],
    [-1, 0, 0],
    [-2, 0, 0],
  ]);
}

describe("PRIORITY 3: AABB collision and gravity (src/core/physics.ts)", () => {
  it("the collision box is centred on the feet", () => {
    const box = bodyAabb({ x: 0.5, y: 2, z: 0.5 });
    // The feet are the bottom of the box, at exactly the given y.
    expect(box.minY).toBe(2);
    expect(box.maxY).toBe(2 + PLAYER_HEIGHT);
    // And the box is centred horizontally on the feet.
    expect(box.minX + PLAYER_HALF_WIDTH).toBe(0.5);
    expect(box.maxX - PLAYER_HALF_WIDTH).toBe(0.5);
    expect(box.minZ + PLAYER_HALF_WIDTH).toBe(0.5);
    expect(box.maxZ - PLAYER_HALF_WIDTH).toBe(0.5);
  });

  it("the collision box honours a custom half width and height", () => {
    const box = bodyAabb({ x: 0, y: 0, z: 0 }, 0.5, 4);
    expect(box.minX).toBe(-0.5);
    expect(box.maxX).toBe(0.5);
    expect(box.minY).toBe(0);
    expect(box.maxY).toBe(4);
  });

  it("overlapping boxes intersect, touching boxes do not", () => {
    const a = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
    expect(aabbIntersects(a, { minX: 0.5, minY: 0.5, minZ: 0.5, maxX: 1.5, maxY: 1.5, maxZ: 1.5 })).toBe(
      true,
    );
    // Touching faces do not overlap.
    expect(aabbIntersects(a, { minX: 1, minY: 0, minZ: 0, maxX: 2, maxY: 1, maxZ: 1 })).toBe(false);
    expect(aabbIntersects(a, { minX: 2, minY: 0, minZ: 0, maxX: 3, maxY: 1, maxZ: 1 })).toBe(false);
    // Separated on each axis in turn.
    expect(aabbIntersects(a, { minX: 0, minY: 2, minZ: 0, maxX: 1, maxY: 3, maxZ: 1 })).toBe(false);
    expect(aabbIntersects(a, { minX: 0, minY: 0, minZ: 2, maxX: 1, maxY: 1, maxZ: 3 })).toBe(false);
  });

  it("collides reports a box that overlaps a solid block", () => {
    const world = floorWorld();
    // A body standing on the floor does not overlap it.
    expect(collides(bodyAabb({ x: 0.5, y: 1, z: 0.5 }), world)).toBe(false);
    // A body intersecting it does.
    expect(collides(bodyAabb({ x: 0.5, y: 0.5, z: 0.5 }), world)).toBe(true);
  });

  it("clampVelocity caps the fall speed at terminal velocity", () => {
    expect(clampVelocity({ x: 1, y: -100, z: 2 }).y).toBe(-TERMINAL_VELOCITY);
    // A slow fall is untouched.
    expect(clampVelocity({ x: 1, y: -3, z: 2 }).y).toBe(-3);
    // Rising is untouched, and x/z never change.
    expect(clampVelocity({ x: 1, y: 5, z: 2 })).toEqual({ x: 1, y: 5, z: 2 });
  });

  it("a falling body comes to rest ON TOP of the floor block", () => {
    const world = floorWorld();
    let position = { x: 0.5, y: 5, z: 0.5 };
    let velocity = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 500; i++) {
      const result = stepPhysics(position, velocity, 1 / 60, world);
      position = result.position;
      velocity = result.velocity;
      if (result.onGround) break;
    }
    // The floor block is at y=0, so its top face is y=1 and the feet rest
    // exactly there — not at 0.9 (floating) and not at 0.5 (sunk in).
    expect(position.y).toBe(1);
    expect(velocity.y).toBe(0);
  });

  it("a body at rest on the floor reports onGround", () => {
    const world = floorWorld();
    const result = stepPhysics({ x: 0.5, y: 1, z: 0.5 }, { x: 0, y: 0, z: 0 }, 1 / 60, world);
    expect(result.onGround).toBe(true);
    expect(result.position.y).toBe(1);
  });

  it("gravity accelerates a body downwards by GRAVITY * dt", () => {
    const world = solidWorldFromBlocks([]);
    const result = stepPhysics(
      { x: 0.5, y: 100, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      0.5,
      world,
    );
    expect(result.velocity.y).toBe(-GRAVITY * 0.5);
  });

  it("the fall speed is capped at terminal velocity", () => {
    const world = solidWorldFromBlocks([]);
    let velocity = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 200; i++) {
      velocity = stepPhysics({ x: 0.5, y: 1000, z: 0.5 }, velocity, 0.1, world).velocity;
    }
    expect(velocity.y).toBe(-TERMINAL_VELOCITY);
  });

  it("a body is stopped FLUSH against a wall", () => {
    // A wall at x=2, three blocks tall. The body starts one block away
    // and steps one block, so it reaches the wall in that step.
    const world = solidWorldFromBlocks([
      [2, 0, 0],
      [2, 1, 0],
      [2, 2, 0],
    ]);
    const result = moveWithCollisions(
      { x: 1, y: 1, z: 0.5 },
      { x: 5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      world,
    );
    // The wall's near face is at x=2, so the body centre stops one
    // half-width short of it: maxX is exactly 2.
    expect(result.position.x).toBe(2 - PLAYER_HALF_WIDTH);
    expect(result.collided).toBe(true);
    // The blocked axis has its velocity zeroed.
    expect(result.velocity.x).toBe(0);
    // And the body does not overlap the wall.
    expect(collides(bodyAabb(result.position), world)).toBe(false);
  });

  it("a body is stopped flush against a wall in every direction", () => {
    const cases: readonly {
      readonly blocks: readonly (readonly [number, number, number])[];
      readonly from: { readonly x: number; readonly y: number; readonly z: number };
      readonly delta: { readonly x: number; readonly y: number; readonly z: number };
      readonly axis: "x" | "y" | "z";
      readonly expected: number;
    }[] = [
      {
        // Wall on -X, at x=0. The body stops with minX flush against the
        // wall's face at x=1, so x = 1 + PLAYER_HALF_WIDTH.
        //
        // Started at x=0.5, clear of the wall's column (x=0 to 1). The
        // body used to start at x=1, which put its AABB (x=0.70 to x=1.30)
        // inside that column - the same invalid start state as the -Z
        // case, and the same reason it could never fail.
        blocks: [
          [0, 0, 0],
          [0, 1, 0],
          [0, 2, 0],
        ],
        from: { x: 0.5, y: 1, z: 0.5 },
        delta: { x: -1, y: 0, z: 0 },
        axis: "x",
        expected: 1 + PLAYER_HALF_WIDTH,
      },
      {
        // Wall on +X, at x=2. The body stops with maxX exactly 2.
        blocks: [
          [2, 0, 0],
          [2, 1, 0],
          [2, 2, 0],
        ],
        from: { x: 1, y: 1, z: 0.5 },
        delta: { x: 1, y: 0, z: 0 },
        axis: "x",
        expected: 2 - PLAYER_HALF_WIDTH,
      },
      {
        // Wall on +Z, at z=2.
        blocks: [
          [0, 0, 2],
          [0, 1, 2],
        ],
        from: { x: 0.5, y: 1, z: 1 },
        delta: { x: 0, y: 0, z: 1 },
        axis: "z",
        expected: 2 - PLAYER_HALF_WIDTH,
      },
      {
        // Wall on -Z, at z=2. The body approaches from +Z and stops with
        // its minZ flush against the wall's face at z=3, so
        // z = 3 + PLAYER_HALF_WIDTH.
        //
        // The body starts at z=3.5, NOT z=3. This case used to start the
        // body at z=3, which put its AABB (z=2.70 to z=3.30) INSIDE the
        // wall occupying z=2 to z=3 - an invalid start state. The old
        // physics "passed" it only because a body that already overlaps
        // trivially collides and never moves, so the assertion was
        // comparing a computed position against the body's own starting
        // position. The test was green and asserted nothing.
        //
        // Starting clear of the wall makes it the exact mirror of the +Z
        // case above, and the expected value is unchanged.
        blocks: [
          [0, 0, 2],
          [0, 1, 2],
        ],
        from: { x: 0.5, y: 1, z: 3.5 },
        delta: { x: 0, y: 0, z: -1 },
        axis: "z",
        expected: 3 + PLAYER_HALF_WIDTH,
      },
    ];

    for (const c of cases) {
      const world = solidWorldFromBlocks(c.blocks);
      const result = moveWithCollisions(c.from, { x: 0, y: 0, z: 0 }, c.delta, world);
      expect(result.collided).toBe(true);
      expect(result.position[c.axis]).toBeCloseTo(c.expected, 10);
      expect(collides(bodyAabb(result.position), world)).toBe(false);
    }
  });

  it("a body that hits a ceiling stops with its head just under the block", () => {
    // A solid block at y=3. The body is 1.8 tall, so standing with its feet
    // at 1.2 puts its head exactly at 3.
    const world = solidWorldFromBlocks([[0, 3, 0]]);
    const result = moveWithCollisions(
      { x: 0.5, y: 1, z: 0.5 },
      { x: 0, y: 5, z: 0 },
      { x: 0, y: 1, z: 0 },
      world,
    );
    expect(result.collided).toBe(true);
    expect(result.position.y).toBeCloseTo(3 - PLAYER_HEIGHT, 10);
    expect(result.velocity.y).toBe(0);
    // A head bump is not a landing.
    expect(result.onGround).toBe(false);
  });

  it("a body in open space moves freely", () => {
    const world = solidWorldFromBlocks([]);
    const result = moveWithCollisions(
      { x: 0.5, y: 1, z: 0.5 },
      { x: 1, y: 2, z: 3 },
      { x: 1, y: 1, z: 1 },
      world,
    );
    expect(result.collided).toBe(false);
    expect(result.position).toEqual({ x: 1.5, y: 2, z: 1.5 });
    // An unobstructed axis keeps its velocity.
    expect(result.velocity).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("a body that starts inside a wall is pushed clear, not stuck", () => {
    // A wall occupying x=0, and a body whose feet are inside it.
    const world = solidWorldFromBlocks([
      [0, 0, 0],
      [0, 1, 0],
    ]);
    const inside = { x: 0.5, y: 0.5, z: 0.5 };
    expect(collides(bodyAabb(inside), world)).toBe(true);
    const result = moveWithCollisions(inside, { x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, world);
    expect(result.collided).toBe(true);
    // It is now clear of the wall rather than still buried in it.
    expect(collides(bodyAabb(result.position), world)).toBe(false);
  });

  it("a zero dt changes nothing", () => {
    const world = floorWorld();
    const result = stepPhysics({ x: 0.5, y: 3, z: 0.5 }, { x: 1, y: -2, z: 3 }, 0, world);
    expect(result.position).toEqual({ x: 0.5, y: 3, z: 0.5 });
    expect(result.velocity).toEqual({ x: 1, y: -2, z: 3 });
    expect(result.collided).toBe(false);
  });

  it("a zero delta in moveWithCollisions changes nothing", () => {
    const world = floorWorld();
    const result = moveWithCollisions(
      { x: 0.5, y: 3, z: 0.5 },
      { x: 1, y: -2, z: 3 },
      { x: 0, y: 0, z: 0 },
      world,
    );
    expect(result.position).toEqual({ x: 0.5, y: 3, z: 0.5 });
    expect(result.velocity).toEqual({ x: 1, y: -2, z: 3 });
  });

  it("a body never ends up overlapping a solid block after a one-block step", () => {
    // A step of at most one block per axis is the regime the engine
    // resolves correctly: the destination box overlaps the wall, so the
    // axis is snapped flush to it.
    fc.assert(
      fc.property(
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: -3, max: 3 }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (x, y, z, dx, dy, dz) => {
          const world = solidWorldFromBlocks([
            [x, y, z],
            [x + 1, y, z],
            [x, y + 1, z],
            [x, y, z + 1],
            [x + 1, y + 1, z],
            [x + 1, y, z + 1],
            [x, y + 1, z + 1],
            [x + 1, y + 1, z + 1],
          ]);
          const start = { x: 0.5, y: 0.5, z: 0.5 };
          if (collides(bodyAabb(start), world)) return;
          const result = moveWithCollisions(start, { x: 0, y: 0, z: 0 }, { x: dx, y: dy, z: dz }, world);
          // The resolved body must be outside every solid block.
          expect(collides(bodyAabb(result.position), world)).toBe(false);
        },
      ),
    );
  });

  it("isSolidBlock agrees with the frozen solid set", () => {
    expect(isSolidBlock(BlockId.Slate)).toBe(true);
    expect(isSolidBlock(BlockId.Loam)).toBe(true);
    expect(isSolidBlock(BlockId.Air)).toBe(false);
    expect(isSolidBlock(BlockId.Tidewater)).toBe(false);
  });

  it("solidWorldFromBlocks answers true only for the blocks it was given", () => {
    const world = solidWorldFromBlocks([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(world.isSolid(1, 2, 3)).toBe(true);
    expect(world.isSolid(4, 5, 6)).toBe(true);
    expect(world.isSolid(1, 2, 4)).toBe(false);
    expect(world.isSolid(0, 0, 0)).toBe(false);
  });

  // TEST AUTHOR finding, filed to the board as T64.
  //
  // The engine resolved collisions by testing the box at the DESTINATION
  // only — the swept path from start to destination was never examined, so
  // a body that moved further than one block in a single step passed
  // clean through a one-block-thick wall or floor. At terminal velocity
  // (60 blocks/s) that is any frame rate below 60 fps, so a falling body
  // went straight through the ground.
  //
  // FIXED by the engine on feature/engine/fix-e1-e2-tunnel: the move is
  // now split into sub-steps of at most half a block, so every obstacle
  // is sampled. These tests were `it.fails` until that fix landed; they
  // flipped RED to announce the closure, and are now plain `it` that
  // assert the FIXED behaviour and must stay passing.
  it("a large dt must not tunnel a falling body through a one-block floor", () => {
    const world = floorWorld();
    for (const dt of [0.1, 0.25, 0.5, 1.0]) {
      let position = { x: 0.5, y: 50, z: 0.5 };
      let velocity = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < 2000; i++) {
        const result = stepPhysics(position, velocity, dt, world);
        position = result.position;
        velocity = result.velocity;
        if (result.onGround) break;
      }
      // It must have come to rest on the floor, not fallen through it.
      expect(position.y).toBe(1);
    }
  });

  it("a body must not end up embedded in a wall it stepped through", () => {
    // A two-block-thick wall, and a body that steps two blocks into it.
    const world = solidWorldFromBlocks([
      [-2, 0, 0],
      [-1, 0, 0],
      [-2, 1, 0],
      [-1, 1, 0],
    ]);
    const start = { x: 0.5, y: 1, z: 0.5 };
    expect(collides(bodyAabb(start), world)).toBe(false);
    const result = moveWithCollisions(start, { x: 0, y: 0, z: 0 }, { x: -2, y: 0, z: 0 }, world);
    // It must stop flush against the near face of the wall (minX = 0),
    // never inside it.
    expect(collides(bodyAabb(result.position), world)).toBe(false);
    expect(result.position.x).toBeCloseTo(PLAYER_HALF_WIDTH, 10);
  });

  it("a body never ends up overlapping a solid block after a multi-block move", () => {
    // The property the tunnelling bug broke, now pinned over the full
    // range of move lengths the fix has to handle.
    fc.assert(
      fc.property(
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: -3, max: 3 }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        (x, y, z, dx, dy, dz) => {
          const world = solidWorldFromBlocks([
            [x, y, z],
            [x + 1, y, z],
            [x, y + 1, z],
            [x, y, z + 1],
            [x + 1, y + 1, z],
            [x + 1, y, z + 1],
            [x, y + 1, z + 1],
            [x + 1, y + 1, z + 1],
          ]);
          const start = { x: 0.5, y: 0.5, z: 0.5 };
          if (collides(bodyAabb(start), world)) return;
          const result = moveWithCollisions(start, { x: 0, y: 0, z: 0 }, { x: dx, y: dy, z: dz }, world);
          expect(collides(bodyAabb(result.position), world)).toBe(false);
        },
      ),
    );
  });

  it("control: a small dt does not tunnel a falling body through the floor", () => {
    // True before and after the fix, so this control never needed
    // converting: it proves the probe is live without pinning the bug.
    const world = floorWorld();
    let position = { x: 0.5, y: 50, z: 0.5 };
    let velocity = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 500; i++) {
      const result = stepPhysics(position, velocity, 1 / 60, world);
      position = result.position;
      velocity = result.velocity;
      if (result.onGround) break;
    }
    expect(position.y).toBe(1);
  });
});

describe("the step-up ledge", () => {
  // A floor under the body, so the body is standing on something. A body in
  // mid-air must not step up - that would be climbing a wall.
  const floor: readonly (readonly [number, number, number])[] = [
    [0, -1, 0],
    [0, -1, 1],
    [1, -1, 0],
    [1, -1, 1],
  ];

  it("a one-block ledge is walked up, not walked into", () => {
    const world = solidWorldFromBlocks([...floor, [1, 0, 0]]);
    const result = moveWithCollisions(
      { x: 0.5, y: 1, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      world,
    );
    // The body is ON the ledge, not stopped in front of it.
    expect(result.position.x).toBeCloseTo(1.5, 10);
    expect(result.collided).toBe(false);
    expect(collides(bodyAabb(result.position), world)).toBe(false);
  });

  it("a two-block ledge is not walked up", () => {
    const world = solidWorldFromBlocks([...floor, [1, 0, 0], [1, 1, 0]]);
    const result = moveWithCollisions(
      { x: 0.5, y: 1, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      world,
    );
    // Stopped flush against the ledge, and still on the ground.
    expect(result.collided).toBe(true);
    expect(result.position.x).toBeCloseTo(1 - PLAYER_HALF_WIDTH, 10);
    expect(collides(bodyAabb(result.position), world)).toBe(false);
  });

  it("a body that is not grounded does not step up", () => {
    // THE ANTI-WALL-CLIMB RULE. A body in mid-air must not walk up a
    // ledge, or a player could climb any wall by jumping into it. The
    // engine requires the body to be standing on something first.
    //
    // The body starts at y=0.5 with nothing beneath it, so its AABB
    // (y=0.50 to y=2.30) genuinely overlaps the ledge at y=0 to y=1 and
    // the ledge genuinely blocks the path. It must be stopped.
    const world = solidWorldFromBlocks([[1, 0, 0]]);
    const result = moveWithCollisions(
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      world,
    );
    // Stopped in front of the ledge, not on top of it.
    expect(result.collided).toBe(true);
    expect(result.position.x).toBeCloseTo(1 - PLAYER_HALF_WIDTH, 10);
    expect(collides(bodyAabb(result.position), world)).toBe(false);
  });

  it("an upward move passes over the ledge rather than using the step", () => {
    // A move that is itself upward does not need the step-up: the body
    // rises above the block and passes over it. The step-up is the
    // mechanism for a move that is NOT upward, which is why the engine's
    // first rule is about the movement delta.
    const world = solidWorldFromBlocks([...floor, [1, 0, 0]]);
    const result = moveWithCollisions(
      { x: 0.5, y: 1, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      world,
    );
    expect(result.position.x).toBeCloseTo(1.5, 10);
    expect(result.position.y).toBeCloseTo(2, 10);
  });
});
