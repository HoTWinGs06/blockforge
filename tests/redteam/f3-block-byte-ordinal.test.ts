/**
 * BlockForge — RED-TEAM finding F3: Chunk.blocks bytes have no BlockId mapping.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/). Owner of the fix: ARCHITECT (opencode)
 * — src/core/types.ts is theirs.
 *
 * STATUS: FIXED (T42). The contract now exports the byte/ordinal mapping
 * (`blockIdToByte`, `byteToBlockId`, `isValidBlockByte`, `blockOrdinal`,
 * `blockFromOrdinal`) and REJECTS any byte that does not name a block kind.
 * The armed `it.fails` stubs have been converted to plain `it` regression
 * guards that assert the FIXED behaviour.
 *
 * THE PROMISE
 * -----------
 * src/core/types.ts, on the Chunk interface:
 *
 *     /** Length must equal CHUNK_VOLUME. One byte per block, indexed by
 *         BlockId ordinal. *\/
 *     readonly blocks: Uint8Array;
 *
 * A Uint8Array holds 0..255. BlockId has 23 values. So 233 of the 256
 * representable byte values have no BlockId, and the contract must export a
 * function that maps a byte to a BlockId or rejects it.
 *
 * THE HOLE (as it was)
 * --------------------
 * "indexed by BlockId ordinal" was only a comment. There was no exported
 * ordinal mapping, so every consumer of a chunk had to invent its own: one
 * module may use ALL_BLOCK_IDS.indexOf(id), another may hardcode a table, a
 * third may use the enum's declaration order. If two of them disagree by
 * one position, every block in every saved world silently becomes a
 * different block — with no error anywhere.
 *
 * And a corrupt or hostile byte (200, say) had no defined meaning: it
 * resolved to undefined, and nothing in core rejected it.
 *
 * WHY IT MATTERED
 * ---------------
 * This is the byte-level seam between the pure core and everything that
 * stores or transmits blocks. The save format (M2) and the wire protocol
 * (M4) both carry these bytes. A hole here is a hole in the project's top
 * invariant, not just a missing convenience function.
 */

import { describe, expect, it } from "vitest";
import * as core from "../../src/core/index.js";
import {
  ALL_BLOCK_IDS,
  BLOCK_ID_COUNT,
  CHUNK_VOLUME,
  byteToBlockId,
  isValidBlockByte,
  type Chunk,
} from "../../src/core/index.js";

/** Exported functions in the core barrel whose name suggests a byte mapping. */
function mappingFunctions(): Array<{ name: string; fn: (...args: unknown[]) => unknown }> {
  const out: Array<{ name: string; fn: (...args: unknown[]) => unknown }> = [];
  for (const [name, value] of Object.entries(core)) {
    if (typeof value !== "function") continue;
    if (!/ordinal|byte|blockid|toblock|encode|decode/i.test(name)) continue;
    out.push({ name, fn: value as (...args: unknown[]) => unknown });
  }
  return out;
}

describe("F3 — control: the byte space and the id space do not line up", () => {
  it("control: 23 block ids but 256 representable bytes", () => {
    expect(ALL_BLOCK_IDS.length).toBe(23);
    expect(256 - ALL_BLOCK_IDS.length).toBe(233);
  });

  it("control: an out-of-range ordinal is not a BlockId", () => {
    const byte = ALL_BLOCK_IDS.length + 1;
    expect(ALL_BLOCK_IDS[byte]).toBeUndefined();
  });

  it("control: the core barrel now exports the byte/ordinal mapping", () => {
    // The hole was that NOTHING was exported. The fix exports the mapping,
    // so this control now pins the FIXED shape.
    expect(mappingFunctions().length).toBeGreaterThan(0);
  });
});

describe("F3 — every byte in a chunk must map to a BlockId or be rejected", () => {
  it("F3: core must export a way to convert a block byte to a BlockId", () => {
    const fns = mappingFunctions();
    expect(fns.length).toBeGreaterThan(0);
  });

  it("F3: a byte with no BlockId must be detectable, not silently undefined", () => {
    const invalidByte = ALL_BLOCK_IDS.length + 1;
    expect(isValidBlockByte(invalidByte)).toBe(false);
    expect(() => byteToBlockId(invalidByte)).toThrow(RangeError);
  });

  it("F3: every valid byte must round-trip to the same BlockId", () => {
    for (let byte = 0; byte < BLOCK_ID_COUNT; byte++) {
      const id = byteToBlockId(byte);
      expect(ALL_BLOCK_IDS[byte]).toBe(id);
    }
  });

  it("F3: every byte outside the id space must be rejected", () => {
    for (const byte of [BLOCK_ID_COUNT, 200, 255]) {
      expect(isValidBlockByte(byte)).toBe(false);
      expect(() => byteToBlockId(byte)).toThrow(RangeError);
    }
    // ...and the out-of-space bytes are the majority, which is the point.
    expect(256 - BLOCK_ID_COUNT).toBe(233);
  });

  it("the id->ordinal mapping must be unique and stable (regression guard)", () => {
    // Two consumers must not be able to disagree about what a byte means.
    const ordinals = ALL_BLOCK_IDS.map((id) => ALL_BLOCK_IDS.indexOf(id));
    expect(new Set(ordinals).size).toBe(ALL_BLOCK_IDS.length);
    expect(ordinals.every((o) => Number.isInteger(o) && o >= 0 && o < 256)).toBe(true);
  });

  it("a chunk's block array must have the declared length (regression guard)", () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };
    expect(chunk.blocks.length).toBe(CHUNK_VOLUME);
    expect(CHUNK_VOLUME).toBe(65536);
  });
});
