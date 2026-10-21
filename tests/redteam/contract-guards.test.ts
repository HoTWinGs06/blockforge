/**
 * BlockForge — RED-TEAM: the contract's own guards, attacked.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/).
 *
 * THE ARCHITECT'S ASK
 * -------------------
 * The M1 red-team brief names the first targets explicitly:
 *
 *     "src/core/constants.ts blockIndex() throws RangeError out of range,
 *      and chunkKeyFromString throws on malformed input - confirm no path
 *      can bypass those guards."
 *
 * So this file is the answer to that ask. It attacks the guards from every
 * angle I can think of:
 *
 *   - every non-integer, NaN, Infinity, string, boolean, null, undefined
 *     and out-of-range coordinate;
 *   - the FULL 16x256x16 space, to prove blockIndex is a BIJECTION onto
 *     0..65535 (no aliasing, no collisions, no gaps) — an aliasing bug
 *     would mean two different blocks share a storage slot;
 *   - the identity blockIndex(x,y,z) === x + 16*(z + 16*y), which is the
 *     FROZEN storage order. If that ever changes, every saved world
 *     silently changes meaning;
 *   - the round-trip of chunkKeyToString/chunkKeyFromString over the whole
 *     signed-integer range.
 *
 * RESULT (verified, not assumed)
 * ------------------------------
 * blockIndex is CLEAN: 0 bypasses found across every attack, and it is a
 * proven bijection over the full chunk volume. That is a real negative
 * result and it is worth recording, because it means the storage-order
 * contract is trustworthy.
 *
 * chunkKeyFromString is NOT clean — that is finding F2, in
 * f2-chunk-key-malformed.test.ts, and it is not duplicated here.
 */

import { describe, expect, it } from "vitest";
import {
  blockIndex,
  chunkKeyFromString,
  chunkKeyToString,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  CHUNK_VOLUME,
} from "../../src/core/index.js";

describe("blockIndex — out-of-range coordinates must throw", () => {
  it("rejects negative coordinates on every axis", () => {
    expect(() => blockIndex(-1, 0, 0)).toThrow(RangeError);
    expect(() => blockIndex(0, -1, 0)).toThrow(RangeError);
    expect(() => blockIndex(0, 0, -1)).toThrow(RangeError);
  });

  it("rejects the first coordinate past the end on every axis", () => {
    expect(() => blockIndex(CHUNK_SIZE_X, 0, 0)).toThrow(RangeError);
    expect(() => blockIndex(0, CHUNK_SIZE_Y, 0)).toThrow(RangeError);
    expect(() => blockIndex(0, 0, CHUNK_SIZE_Z)).toThrow(RangeError);
  });

  it("rejects fractional coordinates", () => {
    expect(() => blockIndex(0.5, 0, 0)).toThrow(RangeError);
    expect(() => blockIndex(0, 0.1, 0)).toThrow(RangeError);
    expect(() => blockIndex(0, 0, 15.999)).toThrow(RangeError);
  });

  it("rejects NaN and Infinity", () => {
    expect(() => blockIndex(Number.NaN, 0, 0)).toThrow(RangeError);
    expect(() => blockIndex(0, Number.NaN, 0)).toThrow(RangeError);
    expect(() => blockIndex(0, 0, Number.NaN)).toThrow(RangeError);
    expect(() => blockIndex(Number.POSITIVE_INFINITY, 0, 0)).toThrow(RangeError);
    expect(() => blockIndex(0, Number.NEGATIVE_INFINITY, 0)).toThrow(RangeError);
  });

  it("rejects huge coordinates that lose integer precision", () => {
    expect(() => blockIndex(2 ** 53, 0, 0)).toThrow(RangeError);
    expect(() => blockIndex(1e21, 0, 0)).toThrow(RangeError);
    expect(() => blockIndex(0, 0, 1e21)).toThrow(RangeError);
  });

  it("rejects non-number types", () => {
    // A string that looks like a number must not slip through: "1" is not
    // an integer coordinate, it is a string.
    expect(() => blockIndex("1" as unknown as number, 0, 0)).toThrow(RangeError);
    expect(() => blockIndex(null as unknown as number, 0, 0)).toThrow(RangeError);
    expect(() => blockIndex(undefined as unknown as number, 0, 0)).toThrow(RangeError);
    expect(() => blockIndex(true as unknown as number, 0, 0)).toThrow(RangeError);
  });

  it("rejects -0.5 but accepts -0 (which is 0)", () => {
    expect(() => blockIndex(-0.5, 0, 0)).toThrow(RangeError);
    expect(blockIndex(-0, 0, 0)).toBe(0);
  });
});

describe("blockIndex — the frozen storage order and the bijection property", () => {
  it("matches the documented y-major formula", () => {
    for (const [x, y, z] of [
      [0, 0, 0],
      [1, 2, 3],
      [15, 255, 15],
      [7, 128, 9],
    ] as const) {
      expect(blockIndex(x, y, z)).toBe(x + CHUNK_SIZE_X * (z + CHUNK_SIZE_Z * y));
    }
  });

  it("maps the whole 16x256x16 space onto 0..65535 with no gaps and no collisions", () => {
    // 65536 entries: a full bijection over the chunk volume. A collision
    // would mean two different blocks share a storage slot; a gap would
    // mean part of the chunk is unreachable.
    const seen = new Uint8Array(CHUNK_VOLUME);
    let collisions = 0;
    let outOfRange = 0;
    for (let y = 0; y < CHUNK_SIZE_Y; y++) {
      for (let z = 0; z < CHUNK_SIZE_Z; z++) {
        for (let x = 0; x < CHUNK_SIZE_X; x++) {
          const index = blockIndex(x, y, z);
          if (index < 0 || index >= CHUNK_VOLUME) {
            outOfRange++;
            continue;
          }
          if (seen[index] === 1) collisions++;
          seen[index] = 1;
        }
      }
    }
    expect(collisions).toBe(0);
    expect(outOfRange).toBe(0);
    let covered = 0;
    for (const seenByte of seen) covered += seenByte;
    expect(covered).toBe(CHUNK_VOLUME);
  });

  it("puts consecutive x values in consecutive slots (the x axis is the fast axis)", () => {
    for (const [y, z] of [
      [0, 0],
      [5, 9],
      [255, 15],
    ] as const) {
      for (let x = 0; x < CHUNK_SIZE_X - 1; x++) {
        expect(blockIndex(x + 1, y, z) - blockIndex(x, y, z)).toBe(1);
      }
    }
  });

  it("puts a whole x-row of one y-layer in one contiguous run", () => {
    // y-major: all (x, z) for one y are contiguous, then the next y layer.
    const first = blockIndex(0, 3, 0);
    const last = blockIndex(CHUNK_SIZE_X - 1, 3, CHUNK_SIZE_Z - 1);
    expect(last - first).toBe(CHUNK_SIZE_X * CHUNK_SIZE_Z - 1);
  });
});

describe("chunk keys — the well-formed path must round-trip", () => {
  it("round-trips ordinary coordinates", () => {
    for (const key of [
      { cx: 0, cz: 0 },
      { cx: 1, cz: 2 },
      { cx: -1, cz: -1 },
      { cx: 1000, cz: -1000 },
    ]) {
      expect(chunkKeyFromString(chunkKeyToString(key))).toEqual(key);
    }
  });

  it("round-trips the extremes of the signed 32-bit range", () => {
    for (const key of [
      { cx: 2147483647, cz: 2147483647 },
      { cx: -2147483648, cz: -2147483648 },
    ]) {
      expect(chunkKeyFromString(chunkKeyToString(key))).toEqual(key);
    }
  });

  it("produces the documented string form", () => {
    expect(chunkKeyToString({ cx: 3, cz: -4 })).toBe("3,-4");
  });

  it("keeps negative coordinates signed (no sign folding)", () => {
    expect(chunkKeyToString({ cx: -1, cz: -1 })).toBe("-1,-1");
    expect(chunkKeyFromString("-1,-1")).toEqual({ cx: -1, cz: -1 });
  });

  it("rejects a key with the wrong number of fields", () => {
    expect(() => chunkKeyFromString("1")).toThrow();
    expect(() => chunkKeyFromString("1,2,3")).toThrow();
  });
});
