/**
 * BlockForge — RED-TEAM finding F4: chunkKeyToString emits strings its own
 * inverse rejects.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/). Owner of the fix: ARCHITECT (opencode)
 * — src/core/constants.ts is theirs.
 *
 * THE PROMISE
 * -----------
 * src/core/constants.ts:
 *
 *     /** Stable string form of a chunk key. Used for map keys and save files. *\/
 *     export function chunkKeyToString(key: { cx: number; cz: number }): string
 *
 *     /** Inverse of {@link chunkKeyToString}. *\/
 *     export function chunkKeyFromString(text: string): { cx: number; cz: number }
 *
 * If one is the inverse of the other, then whatever chunkKeyToString emits
 * must be readable back.
 *
 * THE HOLE
 * --------
 * chunkKeyToString does no validation at all — it interpolates whatever
 * numbers it is handed. So it happily emits:
 *
 *     chunkKeyToString({ cx: 1.5, cz: 2 })  -> "1.5,2"   (inverse THROWS)
 *     chunkKeyToString({ cx: NaN, cz: 0 })  -> "NaN,0"   (inverse THROWS)
 *     chunkKeyToString({ cx: Infinity, cz: 0 }) -> "Infinity,0" (inverse THROWS)
 *
 * A key that the engine can produce but the save file cannot read back is a
 * silent data-loss path: the world is written, and on reload the chunk
 * cannot be addressed.
 *
 * REPRO
 * -----
 *     chunkKeyToString({ cx: 1.5, cz: 2 }) === "1.5,2"
 *     chunkKeyFromString("1.5,2")            // throws
 *
 * FIX DIRECTION (for the owner)
 * -----------------------------
 * chunkKeyToString should validate that cx and cz are safe integers and
 * throw otherwise, so the two functions really are inverses over the same
 * domain. (Note: -0 must survive as "0" — see the control below.)
 */

import { describe, expect, it } from "vitest";
import { chunkKeyFromString, chunkKeyToString } from "../../src/core/index.js";

describe("F4 — control: the current serialiser's actual behaviour", () => {
  it("control: chunkKeyToString currently emits '1.5,2' for a fractional key", () => {
    expect(chunkKeyToString({ cx: 1.5, cz: 2 })).toBe("1.5,2");
  });

  it("control: that emitted string cannot be read back", () => {
    expect(() => chunkKeyFromString("1.5,2")).toThrow();
  });

  it("control: -0 already serialises as '0'", () => {
    expect(chunkKeyToString({ cx: -0, cz: 0 })).toBe("0,0");
  });
});

describe("F4 — chunkKeyToString must not emit unreadable keys", () => {
  it.fails("F4: a fractional coordinate must be rejected at serialisation time", () => {
    expect(() => chunkKeyToString({ cx: 1.5, cz: 2 })).toThrow();
  });

  it.fails("F4: NaN must be rejected at serialisation time", () => {
    expect(() => chunkKeyToString({ cx: Number.NaN, cz: 0 })).toThrow();
  });

  it.fails("F4: Infinity must be rejected at serialisation time", () => {
    expect(() => chunkKeyToString({ cx: 0, cz: Number.POSITIVE_INFINITY })).toThrow();
  });

  it.fails("F4: whatever is serialised must be readable back", () => {
    const keys = [
      { cx: 0, cz: 0 },
      { cx: -1, cz: -1 },
      { cx: 1.5, cz: 2 },
      { cx: Number.NaN, cz: 0 },
      { cx: Number.POSITIVE_INFINITY, cz: 0 },
    ];
    for (const key of keys) {
      let text: string;
      try {
        text = chunkKeyToString(key);
      } catch {
        continue; // rejected at serialisation: correct behaviour
      }
      expect(() => chunkKeyFromString(text)).not.toThrow();
    }
  });
});
