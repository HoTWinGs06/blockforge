/**
 * BlockForge — PRIORITY 3: chunked world generation (src/core/world.ts).
 *
 * OWNERSHIP: TEST AUTHOR (tests/).
 *
 * The world is the project's determinism keystone. Everything the rest of
 * the project promises — same seed, same world, byte for byte, in any
 * order, in any process — is discharged here. The properties pinned below:
 *
 *   1. `generateChunk` is a pure function of (seed, chunk key): the same
 *      inputs give byte-identical blocks, every time;
 *   2. different seeds give different worlds;
 *   3. the terrain is continuous across a chunk border, so a player
 *      walking over the seam sees no cliff;
 *   4. the world hash is stable for the same world, and DIFFERENT for a
 *      different seed — including a world with no chunks loaded.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  AIR_ORDINAL,
  MAX_HEIGHT,
  MIN_HEIGHT,
  SEA_LEVEL,
  World,
  blockFromOrdinal,
  blockOrdinal,
  chunkIndex,
  createChunk,
  generateChunk,
  getBlock,
  isOpaqueOrdinal,
  isTransparentOrdinal,
  setBlock,
  shouldRenderFace,
  terrainHeight,
} from "../src/core/world.js";
import { ALL_BLOCK_IDS, BlockId } from "../src/core/types.js";
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z, CHUNK_VOLUME } from "../src/core/constants.js";

/** True when two chunk block arrays are byte-identical. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** The ordinal of a block id. */
const ordinal = (id: BlockId): number => blockOrdinal(id);

describe("PRIORITY 3: chunked world generation (src/core/world.ts)", () => {
  it("generateChunk is byte-identical for the same seed and key", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: -8, max: 8 }),
        fc.integer({ min: -8, max: 8 }),
        (seed, cx, cz) => {
          const a = generateChunk(seed, { cx, cz });
          const b = generateChunk(seed, { cx, cz });
          expect(sameBytes(a.blocks, b.blocks)).toBe(true);
        },
      ),
    );
  });

  it("generateChunk produces different blocks for different seeds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xfffffffe }),
        fc.integer({ min: -4, max: 4 }),
        fc.integer({ min: -4, max: 4 }),
        (seed, cx, cz) => {
          const a = generateChunk(seed, { cx, cz });
          const b = generateChunk(seed + 1, { cx, cz });
          expect(sameBytes(a.blocks, b.blocks)).toBe(false);
        },
      ),
    );
  });

  it("generateChunk produces different blocks for different chunk keys", () => {
    const a = generateChunk(1234, { cx: 0, cz: 0 });
    const b = generateChunk(1234, { cx: 1, cz: 0 });
    const c = generateChunk(1234, { cx: 0, cz: 1 });
    expect(sameBytes(a.blocks, b.blocks)).toBe(false);
    expect(sameBytes(a.blocks, c.blocks)).toBe(false);
  });

  it("a generated chunk is CHUNK_VOLUME long and starts with the key it was asked for", () => {
    const chunk = generateChunk(1234, { cx: 3, cz: -2 });
    expect(chunk.blocks.length).toBe(CHUNK_VOLUME);
    expect(chunk.key).toEqual({ cx: 3, cz: -2 });
  });

  it("a chunk is a pure function of its key, not of generation order", () => {
    // Generating the same chunk after other chunks must give the same
    // bytes: generation is order-independent.
    const first = generateChunk(555, { cx: 2, cz: 2 });
    generateChunk(555, { cx: 0, cz: 0 });
    generateChunk(555, { cx: -3, cz: 7 });
    const again = generateChunk(555, { cx: 2, cz: 2 });
    expect(sameBytes(first.blocks, again.blocks)).toBe(true);
  });

  it("the terrain height is continuous across a chunk border", () => {
    // The column at the last x of one chunk and the first x of the next
    // are adjacent columns in the world, so their heights must differ by
    // at most one — otherwise there is a visible cliff at the seam.
    for (const seed of [1, 42, 1234, 9999]) {
      for (const x of [15, 31, 47, -1, -17]) {
        for (let z = -32; z < 32; z++) {
          const here = terrainHeight(seed, x, z);
          const next = terrainHeight(seed, x + 1, z);
          expect(Math.abs(here - next)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("the terrain height is the same whether it is read or generated", () => {
    // The height the generator used must be the height the world reports.
    for (const seed of [1, 42]) {
      for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) {
          expect(terrainHeight(seed, x, z)).toBe(terrainHeight(seed, x, z));
        }
      }
    }
  });

  it("the terrain height stays within the frozen bounds", () => {
    for (const seed of [1, 42, 1234, 9999]) {
      for (let x = -64; x < 64; x += 3) {
        for (let z = -64; z < 64; z += 3) {
          const h = terrainHeight(seed, x, z);
          expect(h).toBeGreaterThanOrEqual(MIN_HEIGHT);
          expect(h).toBeLessThanOrEqual(MAX_HEIGHT);
        }
      }
    }
  });

  it("the terrain height is deterministic for the same seed and column", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (seed, x, z) => {
          expect(terrainHeight(seed, x, z)).toBe(terrainHeight(seed, x, z));
        },
      ),
    );
  });

  it("the world hash is stable for the same world", () => {
    const world = new World(1234);
    world.getChunk({ cx: 0, cz: 0 });
    const first = world.hash();
    // Hashing again must not change the answer.
    expect(world.hash()).toBe(first);
  });

  it("the world hash does not depend on the order chunks were loaded", () => {
    const a = new World(1234);
    a.getChunk({ cx: 0, cz: 0 });
    a.getChunk({ cx: 1, cz: 0 });
    a.getChunk({ cx: 0, cz: 1 });

    const b = new World(1234);
    b.getChunk({ cx: 0, cz: 1 });
    b.getChunk({ cx: 0, cz: 0 });
    b.getChunk({ cx: 1, cz: 0 });

    expect(b.hash()).toBe(a.hash());
  });

  it("the world hash changes when a chunk changes", () => {
    const a = new World(1234);
    a.getChunk({ cx: 0, cz: 0 });
    const before = a.hash();
    a.getChunk({ cx: 5, cz: 5 });
    expect(a.hash()).not.toBe(before);
  });

  // RED-TEAM finding E5 (the vacuous hash). The engine says it fixed
  // this: `hash()` now mixes the SEED in as four little-endian bytes
  // before the chunk loop, so two worlds with different seeds can never
  // hash the same however few chunks they have loaded. This test pins
  // the FIXED behaviour, and it passes — the fix is real.
  it("a different seed gives a DIFFERENT world hash", () => {
    const a = new World(1234);
    const b = new World(9999);
    a.getChunk({ cx: 0, cz: 0 });
    b.getChunk({ cx: 0, cz: 0 });
    expect(a.hash()).not.toBe(b.hash());
  });

  it("a different seed gives a DIFFERENT hash even with no chunks loaded", () => {
    // This is the exact case E5 was filed against: the empty store used
    // to return the FNV-1a offset basis (811c9dc5) for every seed, so the
    // hash could not distinguish two different worlds at all.
    const a = new World(1234);
    const b = new World(9999);
    expect(a.hash()).not.toBe(b.hash());
    expect(a.hash()).not.toBe("811c9dc5");
  });

  it("the world hash is stable across two worlds with the same seed and chunks", () => {
    const a = new World(4242);
    const b = new World(4242);
    for (const key of [
      { cx: 0, cz: 0 },
      { cx: -1, cz: 2 },
      { cx: 3, cz: -3 },
    ]) {
      a.getChunk(key);
      b.getChunk(key);
    }
    expect(a.hash()).toBe(b.hash());
  });

  it("the World class caches chunks and can unload them", () => {
    const world = new World(1234);
    const key = { cx: 0, cz: 0 };
    expect(world.hasChunk(key)).toBe(false);
    expect(world.peekChunk(key)).toBeUndefined();

    const chunk = world.getChunk(key);
    expect(world.hasChunk(key)).toBe(true);
    expect(world.peekChunk(key)).toBe(chunk);
    // A second request returns the CACHED chunk, not a new one.
    expect(world.getChunk(key)).toBe(chunk);

    world.unloadChunk(key);
    expect(world.hasChunk(key)).toBe(false);
    // And regenerating it gives the same bytes as before.
    expect(sameBytes(world.getChunk(key).blocks, chunk.blocks)).toBe(true);
  });

  it("loadedChunks lists the loaded chunks in a deterministic order", () => {
    const world = new World(1234);
    world.getChunk({ cx: 1, cz: 0 });
    world.getChunk({ cx: 0, cz: 1 });
    world.getChunk({ cx: 0, cz: 0 });
    const keys = world.loadedChunks().map((c) => c.key);
    expect(keys).toEqual([
      { cx: 0, cz: 0 },
      { cx: 0, cz: 1 },
      { cx: 1, cz: 0 },
    ]);
  });

  it("getBlockAt reads the block the generator wrote", () => {
    const world = new World(1234);
    const h = terrainHeight(1234, 0, 0);
    // The surface block of the column is the one at the terrain height.
    const surface = world.getBlockAt(0, h, 0);
    expect(surface).not.toBe(BlockId.Air);
  });

  it("getBlockAt returns air outside the world", () => {
    const world = new World(1234);
    expect(world.getBlockAt(0, -1, 0)).toBe(BlockId.Air);
    expect(world.getBlockAt(0, CHUNK_SIZE_Y, 0)).toBe(BlockId.Air);
    expect(world.getBlockAt(0, CHUNK_SIZE_Y + 100, 0)).toBe(BlockId.Air);
  });

  it("setBlockAt writes a block that getBlockAt reads back", () => {
    const world = new World(1234);
    expect(world.setBlockAt(3, 10, 3, BlockId.Masonry)).toBe(true);
    expect(world.getBlockAt(3, 10, 3)).toBe(BlockId.Masonry);
  });

  it("setBlockAt refuses to write outside the world", () => {
    const world = new World(1234);
    expect(world.setBlockAt(0, -1, 0, BlockId.Masonry)).toBe(false);
    expect(world.setBlockAt(0, CHUNK_SIZE_Y, 0, BlockId.Masonry)).toBe(false);
  });

  it("neighbours reports the four horizontal neighbours of a chunk", () => {
    const world = new World(1234);
    const key = { cx: 1, cz: 1 };
    // Nothing loaded yet: no neighbours.
    expect(world.neighbours(key).west).toBeUndefined();
    expect(world.neighbours(key).east).toBeUndefined();
    expect(world.neighbours(key).north).toBeUndefined();
    expect(world.neighbours(key).south).toBeUndefined();

    world.getChunk({ cx: 0, cz: 1 });
    world.getChunk({ cx: 2, cz: 1 });
    world.getChunk({ cx: 1, cz: 0 });
    world.getChunk({ cx: 1, cz: 2 });

    const neighbours = world.neighbours(key);
    expect(neighbours.west?.key).toEqual({ cx: 0, cz: 1 });
    expect(neighbours.east?.key).toEqual({ cx: 2, cz: 1 });
    expect(neighbours.north?.key).toEqual({ cx: 1, cz: 0 });
    expect(neighbours.south?.key).toEqual({ cx: 1, cz: 2 });
  });

  it("heightAt agrees with terrainHeight for the world's seed", () => {
    const world = new World(1234);
    expect(world.heightAt(7, 9)).toBe(terrainHeight(1234, 7, 9));
  });

  it("a snapshot round-trips through fromSnapshot", () => {
    const world = new World(1234);
    world.getChunk({ cx: 0, cz: 0 });
    world.getChunk({ cx: 1, cz: 0 });
    const snapshot = world.snapshot();

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.seed).toBe(1234);
    expect(snapshot.chunks.length).toBe(2);

    const restored = World.fromSnapshot(snapshot);
    expect(restored.hash()).toBe(world.hash());
    expect(restored.getBlockAt(0, terrainHeight(1234, 0, 0), 0)).toBe(
      world.getBlockAt(0, terrainHeight(1234, 0, 0), 0),
    );
  });

  it("parseKey reads a chunk key back from its string form", () => {
    expect(World.parseKey("1,2")).toEqual({ cx: 1, cz: 2 });
    expect(World.parseKey("-3,4")).toEqual({ cx: -3, cz: 4 });
  });

  it("blockOrdinal and blockFromOrdinal are inverses", () => {
    for (const id of ALL_BLOCK_IDS) {
      expect(blockFromOrdinal(blockOrdinal(id))).toBe(id);
    }
  });

  it("blockOrdinal throws on an unknown block id", () => {
    expect(() => blockOrdinal("not-a-block" as never)).toThrow();
  });

  it("blockFromOrdinal throws on an out-of-range ordinal", () => {
    expect(() => blockFromOrdinal(ALL_BLOCK_IDS.length)).toThrow(RangeError);
    expect(() => blockFromOrdinal(-1)).toThrow(RangeError);
  });

  it("air is transparent and never opaque", () => {
    expect(isTransparentOrdinal(AIR_ORDINAL)).toBe(true);
    expect(isOpaqueOrdinal(AIR_ORDINAL)).toBe(false);
  });

  it("a solid block is opaque, and a transparent solid block is not", () => {
    expect(isOpaqueOrdinal(ordinal(BlockId.Slate))).toBe(true);
    expect(isTransparentOrdinal(ordinal(BlockId.Slate))).toBe(false);
    // Crystpane is solid but lets light through, so it is not opaque.
    expect(isTransparentOrdinal(ordinal(BlockId.Crystpane))).toBe(true);
    expect(isOpaqueOrdinal(ordinal(BlockId.Crystpane))).toBe(false);
  });

  it("air never has a face", () => {
    expect(shouldRenderFace(AIR_ORDINAL, ordinal(BlockId.Slate))).toBe(false);
  });

  it("a face between two blocks of the same kind is culled", () => {
    const slate = ordinal(BlockId.Slate);
    expect(shouldRenderFace(slate, slate)).toBe(false);
  });

  it("a face against an opaque neighbour is hidden", () => {
    expect(shouldRenderFace(ordinal(BlockId.Slate), ordinal(BlockId.Loam))).toBe(false);
  });

  it("a face against a transparent neighbour is drawn", () => {
    expect(shouldRenderFace(ordinal(BlockId.Slate), ordinal(BlockId.Tidewater))).toBe(true);
    expect(shouldRenderFace(ordinal(BlockId.Slate), AIR_ORDINAL)).toBe(true);
  });

  it("createChunk makes an all-air chunk of the right size", () => {
    const chunk = createChunk({ cx: 1, cz: -1 });
    expect(chunk.key).toEqual({ cx: 1, cz: -1 });
    expect(chunk.blocks.length).toBe(CHUNK_VOLUME);
    for (const block of chunk.blocks) {
      expect(block).toBe(AIR_ORDINAL);
    }
  });

  it("chunkIndex agrees with the frozen blockIndex", () => {
    expect(chunkIndex(1, 2, 3)).toBe(1 + CHUNK_SIZE_X * (3 + CHUNK_SIZE_Z * 2));
  });

  it("getBlock reads air outside the chunk", () => {
    const chunk = createChunk({ cx: 0, cz: 0 });
    expect(getBlock(chunk, -1, 0, 0)).toBe(AIR_ORDINAL);
    expect(getBlock(chunk, CHUNK_SIZE_X, 0, 0)).toBe(AIR_ORDINAL);
    expect(getBlock(chunk, 0, CHUNK_SIZE_Y, 0)).toBe(AIR_ORDINAL);
    expect(getBlock(chunk, 0, 0, CHUNK_SIZE_Z)).toBe(AIR_ORDINAL);
  });

  it("getBlock reads a block that was written", () => {
    const chunk = createChunk({ cx: 0, cz: 0 });
    setBlock(chunk, 4, 5, 6, BlockId.Slate);
    expect(getBlock(chunk, 4, 5, 6)).toBe(ordinal(BlockId.Slate));
  });

  it("setBlock ignores writes outside the chunk", () => {
    const chunk = createChunk({ cx: 0, cz: 0 });
    setBlock(chunk, -1, 0, 0, BlockId.Slate);
    setBlock(chunk, CHUNK_SIZE_X, 0, 0, BlockId.Slate);
    setBlock(chunk, 0, CHUNK_SIZE_Y, 0, BlockId.Slate);
    setBlock(chunk, 0, 0, CHUNK_SIZE_Z, BlockId.Slate);
    for (const block of chunk.blocks) {
      expect(block).toBe(AIR_ORDINAL);
    }
  });

  it("a generated column is solid from the bottom up to its terrain height", () => {
    const seed = 1234;
    const world = new World(seed);
    const columns: readonly (readonly [number, number])[] = [
      [0, 0],
      [5, 9],
      [15, 15],
    ];
    for (const [x, z] of columns) {
      const h = terrainHeight(seed, x, z);
      // The bottom of the world is solid bedrock.
      expect(world.getBlockAt(x, 0, z)).toBe(BlockId.Voidstone);
      // And the block at the terrain height is a surface block, not air.
      expect(world.getBlockAt(x, h, z)).not.toBe(BlockId.Air);
    }
  });

  it("the surface block is one of the terrain surface kinds", () => {
    // The four surface kinds the generator chooses between: sand below the
    // waterline, and clay, gravel or loam above it.
    const seed = 1234;
    const world = new World(seed);
    const surfaces = new Set<BlockId>();
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        const h = terrainHeight(seed, x, z);
        const block = world.getBlockAt(x, h, z);
        if (block === BlockId.Air) continue;
        surfaces.add(block);
      }
    }
    for (const block of surfaces) {
      expect([
        BlockId.Sand,
        BlockId.Clay,
        BlockId.Gravel,
        BlockId.Loam,
        // A tree trunk can stand on the surface, and ore can be exposed.
        BlockId.Timber,
        BlockId.Crystpane,
      ]).toContain(block);
    }
  });

  it("columns below the sea level are flooded with water", () => {
    // Seed 1 at chunk (1, 0) has columns under the waterline.
    const world = new World(1);
    const h = terrainHeight(1, 16, 0);
    expect(h).toBeLessThan(SEA_LEVEL);
    expect(world.getBlockAt(16, h + 1, 0)).toBe(BlockId.Tidewater);
  });

  it("columns above the sea level have air above the surface", () => {
    const world = new World(1234);
    const h = terrainHeight(1234, 0, 0);
    expect(h).toBeGreaterThan(SEA_LEVEL);
    expect(world.getBlockAt(0, h + 1, 0)).toBe(BlockId.Air);
  });
});
