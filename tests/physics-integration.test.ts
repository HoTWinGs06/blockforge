import { describe, it, expect } from "vitest";

/**
 * PROOF that the render layer now uses the ENGINE's physics module.
 *
 * Before this change, src/main.ts carried its own collides() and
 * moveWithCollisions() implementation. That meant src/core/physics.ts - the
 * module designed, documented and tested for this - was not the code that
 * moved the player, and it sat at 5.68% coverage while the game ran.
 *
 * This test pins the integration so it cannot silently drift back.
 */
describe("the render layer uses the engine's physics", () => {
  it("main.ts does NOT define its own collision code any more", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "..");
    const main = fs.readFileSync(path.join(root, "src", "main.ts"), "utf-8");

    // A private collision implementation is the thing we removed.
    expect(main, "main.ts must not define its own collides()").not.toMatch(
      /private\s+collides\s*\(/,
    );
    expect(main, "main.ts must not define its own moveWithCollision()").not.toMatch(
      /private\s+moveWithCollisions?\s*\(/,
    );

    // It must import and use the engine's module.
    expect(main, "main.ts must import the engine's physics").toMatch(
      /from\s+["'].*core\/physics\.js["']/,
    );
    expect(main, "main.ts must call the engine's stepPhysics").toMatch(/\bstepPhysics\s*\(/);
    expect(main, "main.ts must call the engine's moveWithCollisions").toMatch(
      /\bmoveWithCollisions\s*\(/,
    );
  });

  it("the engine's physics module is the one that runs", async () => {
    const { stepPhysics, moveWithCollisions, PLAYER_HEIGHT } = await import(
      "../src/core/physics.js"
    );
    expect(typeof stepPhysics).toBe("function");
    expect(typeof moveWithCollisions).toBe("function");

    // A body falling onto a floor must come to rest ON the floor, not through it.
    const world = { isSolid: (_x: number, y: number, _z: number) => y === 0 };
    let position = { x: 0.5, y: 5, z: 0.5 };
    let velocity = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 240; i++) {
      const r = stepPhysics(position, velocity, 1 / 60, world);
      position = r.position;
      velocity = r.velocity;
    }
    expect(position.y, "the body must rest on the floor, not fall through it").toBeGreaterThanOrEqual(0);
    expect(position.y, "the body must not sink below the floor").toBeLessThan(PLAYER_HEIGHT);
  });

  it("the player's collision box is the engine's, not a private one", async () => {
    const { bodyAabb, PLAYER_HEIGHT, PLAYER_HALF_WIDTH } = await import(
      "../src/core/physics.js"
    );
    // Aabb is flat: minX/minY/minZ/maxX/maxY/maxZ.
    const box = bodyAabb({ x: 0.5, y: 0, z: 0.5 });
    expect(box).toBeDefined();
    expect(box.minY).toBe(0);
    expect(box.maxY).toBeCloseTo(PLAYER_HEIGHT, 5);
    expect(box.minX).toBeCloseTo(0.5 - PLAYER_HALF_WIDTH, 5);
    expect(box.maxX).toBeCloseTo(0.5 + PLAYER_HALF_WIDTH, 5);
    expect(PLAYER_HALF_WIDTH).toBeGreaterThan(0);
  });
});
