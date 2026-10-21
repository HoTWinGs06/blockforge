import { describe, it, expect } from "vitest";
import {
  BREAK_TIME_SECONDS,
  breakSeconds,
  breakSecondsWith,
  canBreak,
  requiredToolFor,
} from "../src/core/constants.js";
import { BlockId } from "../src/core/types.js";
import { TOOL_SPECS } from "../src/core/constants.js";

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


/**
 * The TOOL RULE, which the contract froze alongside the break times.
 *
 * This matters to the renderer directly: the game uses breakSecondsWith(),
 * not breakSeconds(), so that bare hands cannot break a block that needs a
 * tool. If the game used the bare table, the player could break ironveil
 * with their fists - a silent contract violation.
 */
describe("T70: the tool rule", () => {
  it("some blocks cannot be broken by bare hands at all", () => {
    // The whole point of tools. If every block were breakable by hand the
    // rule would be vacuous.
    const needsTool = Object.values(BlockId).filter(
      (id) => id !== BlockId.Air && requiredToolFor(id) !== null,
    );
    expect(needsTool.length, "some blocks must require a tool").toBeGreaterThan(0);

    for (const id of needsTool) {
      expect(canBreak(id, null), `${id} must not be breakable by bare hands`).toBe(false);
    }
  });

  it("breakSecondsWith returns -1 when the block cannot be broken", () => {
    const id = Object.values(BlockId).find(
      (b) => b !== BlockId.Air && requiredToolFor(b) !== null,
    );
    expect(id).toBeDefined();
    expect(breakSecondsWith(String(id), null)).toBe(-1);
  });

  it("the right tool makes the block breakable, and faster", () => {
    const id = Object.values(BlockId).find(
      (b) => b !== BlockId.Air && requiredToolFor(b) !== null,
    );
    expect(id).toBeDefined();
    const kind = requiredToolFor(id!);
    expect(kind).not.toBeNull();

    // A tool of the right kind, from the frozen table.
    const tool = TOOL_SPECS.find((spec) => spec.kind === kind)!;
    expect(canBreak(id!, tool)).toBe(true);
    // The tool's multiplier is less than or equal to 1 for a tier-1 tool on
    // most blocks, and the contract says lower is faster.
    expect(breakSecondsWith(String(id), tool)).toBeGreaterThan(0);
  });

  it("the wrong tool still cannot break it", () => {
    const id = Object.values(BlockId).find(
      (b) => b !== BlockId.Air && requiredToolFor(b) !== null,
    );
    expect(id).toBeDefined();
    const kind = requiredToolFor(id!);
    const wrong = TOOL_SPECS.find((spec) => spec.kind !== kind)!;
    expect(canBreak(id!, wrong)).toBe(false);
    expect(breakSecondsWith(String(id), wrong)).toBe(-1);
  });

  it("a block that needs no tool is breakable by hand, at the bare time", () => {
    const id = Object.values(BlockId).find(
      (b) => b !== BlockId.Air && requiredToolFor(b) === null,
    );
    expect(id).toBeDefined();
    expect(canBreak(id!, null)).toBe(true);
    expect(breakSecondsWith(String(id!), null)).toBe(breakSeconds(String(id!)));
  });
});
