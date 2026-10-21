/**
 * BlockForge — RED-TEAM finding F2: chunkKeyFromString accepts malformed keys.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/). Owner of the fix: ARCHITECT (opencode)
 * — src/core/constants.ts is theirs.
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
 * THE HOLE
 * --------
 * The guard is `Number.isInteger(Number(part))`. `Number()` is a far more
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
 * The comma split also means "1," (a trailing empty field) parses as
 * {cx:1, cz:0} — the SAME chunk as the well-formed "1,0". Two different
 * strings for one chunk breaks the inverse property and, worse, means a
 * corrupt save file can silently address the wrong chunk instead of being
 * rejected.
 *
 * WHY IT MATTERS HERE
 * -------------------
 * The save format (M2) and the network protocol (M4) both key chunks by
 * this string. A save file with a corrupted key must be REJECTED, not
 * silently reinterpreted as a different, valid chunk. Gate G4 requires the
 * server to reject 100% of malformed input, and this is the first function
 * that touches such input.
 *
 * REPRO
 * -----
 *     chunkKeyFromString(",");      // { cx: 0, cz: 0 }  — should throw
 *     chunkKeyFromString("0x10,2")  // { cx: 16, cz: 2 } — should throw
 *     chunkKeyFromString("1,");     // { cx: 1, cz: 0 }  — should throw
 *
 * FIX DIRECTION (for the owner)
 * -----------------------------
 * Validate the SHAPE before parsing: each part must match /^-?\d+$/ and
 * then Number() it. That rejects "", " ", "0x10", "1e3", "+5", "0b101",
 * "1.0" and "1," in one stroke, and keeps the inverse property true.
 */

import { describe, expect, it } from "vitest";
import { chunkKeyFromString, chunkKeyToString } from "../../src/core/index.js";

/** Malformed keys that are ALREADY rejected today — regression guards. */
const ALREADY_REJECTED: readonly string[] = [
  ",,", // three fields
  "", // empty string
  " ", // whitespace only
  "abc,def", // not a number
  "NaN,0", // NaN
  "Infinity,0", // Infinity
  "1,2,3", // three fields
];

/** Malformed keys that are CURRENTLY ACCEPTED — this is the finding. */
const WRONGLY_ACCEPTED: readonly string[] = [
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

/** Every malformed key, for the whole-set properties below. */
const MALFORMED: readonly string[] = [...ALREADY_REJECTED, ...WRONGLY_ACCEPTED];

/** Well-formed keys that MUST be accepted. */
const WELL_FORMED: readonly string[] = ["0,0", "1,0", "-1,-1", "0,-1", "2147483647,-2147483648"];

describe("F2 — control: the current parser's actual behaviour", () => {
  it("control: chunkKeyFromString currently accepts a bare comma", () => {
    // Pins the CURRENT (buggy) behaviour so the probe is proven live.
    expect(chunkKeyFromString(",")).toEqual({ cx: 0, cz: 0 });
  });

  it("control: chunkKeyFromString currently accepts hexadecimal", () => {
    expect(chunkKeyFromString("0x10,2")).toEqual({ cx: 16, cz: 2 });
  });

  it("control: '1,' and '1,0' currently address the SAME chunk", () => {
    expect(chunkKeyFromString("1,")).toEqual(chunkKeyFromString("1,0"));
  });
});

describe("F2 — chunkKeyFromString must reject malformed input", () => {
  for (const text of ALREADY_REJECTED) {
    it(`rejects ${JSON.stringify(text)} (already correct — regression guard)`, () => {
      expect(() => chunkKeyFromString(text)).toThrow();
    });
  }

  for (const text of WRONGLY_ACCEPTED) {
    it.fails(`F2: must reject ${JSON.stringify(text)}`, () => {
      expect(() => chunkKeyFromString(text)).toThrow();
    });
  }
});

describe("F2 — chunkKeyFromString must remain the inverse of chunkKeyToString", () => {
  it.fails("F2: round-tripping a parsed key must give back the same string", () => {
    for (const text of MALFORMED) {
      let parsed: { cx: number; cz: number };
      try {
        parsed = chunkKeyFromString(text);
      } catch {
        continue; // rejected outright: correct behaviour
      }
      expect(chunkKeyToString(parsed)).toBe(text);
    }
  });

  it.fails("F2: two different key strings must never address the same chunk", () => {
    const seen = new Map<string, string>();
    for (const text of [...MALFORMED, ...WELL_FORMED]) {
      let parsed: { cx: number; cz: number };
      try {
        parsed = chunkKeyFromString(text);
      } catch {
        continue; // rejected outright: correct behaviour
      }
      const canonical = chunkKeyToString(parsed);
      const previous = seen.get(canonical);
      expect(previous).toBeUndefined();
      seen.set(canonical, text);
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
