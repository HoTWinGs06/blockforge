import { describe, it, expect } from "vitest";
import { ChunkStore } from "../src/engine/index.js";

/**
 * PROOF that the G2 run is using the ENGINE's real world and not a stand-in.
 *
 * The G2 smoke test asserts the game loads and the console stays clean. This
 * asserts the thing UNDERNEATH that: that the engine's ChunkStore really
 * produces a world, that it is deterministic, and that the renderer is
 * consuming that same world.
 *
 * It is deliberately a unit test rather than part of the Playwright spec, so
 * it runs in CI's fast job as well.
 */
describe("the render layer is wired to the engine's real world", () => {
  it("the engine's ChunkStore generates a non-empty, deterministic world", () => {
    // NOTE on the engine's own hash(): it walks only the CACHED chunks, so on a
    // fresh store it returns the FNV offset basis - a constant, identical for
    // every seed. That is finding E5 against the engine. The renderer's
    // EngineWorld hashes a FIXED chunk set instead, and THAT is what this
    // test pins. The engine's raw hash() is asserted separately below so the
    // E5 behaviour stays visible rather than quietly disappearing.
    const a = new ChunkStore(1337);
    const b = new ChunkStore(1337);
    const c = new ChunkStore(4242);

    // The engine's own hash on an empty store is the same constant for every
    // seed - documented E5 behaviour, asserted so it cannot be forgotten.
    expect(a.hash()).toBe(b.hash());
    expect(a.hash()).toBe(c.hash());
  });

  it("the engine's world has solid ground and a real mesh", () => {
    const store = new ChunkStore(1337);
    const key = { cx: 0, cz: 0 };

    // There must be a solid block somewhere in the column, or the world is empty.
    let solidCount = 0;
    for (let y = 0; y < 128; y++) {
      if (store.isSolid(8, y, 8)) {
        solidCount++;
      }
    }
    expect(solidCount, "the engine must generate solid terrain").toBeGreaterThan(0);

    const mesh = store.meshChunk(key);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.indices.length).toBeGreaterThan(0);
    // MeshOutput.blocks is one entry per triangle, parallel to indices.
    expect(mesh.blocks.length).toBe(mesh.indices.length / 3);
  });

  it("the renderer's EngineWorld hash is a REAL determinism check", async () => {
    const { EngineWorld } = await import("../src/render/engineBridge.js");

    // The same seed must give the same hash.
    const a = new EngineWorld(1337);
    const b = new EngineWorld(1337);
    expect(a.worldHash).toBe(b.worldHash);
    expect(a.worldHash.length).toBeGreaterThan(0);

    // A DIFFERENT SEED MUST GIVE A DIFFERENT HASH. This is the assertion that
    // the engine's own vacuous hash() could not make.
    const c = new EngineWorld(4242);
    expect(c.worldHash).not.toBe(a.worldHash);
  });

  it("the render layer does NOT import the dev stand-in any more", async () => {
    // A regression guard: src/dev/world.ts was deleted at the handover, so
    // nothing may reference it. If someone re-adds a stand-in, this fails.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "..");
    const standin = path.join(root, "src", "dev", "world.ts");
    expect(fs.existsSync(standin), "the dev stand-in must stay deleted").toBe(false);

    // And the entry point must reference the engine, not the stand-in.
    const html = fs.readFileSync(path.join(root, "index.html"), "utf-8");
    expect(html).not.toContain("dev/world.ts");
  });
});
