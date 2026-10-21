/**
 * BlockForge — PRIORITY 3: Seeded PRNG specification (src/core/rng.ts).
 *
 * OWNERSHIP: TEST AUTHOR (tests/).
 *
 * The PRNG is the project's ONLY source of randomness, so every
 * determinism guarantee downstream rests on it. The properties pinned here:
 *
 *   1. the same seed produces the same stream, in any process;
 *   2. `fork(label)` derives a child stream from (seed, label) ALONE, so
 *      subsystems never interfere with each other or with generation
 *      order;
 *   3. `getState`/`setState` round-trip exactly, so a game can save and
 *      restore mid-generation;
 *   4. `nextInt` respects BOTH bounds, and `nextUint32` covers the full
 *      uint32 range rather than a small slice of it.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { createRng, createRngFromState } from "../src/core/rng.js";
import type { SeededRng } from "../src/core/types.js";

const TWO_POW_32 = 4294967296;

describe("PRIORITY 3: Seeded PRNG Specification (src/core/rng.ts)", () => {
  it("generates deterministic uint32 stream for identical seeds", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const rngA = createRng(seed);
        const rngB = createRng(seed);

        for (let i = 0; i < 100; i++) {
          expect(rngA.nextUint32()).toBe(rngB.nextUint32());
        }
      }),
    );
  });

  it("generates deterministic float stream in [0, 1) for identical seeds", () => {
    const rngA = createRng(42);
    const rngB = createRng(42);

    for (let i = 0; i < 100; i++) {
      const valA = rngA.nextFloat();
      const valB = rngB.nextFloat();
      expect(valA).toBe(valB);
      expect(valA).toBeGreaterThanOrEqual(0);
      expect(valA).toBeLessThan(1);
    }
  });

  it("nextInt generates integers within [minInclusive, maxExclusive)", () => {
    const rng = createRng(12345);
    for (let i = 0; i < 200; i++) {
      const val = rng.nextInt(5, 15);
      expect(Number.isInteger(val)).toBe(true);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThan(15);
    }
  });

  it("nextInt respects BOTH bounds, including the exclusive upper bound", () => {
    // The lower bound is inclusive and the upper bound is exclusive, so
    // the result must never equal the upper bound.
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const val = rng.nextInt(3, 4);
      expect(val).toBeGreaterThanOrEqual(3);
      expect(val).toBeLessThan(4);
      // With a span of 1 there is exactly one legal answer.
      expect(val).toBe(3);
    }
  });

  it("nextInt with equal bounds returns that bound", () => {
    expect(createRng(7).nextInt(4, 4)).toBe(4);
  });

  it("nextInt rejects non-integer bounds", () => {
    const rng = createRng(7);
    expect(() => rng.nextInt(0.5, 3)).toThrow(RangeError);
    expect(() => rng.nextInt(0, 3.5)).toThrow(RangeError);
  });

  it("nextInt rejects an upper bound below the lower bound", () => {
    const rng = createRng(7);
    expect(() => rng.nextInt(5, 3)).toThrow(RangeError);
  });

  it("nextUint32 stays inside the uint32 range and covers it", () => {
    // 2000 draws is ample to reach both ends of the range (checked
    // against several seeds), and keeps the test fast under the
    // coverage instrumentation.
    const rng = createRng(12345);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sawLowHalf = false;
    let sawHighHalf = false;
    for (let i = 0; i < 2000; i++) {
      const value = rng.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(TWO_POW_32);
      if (value < min) min = value;
      if (value > max) max = value;
      if (value < TWO_POW_32 / 2) sawLowHalf = true;
      else sawHighHalf = true;
    }
    // The stream must reach both ends of the uint32 range, not just a
    // narrow band of it.
    expect(sawLowHalf).toBe(true);
    expect(sawHighHalf).toBe(true);
    expect(min).toBeLessThan(TWO_POW_32 / 1000);
    expect(max).toBeGreaterThan((TWO_POW_32 * 999) / 1000);
  });

  it("fork(label) produces independent and deterministic child streams", () => {
    const root1 = createRng(777);
    const root2 = createRng(777);

    const terrain1 = root1.fork("terrain");
    const terrain2 = root2.fork("terrain");
    const biomes1 = root1.fork("biomes");

    for (let i = 0; i < 50; i++) {
      expect(terrain1.nextUint32()).toBe(terrain2.nextUint32());
    }

    const terrainVal = terrain1.nextUint32();
    const biomeVal = biomes1.nextUint32();
    expect(terrainVal).not.toBe(biomeVal);
  });

  it("forking the same label twice from one parent gives the same stream", () => {
    // fork() does not advance the parent, so two forks of the same label
    // from the same parent are the same stream. This is a regression
    // guard: it holds whether or not fork() is order-dependent.
    const parent = createRng(42);
    const first = parent.fork("terrain");
    const second = parent.fork("terrain");
    for (let i = 0; i < 20; i++) {
      expect(first.nextUint32()).toBe(second.nextUint32());
    }
  });

  it("different labels give different child streams", () => {
    const parent = createRng(42);
    const a = parent.fork("terrain");
    const b = parent.fork("biomes");
    const valuesA: number[] = [];
    const valuesB: number[] = [];
    for (let i = 0; i < 20; i++) {
      valuesA.push(a.nextUint32());
      valuesB.push(b.nextUint32());
    }
    expect(valuesA).not.toEqual(valuesB);
  });

  // RED-TEAM finding E2 (board T45). The engine's first handoff claimed
  // this was fixed and it was not: fork() derived the child seed from
  // `this.state` — the parent's CURRENT state — rather than from the
  // parent's seed, so the same label forked at a different point in the
  // parent's life gave a different child stream, and terrain changed
  // depending on the order subsystems happened to draw in.
  //
  // FIXED by the engine on feature/engine/fix-e1-e2-tunnel: fork() now
  // derives the child from `this.seed`. This test was an `it.fails` until
  // that fix landed; it flipped RED to announce the closure, and is now a
  // plain `it` that asserts the FIXED behaviour and must stay passing.
  it("E2: fork must depend only on (seed, label), not on the parent's history", () => {
    const early = createRng(42).fork("terrain");
    const lateParent = createRng(42);
    lateParent.nextUint32();
    const late = lateParent.fork("terrain");
    for (let i = 0; i < 20; i++) {
      expect(early.nextUint32()).toBe(late.nextUint32());
    }
  });

  it("E2: fork is independent of how much of the parent was consumed", () => {
    // The same property over a range of consumption histories, not just
    // one draw: a parent that has been drawn from N times must still
    // fork the same child stream as a fresh one.
    for (let draws = 0; draws <= 8; draws++) {
      const fresh = createRng(1234).fork("terrain");
      const consumed = createRng(1234);
      for (let i = 0; i < draws; i++) consumed.nextUint32();
      const child = consumed.fork("terrain");
      for (let i = 0; i < 10; i++) {
        expect(fresh.nextUint32()).toBe(child.nextUint32());
      }
    }
  });

  it("control: two fresh parents with the same seed fork the same label to the same stream", () => {
    // True before and after the E2 fix, so this control never needed
    // converting: it proves the probe is live without pinning the bug.
    const a = createRng(42).fork("terrain");
    const b = createRng(42).fork("terrain");
    for (let i = 0; i < 20; i++) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
  });

  it("getState() and setState() allow exact checkpoint and restore", () => {
    const rng = createRng(999);
    for (let i = 0; i < 25; i++) {
      rng.nextUint32();
    }

    const checkpoint = rng.getState();
    const nextThree1 = [rng.nextUint32(), rng.nextUint32(), rng.nextUint32()];

    rng.setState(checkpoint);
    const nextThree2 = [rng.nextUint32(), rng.nextUint32(), rng.nextUint32()];

    expect(nextThree1).toEqual(nextThree2);
  });

  it("getState() reports the seed and the current state", () => {
    const rng = createRng(1234);
    const state = rng.getState();
    expect(state.seed).toBe(1234);
    expect(state.state).toBe(1234);
    // Drawing advances the state but not the seed.
    rng.nextUint32();
    const after = rng.getState();
    expect(after.seed).toBe(1234);
    expect(after.state).not.toBe(1234);
  });

  it("createRngFromState() restores a stream exactly", () => {
    const rng = createRng(4321);
    for (let i = 0; i < 10; i++) {
      rng.nextUint32();
    }
    const state = rng.getState();
    const expected = [rng.nextUint32(), rng.nextUint32(), rng.nextUint32()];

    const restored: SeededRng = createRngFromState(state);
    expect([restored.nextUint32(), restored.nextUint32(), restored.nextUint32()]).toEqual(expected);
  });

  it("setState() restores a state captured from a different instance", () => {
    const source = createRng(555);
    for (let i = 0; i < 7; i++) {
      source.nextUint32();
    }
    const state = source.getState();

    const target = createRng(1);
    target.setState(state);
    expect(target.nextUint32()).toBe(source.nextUint32());
  });
});
