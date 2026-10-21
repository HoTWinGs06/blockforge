/**
 * BlockForge — RED-TEAM finding F2: chunkKeyFromString accepts malformed keys.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/). Owner of the fix: ARCHITECT (opencode)
 * — src/core/constants.ts is theirs.
 *
 * STATUS: FIXED (T41). The parser now accepts only a canonical decimal
 * integer literal, so every malformed key is rejected and chunkKeyFromString
 * is a true inverse of chunkKeyToString. The armed `it.fails` stubs have
 * been converted to plain `it` regression guards asserting the FIXED
 * behaviour.
 *
 * THE PROMISE
 * -----------
 * docs/API.md:
 *
 *     | `chunkKeyFromString(text)` | `ChunkKey` | throws `Error` on malformed input |
 *
 * and in src/core/constants.ts:
 *
 *     /** Inverse of {@link chunkKeyToString}. *\/
 *     export function chunkKeyFromString(text: string): { cx: number; cz: number }
 *
 * So the contract is twofold:
 *   1. malformed input throws;
 *   2. it is the INVERSE of chunkKeyToString — the two round-trip.
 *
 * THE HOLE (as it was)
 * --------------------
 * The guard was `Number.isInteger(Number(part))`. `Number()` is a far more
 * permissive parser than "an integer literal":
 *
 *   Number("")      === 0      -> ""     is accepted as 0
 *   Number(" ")     === 0      -> " "    is accepted as 0
 *   Number("0x10")  === 16     -> hex is accepted
 *   Number("1e3")   === 1000   -> exponent is accepted
 *   Number("+5")    === 5      -> leading sign is accepted
 *   Number("0b101") === 5      -> binary is accepted
 *   Number("1.0")   === 1      -> "1.0" is accepted as 1
 *   Number("1e21")  === 1e21   -> an absurd coordinate is accepted
 *
 * The comma split also meant "1," (a trailing empty field) parsed as
 * {cx:1, cz:0} — the SAME chunk as the well-formed "1,0". Two different
 * strings for one chunk breaks the inverse property and, worse, means a
 * corrupt save file could silently address the wrong chunk instead of being
 * rejected.
 *
 * WHY IT MATTERED
 * ---------------
 * The save format (M2) and the network protocol (M4) both key chunks by
 * this string. A save file with a corrupted key must be REJECTED, not
 * silently reinterpreted as a different, valid chunk. Gate G4 requires the
 * server to reject 100% of malformed input, and this is the first function
 * that touches such input.
 */

import { describe, expect, it } from "vitest";
import { chunkKeyFromString, chunkKeyToString } from "../../src/core/index.js";

/** Malformed keys — every one of them MUST be rejected. */
const MALFORMED: readonly string[] = [
  ",,", // three fields
  "", // empty string
  " ", // whitespace only
  "abc,def", // not a number
  "NaN,0", // NaN
  "Infinity,0", // Infinity
  "1,2,3", // three fields
  ",", // two empty fields -> 0,0
  "1,", // trailing empty field -> 1,0
  ",1", // leading empty field -> 0,1
  " , ", // whitespace only -> 0,0
  "0x10,2", // hexadecimal
  "1e3,2", // exponent
  "+5,5", // explicit plus sign
  "0b101,0", // binary
  "1.0,2", // float syntax for an integer
  "1e21,2", // absurd coordinate
  " 1 , 2 ", // padded
];

/** Well-formed keys that MUST be accepted. */
const WELL_FORMED: readonly string[] = ["0,0", "1,0", "-1,-1", "0,-1", "2147483647,-2147483648"];

describe("F2 — control: the current parser's actual behaviour", () => {
  it("control: chunkKeyFromString rejects a bare comma", () => {
    expect(() => chunkKeyFromString(",")).toThrow();
  });

  it("control: chunkKeyFromString rejects hexadecimal", () => {
    expect(() => chunkKeyFromString("0x10,2")).toThrow();
  });

  it("control: '1,' is rejected outright, so it cannot alias '1,0'", () => {
    expect(() => chunkKeyFromString("1,")).toThrow();
    expect(chunkKeyFromString("1,0")).toEqual({ cx: 1, cz: 0 });
  });
});

describe("F2 — chunkKeyFromString must reject malformed input", () => {
  for (const text of MALFORMED) {
    it(`rejects ${JSON.stringify(text)}`, () => {
      expect(() => chunkKeyFromString(text)).toThrow();
    });
  }
});

describe("F2 — chunkKeyFromString must remain the inverse of chunkKeyToString", () => {
  it("F2: round-tripping a parsed key must give back the same string", () => {
    for (const text of WELL_FORMED) {
      const parsed = chunkKeyFromString(text);
      expect(chunkKeyToString(parsed)).toBe(text);
    }
  });

  it("F2: two different key strings must never address the same chunk", () => {
    const seen = new Map<string, string>();
    for (const text of WELL_FORMED) {
      const parsed = chunkKeyFromString(text);
      const canonical = chunkKeyToString(parsed);
      const previous = seen.get(canonical);
      expect(previous).toBeUndefined();
      seen.set(canonical, text);
    }
  });

  it("F2: a malformed key must never resolve to a chunk at all", () => {
    // The stronger form of the inverse property: because every malformed
    // key throws, there is no string left that can silently address the
    // same chunk as a well-formed one.
    const canonical = new Set(WELL_FORMED.map((k) => chunkKeyToString(chunkKeyFromString(k))));
    for (const text of MALFORMED) {
      let resolved: string | null;
      try {
        resolved = chunkKeyToString(chunkKeyFromString(text));
      } catch {
        resolved = null;
      }
      expect(resolved).toBeNull();
      // And it cannot collide with a well-formed chunk either.
      expect(canonical.has(resolved ?? "")).toBe(false);
    }
  });
});

describe("F2 — well-formed keys must keep working (regression guard)", () => {
  for (const text of WELL_FORMED) {
    it(`accepts ${text}`, () => {
      const key = chunkKeyFromString(text);
      expect(Number.isInteger(key.cx)).toBe(true);
      expect(Number.isInteger(key.cz)).toBe(true);
      expect(chunkKeyToString(key)).toBe(text);
    });
  }
});
