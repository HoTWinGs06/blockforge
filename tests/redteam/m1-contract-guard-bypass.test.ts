/**
 * RED-TEAM M1 — CONTRACT GUARD BYPASS ATTEMPTS
 *
 * Confirm blockIndex() RangeError, chunkKeyFromString guard, and byte mapping
 * have zero bypass paths.
 */
import { describe, expect, it } from "vitest";
import { blockIndex, chunkKeyFromString, chunkKeyToString, blockIdToByte, byteToBlockId, ALL_BLOCK_IDS, CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from "../../src/core/index.js";
import type { BlockId } from "../../src/core/index.js";

describe("M1 CONTRACT GUARDS — no bypass path", () => {
  it("blockIndex throws on every out-of-range coordinate", () => {
    const bad: [number, number, number][] = [
      [-1, 0, 0], [16, 0, 0], [0, -1, 0], [0, 256, 0],
      [0, 0, -1], [0, 0, 16], [1.5, 1, 1], [1, 1, 1.999],
    ];
    for (const [x, y, z] of bad) expect(() => blockIndex(x, y, z)).toThrow();
  });

  it("blockIndex is bijective over full 16x256x16 domain (no alias, no skip)", () => {
    const seen = new Set<number>();
    let count = 0;
    for (let y = 0; y < CHUNK_SIZE_Y; y++)
      for (let z = 0; z < CHUNK_SIZE_Z; z++)
        for (let x = 0; x < CHUNK_SIZE_X; x++) {
          const idx = blockIndex(x, y, z);
          expect(seen.has(idx)).toBe(false); // no alias
          seen.add(idx);
          expect(Number.isInteger(idx) && idx >= 0 && idx < CHUNK_SIZE_X*CHUNK_SIZE_Y*CHUNK_SIZE_Z).toBe(true);
          count++;
        }
    expect(count).toBe(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z);
    expect(seen.size).toBe(count);
  });

  it("chunkKeyFromString rejects malformed input (F2 guard)", () => {
    const bad = ["", ",", "1,", ",0", "1,0,", "01,0", "+5,0", "0x10,0", "1e3,0", "1.0,0", "1,NaN", "Infinity,0", " 1,0"];
    for (const s of bad) expect(() => chunkKeyFromString(s)).toThrow();
  });

  it("chunkKeyFromString and chunkKeyToString are inverses for safe integers", () => {
    for (let cx = -100; cx <= 100; cx += 7) for (let cz = -100; cz <= 100; cz += 11) {
      const k = { cx, cz };
      expect(chunkKeyFromString(chunkKeyToString(k))).toEqual(k);
    }
  });

  it("chunkKeyToString throws for non-safe-integer / fractional / NaN / Infinity", () => {
    expect(() => chunkKeyToString({ cx: 1.5, cz: 2 })).toThrow();
    expect(() => chunkKeyToString({ cx: NaN, cz: 0 })).toThrow();
    expect(() => chunkKeyToString({ cx: Infinity, cz: 0 })).toThrow();
  });

  it("byte -> BlockId mapping exists for all 23 blocks and rejects 23+", () => {
    for (let b = 0; b < 23; b++) {
      const id = byteToBlockId(b);
      expect(typeof id).toBe("string");
      expect(blockIdToByte(id)).toBe(b);
    }
    expect(() => byteToBlockId(23)).toThrow();
    expect(() => byteToBlockId(255)).toThrow();
  });

  it("ALL_BLOCK_IDS length is 23 and every entry round-trips through byte mapping", () => {
    expect(ALL_BLOCK_IDS.length).toBe(23);
    for (const id of ALL_BLOCK_IDS) {
      const b = blockIdToByte(id as BlockId);
      expect(typeof b).toBe("number");
      expect(byteToBlockId(b)).toBe(id);
    }
  });

  it("no path can make chunkKeyFromString accept a non-string or non-canonical form", () => {
    // TypeScript prevents non-string at compile time; at runtime, any non-string
    // should either throw or not produce a valid ChunkKey.
    expect(() => chunkKeyFromString(null as unknown as string)).toThrow(); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});
