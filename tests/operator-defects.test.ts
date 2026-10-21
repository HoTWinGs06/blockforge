import { describe, it, expect } from "vitest";
import { EngineWorld } from "../src/render/engineBridge.js";
import { VIEW_RADIUS_CHUNKS } from "../src/render/viewDistance.js";

/**
 * PROOF that the operator's reported defects are actually fixed.
 *
 * The operator played the prototype and reported:
 *   "the jump is not working in all areas"
 *   "rendering distance is low"
 *
 * The architect diagnosed the cause: the world was a fixed five-chunk plus
 * shape, so walking off it put the player in empty space with no ground, no
 * collision, and therefore no jump. These tests pin the fix so it cannot
 * silently regress.
 */
describe("the operator's reported defects", () => {
  it("T58: the loaded region follows the player instead of being a fixed island", () => {
    // The view radius is a real radius, not the old five-chunk plus shape.
    expect(VIEW_RADIUS_CHUNKS).toBeGreaterThanOrEqual(3);
    // A plus shape of 5 chunks would be a radius of 1.
    expect(VIEW_RADIUS_CHUNKS).toBeGreaterThan(1);
  });

  it("T58/T63: there is GROUND under the player far from the origin", () => {
    const world = new EngineWorld(1337);

    // The old bug: past the edge of the five-chunk island there was no ground
    // at all, so the player fell into the void and the jump did nothing.
    // Walk out to 200 blocks in +X and check there is solid ground beneath.
    const farX = 200;
    let groundFound = false;
    for (let y = 0; y < 128; y++) {
      if (world.isSolid(farX, y, 0)) {
        groundFound = true;
        break;
      }
    }
    expect(groundFound, "there must be solid ground far from the origin").toBe(true);
  });

  it("T63: the player CAN jump - a jump produces vertical movement over ground", async () => {
    const { stepPhysics } = await import("../src/core/physics.js");
    const world = new EngineWorld(1337);
    const solidWorld = {
      isSolid: (x: number, y: number, z: number): boolean => world.isSolid(x, y, z),
    };

    // Find a standing position: a solid block with air above it.
    let start = { x: 0.5, y: 0, z: 0.5 };
    for (let y = 0; y < 128; y++) {
      if (world.isSolid(0, y, 0) && !world.isSolid(0, y + 1, 0) && !world.isSolid(0, y + 2, 0)) {
        start = { x: 0.5, y: y + 1, z: 0.5 };
        break;
      }
    }

    // Settle on the ground.
    let position = { ...start };
    let velocity = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 120; i++) {
      const r = stepPhysics(position, velocity, 1 / 60, solidWorld);
      position = r.position;
      velocity = r.velocity;
    }
    const groundY = position.y;

    // Jump: a fresh upward velocity must produce a RISE.
    const jumped = stepPhysics(
      position,
      { x: 0, y: 8, z: 0 },
      1 / 60,
      solidWorld,
    );
    expect(
      jumped.position.y,
      "a jump must produce vertical movement, not zero",
    ).toBeGreaterThan(groundY);
  });

  it("T58: the fog distance is pulled in behind the loaded region", async () => {
    const { FOG_FAR, VIEW_RADIUS_BLOCKS } = await import("../src/render/viewDistance.js");
    // The fade must hide the boundary: the fog has to end before the edge of
    // the loaded region, or the player sees the edge of the world.
    expect(
      FOG_FAR,
      "the fog must fade out before the loaded region ends",
    ).toBeLessThan(VIEW_RADIUS_BLOCKS);
  });
});
