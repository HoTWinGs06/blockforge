import { describe, it, expect } from "vitest";
import { BREAK_TIME_SECONDS, breakSeconds } from "../src/core/constants.js";
import { BlockId } from "../src/core/types.js";

/**
 * T70 GUARD: every block must have its own break time, and the times must be
 * the ones the core contract froze.
 *
 * The operator said "make every block have different breaking speeds". The
 * contract froze the table (BREAK_TIME_SECONDS / breakSeconds) and the
 * renderer consumes it. This pins the properties the operator asked for, so a
 * future edit to the table cannot quietly flatten the timings again.
 */
describe("T70: every block has its own break time", () => {
  it("every block kind has a break time", () => {
    for (const id of Object.values(BlockId)) {
      expect(
        BREAK_TIME_SECONDS[id],
        `${id} must have a break time`,
      ).toBeDefined();
    }
  });

  it("no two blocks break at the same speed", () => {
    // The operator's words: EVERY block breaks at its OWN speed. So the
    // durations must all be distinct, not merely "some are different".
    const seen = new Map<string, string>();
    for (const [id, seconds] of Object.entries(BREAK_TIME_SECONDS)) {
      const key = String(seconds);
      expect(
        seen.has(key),
        `${id} and ${seen.get(key)} both take ${key}s - every block must differ`,
      ).toBe(false);
      seen.set(key, id);
    }
  });

  it("the times are ordered sensibly - softer blocks are faster", () => {
    // A cross-check against the operator's intuition, so the table cannot be
    // permuted into something arbitrary without the tests noticing.
    const time = (id: BlockId): number => BREAK_TIME_SECONDS[id] ?? -1;
    expect(time(BlockId.Foliage)).toBeLessThan(time(BlockId.Loam));
    expect(time(BlockId.Loam)).toBeLessThan(time(BlockId.Slate));
    expect(time(BlockId.Slate)).toBeLessThan(time(BlockId.Voidstone));
  });

  it("the extremes are the ones the contract froze", () => {
    expect(BREAK_TIME_SECONDS[BlockId.Foliage]).toBe(0.1);
    expect(BREAK_TIME_SECONDS[BlockId.Voidstone]).toBe(9.0);
    expect(BREAK_TIME_SECONDS[BlockId.Air]).toBe(0);
  });

  it("breakSeconds() falls back safely for an unknown kind", () => {
    // An unknown block must not break instantly, and must not throw.
    expect(breakSeconds("not-a-block")).toBe(9.0);
    expect(breakSeconds(BlockId.Slate)).toBe(BREAK_TIME_SECONDS[BlockId.Slate]);
  });

  it("no block breaks instantly", () => {
    // Air is not breakable, so it is exempt; everything else takes real time.
    for (const [id, seconds] of Object.entries(BREAK_TIME_SECONDS)) {
      if (id === BlockId.Air) {
        continue;
      }
      expect(seconds, `${id} must take a measurable amount of time`).toBeGreaterThan(0);
    }
  });
});
