/**
 * BlockForge — PRIORITY 3: DDA raycasting specification (src/core/raycast.ts).
 *
 * OWNERSHIP: TEST AUTHOR (tests/).
 *
 * Amanatides & Woo's grid traversal is what a player's "which block am I
 * looking at" and "where does my new block go" both ride on. The three
 * properties that matter to the game are:
 *
 *   1. a ray that hits a block reports the cell it hit AND the face it
 *      entered through, so the renderer can highlight the right face;
 *   2. that face normal points BACK at the ray, so the placement cell is
 *      the empty neighbour of the hit face and never the solid block;
 *   3. a ray that hits nothing returns null rather than a fabricated hit.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { placementCell, raycast } from "../src/core/raycast.js";
import type { RaycastWorld } from "../src/core/raycast.js";
import { BlockId } from "../src/core/types.js";

/** A world containing exactly the given solid cells. */
function worldOf(solid: readonly (readonly [number, number, number])[]): RaycastWorld {
  const set = new Set(solid.map(([x, y, z]) => `${x},${y},${z}`));
  return {
    blockAt: (x, y, z) => (set.has(`${x},${y},${z}`) ? BlockId.Slate : BlockId.Air),
  };
}

const isSolid = (block: BlockId): boolean => block !== BlockId.Air;

describe("PRIORITY 3: DDA raycasting (src/core/raycast.ts)", () => {
  it("reports the cell and the block it hit", () => {
    const world = worldOf([[2, 0, 0]]);
    const hit = raycast(
      { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } },
      world,
      10,
      isSolid,
    );
    expect(hit).not.toBeNull();
    expect(hit?.x).toBe(2);
    expect(hit?.y).toBe(0);
    expect(hit?.z).toBe(0);
    expect(hit?.block).toBe(BlockId.Slate);
  });

  it("reports the distance travelled to the hit", () => {
    const world = worldOf([[2, 0, 0]]);
    const hit = raycast(
      { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } },
      world,
      10,
      isSolid,
    );
    // The ray starts at x=0.5 and the hit cell starts at x=2, so it
    // travels 1.5 blocks.
    expect(hit?.distance).toBeCloseTo(1.5, 10);
  });

  it("reports the point of entry on the surface of the hit block", () => {
    const world = worldOf([[2, 0, 0]]);
    const hit = raycast(
      { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } },
      world,
      10,
      isSolid,
    );
    expect(hit?.point.x).toBeCloseTo(2, 10);
    expect(hit?.point.y).toBeCloseTo(0.5, 10);
    expect(hit?.point.z).toBeCloseTo(0.5, 10);
  });

  it("the face normal points BACK at the ray, on every axis", () => {
    // A ray travelling +X enters a block through its -X face.
    const xHit = raycast(
      { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } },
      worldOf([[2, 0, 0]]),
      10,
      isSolid,
    );
    expect(xHit?.normal).toEqual({ x: -1, y: 0, z: 0 });

    // A ray travelling -X enters through the +X face.
    const xBack = raycast(
      { origin: { x: 5.5, y: 0.5, z: 0.5 }, direction: { x: -1, y: 0, z: 0 } },
      worldOf([[2, 0, 0]]),
      10,
      isSolid,
    );
    expect(xBack?.normal).toEqual({ x: 1, y: 0, z: 0 });

    // +Y enters through the -Y face.
    const yHit = raycast(
      { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 0, y: 1, z: 0 } },
      worldOf([[0, 2, 0]]),
      10,
      isSolid,
    );
    expect(yHit?.normal).toEqual({ x: 0, y: -1, z: 0 });

    // -Y enters through the +Y face.
    const yBack = raycast(
      { origin: { x: 0.5, y: 5.5, z: 0.5 }, direction: { x: 0, y: -1, z: 0 } },
      worldOf([[0, 2, 0]]),
      10,
      isSolid,
    );
    expect(yBack?.normal).toEqual({ x: 0, y: 1, z: 0 });

    // +Z enters through the -Z face.
    const zHit = raycast(
      { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 0, y: 0, z: 1 } },
      worldOf([[0, 0, 3]]),
      10,
      isSolid,
    );
    expect(zHit?.normal).toEqual({ x: 0, y: 0, z: -1 });

    // -Z enters through the +Z face.
    const zBack = raycast(
      { origin: { x: 0.5, y: 0.5, z: 5.5 }, direction: { x: 0, y: 0, z: -1 } },
      worldOf([[0, 0, 3]]),
      10,
      isSolid,
    );
    expect(zBack?.normal).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("the normal is a unit axis vector, never a diagonal", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        (x, y, z, dx, dy, dz) => {
          const hit = raycast(
            { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: dx, y: dy, z: dz } },
            worldOf([[x, y, z]]),
            60,
            isSolid,
          );
          if (hit === null) return;
          const { normal } = hit;
          const magnitude = Math.abs(normal.x) + Math.abs(normal.y) + Math.abs(normal.z);
          expect(magnitude).toBe(1);
        },
      ),
    );
  });

  it("the placement cell is the empty neighbour of the hit face", () => {
    const world = worldOf([[2, 0, 0]]);
    const hit = raycast(
      { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } },
      world,
      10,
      isSolid,
    );
    expect(hit).not.toBeNull();
    const cell = placementCell(hit!);
    // The ray came from -X, so the block goes on the -X side of the hit.
    expect(cell).toEqual({ x: 1, y: 0, z: 0 });
    // And that cell must be empty, or the player would place a block
    // inside an existing one.
    expect(world.blockAt(cell.x, cell.y, cell.z)).toBe(BlockId.Air);
  });

  it("the placement cell is empty for every hit direction", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10, max: 10 }),
        fc.integer({ min: -10, max: 10 }),
        fc.integer({ min: -10, max: 10 }),
        (x, y, z) => {
          const world = worldOf([[x, y, z]]);
          const hit = raycast(
            { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } },
            world,
            60,
            isSolid,
          );
          if (hit === null) return;
          const cell = placementCell(hit);
          expect(world.blockAt(cell.x, cell.y, cell.z)).toBe(BlockId.Air);
        },
      ),
    );
  });

  it("a ray into empty space hits nothing", () => {
    const hit = raycast(
      { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 0, y: 1, z: 0 } },
      worldOf([]),
      10,
      isSolid,
    );
    expect(hit).toBeNull();
  });

  it("a ray that misses the block it was aimed at hits nothing", () => {
    // The block is at z=5, the ray goes along X.
    const hit = raycast(
      { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } },
      worldOf([[5, 9, 9]]),
      10,
      isSolid,
    );
    expect(hit).toBeNull();
  });

  it("a ray along a block edge picks a consistent face", () => {
    // A diagonal ray passes exactly through the edge between two cells.
    // Whatever it picks, it must pick the SAME face every time — an
    // unstable tie-break makes placement flicker as the player looks around.
    const world = worldOf([[1, 1, 0]]);
    const direction = { x: 1, y: 1, z: 0 };
    const origin = { x: 0.5, y: 0.5, z: 0.5 };
    const first = raycast({ origin, direction }, world, 10, isSolid);
    expect(first).not.toBeNull();
    for (let i = 0; i < 20; i++) {
      const again = raycast({ origin, direction }, world, 10, isSolid);
      expect(again?.x).toBe(first?.x);
      expect(again?.y).toBe(first?.y);
      expect(again?.z).toBe(first?.z);
      expect(again?.normal).toEqual(first?.normal);
      expect(again?.distance).toBe(first?.distance);
    }
  });

  it("a ray starting inside a block terminates", () => {
    // The origin is already inside a solid cell. The traversal must stop
    // rather than run forever, and must not report a cell the ray never
    // entered.
    const world = worldOf([[2, 0, 0]]);
    const hit = raycast(
      { origin: { x: 2.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } },
      world,
      10,
      isSolid,
    );
    expect(hit).not.toBeNull();
    expect(hit?.x).toBe(2);
    expect(hit?.distance).toBe(0);
  });

  it("a zero-length direction hits nothing", () => {
    const hit = raycast(
      { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 0, y: 0, z: 0 } },
      worldOf([[2, 0, 0]]),
      10,
      isSolid,
    );
    expect(hit).toBeNull();
  });

  it("a non-positive maxDistance hits nothing", () => {
    const world = worldOf([[2, 0, 0]]);
    const ray = { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } };
    expect(raycast(ray, world, 0, isSolid)).toBeNull();
    expect(raycast(ray, world, -1, isSolid)).toBeNull();
  });

  it("maxDistance bounds the search: a block beyond it is not hit", () => {
    const world = worldOf([[2, 0, 0]]);
    const ray = { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } };
    // The block is 1.5 blocks away, so a 1-block budget must miss it.
    expect(raycast(ray, world, 1, isSolid)).toBeNull();
    // A 2-block budget must find it.
    expect(raycast(ray, world, 2, isSolid)).not.toBeNull();
  });

  it("a ray finds the NEAREST of several blocks along its path", () => {
    const world = worldOf([[1, 0, 0], [2, 0, 0], [3, 0, 0]]);
    const hit = raycast(
      { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } },
      world,
      10,
      isSolid,
    );
    expect(hit?.x).toBe(1);
  });

  it("a ray only hits blocks the target predicate accepts", () => {
    const world = worldOf([[1, 0, 0], [2, 0, 0]]);
    const hit = raycast(
      { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } },
      world,
      10,
      (block) => block === BlockId.Slate,
    );
    // Only Slate is a target, so the first cell wins.
    expect(hit?.x).toBe(1);
  });

  it("a ray that ends inside a solid still reports the solid", () => {
    // The world query reports the block of the cell the ray is in, so a
    // ray whose origin is already solid reports that cell.
    const world: RaycastWorld = {
      blockAt: (x) => (x >= 1 ? BlockId.Slate : BlockId.Air),
    };
    const hit = raycast(
      { origin: { x: 0.5, y: 0.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } },
      world,
      10,
      isSolid,
    );
    expect(hit?.x).toBe(1);
    expect(hit?.normal).toEqual({ x: -1, y: 0, z: 0 });
  });
});
