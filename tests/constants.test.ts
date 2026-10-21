import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  SECTION_HEIGHT,
  SECTIONS_PER_CHUNK,
  CHUNK_VOLUME,
  WORLD_MIN_Y,
  WORLD_MAX_Y,
  SAVE_SCHEMA_VERSION,
  blockIndex,
  chunkKeyToString,
  chunkKeyFromString,
} from "../src/core/constants.js";

describe("PRIORITY 3 & 4: Frozen Constants and Geometric Invariants", () => {
  it("matches frozen dimension constants", () => {
    expect(CHUNK_SIZE_X).toBe(16);
    expect(CHUNK_SIZE_Y).toBe(256);
    expect(CHUNK_SIZE_Z).toBe(16);
    expect(SECTION_HEIGHT).toBe(16);
    expect(SECTIONS_PER_CHUNK).toBe(16);
    expect(CHUNK_VOLUME).toBe(16 * 256 * 16);
    expect(CHUNK_VOLUME).toBe(65536);
    expect(WORLD_MIN_Y).toBe(0);
    expect(WORLD_MAX_Y).toBe(256);
    expect(SAVE_SCHEMA_VERSION).toBe(1);
  });

  describe("blockIndex", () => {
    it("calculates correct y-major index: x + 16 * (z + 16 * y)", () => {
      expect(blockIndex(0, 0, 0)).toBe(0);
      expect(blockIndex(1, 0, 0)).toBe(1);
      expect(blockIndex(0, 0, 1)).toBe(16);
      expect(blockIndex(0, 1, 0)).toBe(256);
      expect(blockIndex(15, 255, 15)).toBe(CHUNK_VOLUME - 1);
    });

    it("is a bijection over chunk coordinates (property test)", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: CHUNK_SIZE_X - 1 }),
          fc.integer({ min: 0, max: CHUNK_SIZE_Y - 1 }),
          fc.integer({ min: 0, max: CHUNK_SIZE_Z - 1 }),
          (x, y, z) => {
            const idx = blockIndex(x, y, z);
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(CHUNK_VOLUME);
            expect(Number.isInteger(idx)).toBe(true);

            // Invert the formula
            const calculatedX = idx % CHUNK_SIZE_X;
            const remainder = Math.floor(idx / CHUNK_SIZE_X);
            const calculatedZ = remainder % CHUNK_SIZE_Z;
            const calculatedY = Math.floor(remainder / CHUNK_SIZE_Z);

            expect(calculatedX).toBe(x);
            expect(calculatedY).toBe(y);
            expect(calculatedZ).toBe(z);
          },
        ),
      );
    });

    it("throws RangeError on negative coordinates", () => {
      expect(() => blockIndex(-1, 0, 0)).toThrow(RangeError);
      expect(() => blockIndex(0, -1, 0)).toThrow(RangeError);
      expect(() => blockIndex(0, 0, -1)).toThrow(RangeError);
    });

    it("throws RangeError on upper out-of-bounds coordinates", () => {
      expect(() => blockIndex(CHUNK_SIZE_X, 0, 0)).toThrow(RangeError);
      expect(() => blockIndex(0, CHUNK_SIZE_Y, 0)).toThrow(RangeError);
      expect(() => blockIndex(0, 0, CHUNK_SIZE_Z)).toThrow(RangeError);
    });

    it("throws RangeError on non-integer inputs", () => {
      expect(() => blockIndex(1.5, 0, 0)).toThrow(RangeError);
      expect(() => blockIndex(0, 2.5, 0)).toThrow(RangeError);
      expect(() => blockIndex(0, 0, 3.5)).toThrow(RangeError);
      expect(() => blockIndex(NaN, 0, 0)).toThrow(RangeError);
      expect(() => blockIndex(Infinity, 0, 0)).toThrow(RangeError);
    });
  });

  describe("chunkKeyToString and chunkKeyFromString", () => {
    it("round-trips arbitrary signed chunk keys (property test)", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -1000000, max: 1000000 }),
          fc.integer({ min: -1000000, max: 1000000 }),
          (cx, cz) => {
            const str = chunkKeyToString({ cx, cz });
            expect(str).toBe(`${cx},${cz}`);
            const parsed = chunkKeyFromString(str);
            expect(parsed).toEqual({ cx, cz });
          },
        ),
      );
    });

    it("handles zero and negative chunk coordinates correctly", () => {
      expect(chunkKeyToString({ cx: 0, cz: 0 })).toBe("0,0");
      expect(chunkKeyFromString("0,0")).toEqual({ cx: 0, cz: 0 });

      expect(chunkKeyToString({ cx: -5, cz: -12 })).toBe("-5,-12");
      expect(chunkKeyFromString("-5,-12")).toEqual({ cx: -5, cz: -12 });
    });

    it("throws Error on malformed string inputs", () => {
      expect(() => chunkKeyFromString("")).toThrow(Error);
      expect(() => chunkKeyFromString("1")).toThrow(Error);
      expect(() => chunkKeyFromString("1,2,3")).toThrow(Error);
      expect(() => chunkKeyFromString("foo,bar")).toThrow(Error);
      expect(() => chunkKeyFromString("1.5,2")).toThrow(Error);
      expect(() => chunkKeyFromString("1,2.5")).toThrow(Error);
      expect(() => chunkKeyFromString("NaN,0")).toThrow(Error);
    });
  });
});
