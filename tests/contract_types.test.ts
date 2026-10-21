/**
 * BlockForge — the frozen core contract, as the ENGINE now implements it.
 *
 * OWNERSHIP: TEST AUTHOR (tests/).
 *
 * The engine hardened the frozen contract after RED-TEAM's first cycle
 * (findings F1, F2, F3, F4). The contract is the thing every other
 * agent builds against, so its guarantees are worth pinning directly:
 *
 *   1. `SOLID_BLOCKS` and `TRANSPARENT_BLOCKS` are genuinely immutable —
 *      `Object.freeze` cannot freeze a Set's internal slots, so the
 *      engine wraps them in a proxy whose mutators throw;
 *   2. the block-byte encoding is a bijection between BlockId and
 *      `0 .. BLOCK_ID_COUNT-1`, and an invalid byte is REJECTED rather
 *      than silently decoded;
 *   3. a chunk key round-trips exactly, and a key that cannot be read
 *      back is not a key.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  ALL_BLOCK_IDS,
  BLOCK_ID_COUNT,
  BlockId,
  SOLID_BLOCKS,
  TRANSPARENT_BLOCKS,
  blockIdToByte,
  byteToBlockId,
  isValidBlockByte,
} from "../src/core/types.js";
import { chunkKeyFromString, chunkKeyToString } from "../src/core/constants.js";

describe("PRIORITY 4: the frozen core contract as the engine implements it", () => {
  describe("immutable block sets (F1)", () => {
    it("SOLID_BLOCKS and TRANSPARENT_BLOCKS are still Sets with the right contents", () => {
      expect(SOLID_BLOCKS).toBeInstanceOf(Set);
      expect(TRANSPARENT_BLOCKS).toBeInstanceOf(Set);
      expect(SOLID_BLOCKS.has(BlockId.Slate)).toBe(true);
      expect(SOLID_BLOCKS.has(BlockId.Air)).toBe(false);
      expect(TRANSPARENT_BLOCKS.has(BlockId.Air)).toBe(true);
    });

    it("SOLID_BLOCKS rejects a mutation instead of silently accepting it", () => {
      // Object.freeze does NOT freeze a Set's internal slots, so
      // SOLID_BLOCKS.add(...) used to succeed and corrupt every later
      // chunk. The engine wraps it in a proxy whose mutators throw.
      expect(() => (SOLID_BLOCKS as Set<BlockId>).add(BlockId.Air)).toThrow(TypeError);
      // And the set is unchanged.
      expect(SOLID_BLOCKS.has(BlockId.Air)).toBe(false);
    });

    it("TRANSPARENT_BLOCKS rejects a mutation", () => {
      expect(() => (TRANSPARENT_BLOCKS as Set<BlockId>).delete(BlockId.Air)).toThrow(TypeError);
      expect(() => (TRANSPARENT_BLOCKS as Set<BlockId>).clear()).toThrow(TypeError);
      expect(TRANSPARENT_BLOCKS.has(BlockId.Air)).toBe(true);
    });

    it("the sets still support the read operations consumers use", () => {
      expect(SOLID_BLOCKS.size).toBeGreaterThan(0);
      expect(TRANSPARENT_BLOCKS.size).toBeGreaterThan(0);
      expect([...SOLID_BLOCKS].every((id) => ALL_BLOCK_IDS.includes(id))).toBe(true);
      expect(SOLID_BLOCKS.has(BlockId.Slate)).toBe(true);
    });
  });

  describe("block byte encoding (F3)", () => {
    it("BLOCK_ID_COUNT is the number of block kinds", () => {
      expect(BLOCK_ID_COUNT).toBe(ALL_BLOCK_IDS.length);
    });

    it("blockIdToByte and byteToBlockId are inverses", () => {
      for (const id of ALL_BLOCK_IDS) {
        const byte = blockIdToByte(id);
        expect(byteToBlockId(byte)).toBe(id);
      }
    });

    it("blockIdToByte assigns every id a DISTINCT byte", () => {
      const bytes = ALL_BLOCK_IDS.map((id) => blockIdToByte(id));
      expect(new Set(bytes).size).toBe(bytes.length);
      expect(bytes.slice().sort((a, b) => a - b)).toEqual(
        Array.from({ length: ALL_BLOCK_IDS.length }, (_, i) => i),
      );
    });

    it("blockIdToByte throws on an unknown block id", () => {
      expect(() => blockIdToByte("not-a-block" as never)).toThrow(RangeError);
    });

    it("isValidBlockByte accepts exactly the valid range", () => {
      for (let byte = 0; byte < BLOCK_ID_COUNT; byte++) {
        expect(isValidBlockByte(byte)).toBe(true);
      }
      expect(isValidBlockByte(-1)).toBe(false);
      expect(isValidBlockByte(BLOCK_ID_COUNT)).toBe(false);
      expect(isValidBlockByte(200)).toBe(false);
      expect(isValidBlockByte(1.5)).toBe(false);
      expect(isValidBlockByte(Number.NaN)).toBe(false);
    });

    it("byteToBlockId throws on an invalid byte rather than decoding it", () => {
      // Callers decoding untrusted bytes (a save file, a network packet)
      // must be able to reject a corrupt value instead of getting a
      // silently wrong block.
      expect(() => byteToBlockId(-1)).toThrow(RangeError);
      expect(() => byteToBlockId(BLOCK_ID_COUNT)).toThrow(RangeError);
      expect(() => byteToBlockId(1.5)).toThrow(RangeError);
      expect(() => byteToBlockId(Number.NaN)).toThrow(RangeError);
    });
  });

  describe("chunk keys round-trip exactly (F2, F4)", () => {
    it("chunkKeyToString and chunkKeyFromString are inverses", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -100000, max: 100000 }),
          fc.integer({ min: -100000, max: 100000 }),
          (cx, cz) => {
            const text = chunkKeyToString({ cx, cz });
            expect(chunkKeyFromString(text)).toEqual({ cx, cz });
          },
        ),
      );
    });

    it("chunkKeyToString rejects a key that could not be read back", () => {
      // A fractional, NaN or infinite coordinate would serialise to a
      // string this module's own inverse rejects.
      expect(() => chunkKeyToString({ cx: 1.5, cz: 2 })).toThrow(RangeError);
      expect(() => chunkKeyToString({ cx: 2, cz: Number.NaN })).toThrow(RangeError);
      expect(() => chunkKeyToString({ cx: Number.POSITIVE_INFINITY, cz: 0 })).toThrow(RangeError);
    });

    it("chunkKeyFromString parses STRICTLY, not with Number()", () => {
      // Number() is far too permissive: it yields 0 for "", 16 for "0x10",
      // 1000 for "1e3", 5 for "+5" and "0b101", and 1 for "1.0" - so
      // "1," and "1,0" would address the same chunk.
      for (const bad of [
        "",
        "1",
        "1,2,3",
        "foo,bar",
        "1.5,2",
        "1,2.5",
        "NaN,0",
        "0x10,2",
        "1e3,0",
        "+5,0",
        "0b101,0",
        "1.0,0",
        " 1,0",
        "1, 0",
        ",0",
        "1,",
      ]) {
        expect(() => chunkKeyFromString(bad), `should reject ${JSON.stringify(bad)}`).toThrow(Error);
      }
    });

    it("chunkKeyFromString accepts negative coordinates", () => {
      expect(chunkKeyFromString("-5,-12")).toEqual({ cx: -5, cz: -12 });
      expect(chunkKeyToString({ cx: -5, cz: -12 })).toBe("-5,-12");
    });
  });
});
