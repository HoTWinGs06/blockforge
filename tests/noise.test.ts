/**
 * BlockForge — PRIORITY 3: value noise specification (src/core/noise.ts).
 *
 * OWNERSHIP: TEST AUTHOR (tests/).
 *
 * The noise layer is the heart of the determinism invariant: terrain, ore
 * veins and tree placement are all functions of `(seed, x, y, z)`. A noise
 * function that is not a pure function of its inputs silently destroys
 * every downstream guarantee, so these tests pin the properties the rest of
 * the project depends on.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { fbm2, valueNoise2, valueNoise3 } from "../src/core/noise.js";

/** A spread of seeds that exercises different terrain. */
const SEEDS = [0, 1, 42, 1234, 9999, 0xffffffff] as const;

describe("PRIORITY 3: value noise (src/core/noise.ts)", () => {
  it("valueNoise2 returns the same value for the same seed and coordinates", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.integer(), fc.integer(), (seed, x, z) => {
        const a = valueNoise2(seed, x, z);
        const b = valueNoise2(seed, x, z);
        expect(a).toBe(b);
      }),
    );
  });

  it("valueNoise2 returns a different value for a different seed", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xfffffffe }),
        fc.integer(),
        fc.integer(),
        (seed, x, z) => {
          expect(valueNoise2(seed, x, z)).not.toBe(valueNoise2(seed + 1, x, z));
        },
      ),
    );
  });

  it("valueNoise2 stays in [0, 1) everywhere", () => {
    for (const seed of SEEDS) {
      for (let i = 0; i < 2000; i++) {
        const v = valueNoise2(seed, i * 0.37, i * 0.71);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it("valueNoise2 is continuous across a lattice boundary", () => {
    // A lattice point is where the interpolant's second derivative could
    // jump. The quintic fade makes it C2 continuous, so the value just
    // below a lattice point and the value AT it must agree to within
    // floating-point noise.
    for (const seed of SEEDS) {
      for (const boundary of [0, 1, 2, 8, 37]) {
        const below = valueNoise2(seed, boundary - 1e-6, 0.5);
        const at = valueNoise2(seed, boundary, 0.5);
        const above = valueNoise2(seed, boundary + 1e-6, 0.5);
        expect(Math.abs(below - at)).toBeLessThan(1e-6);
        expect(Math.abs(above - at)).toBeLessThan(1e-6);
      }
    }
  });

  it("valueNoise3 returns the same value for the same seed and coordinates", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer(),
        fc.integer(),
        fc.integer(),
        (seed, x, y, z) => {
          expect(valueNoise3(seed, x, y, z)).toBe(valueNoise3(seed, x, y, z));
        },
      ),
    );
  });

  it("valueNoise3 returns a different value for a different seed", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xfffffffe }),
        fc.integer(),
        fc.integer(),
        fc.integer(),
        (seed, x, y, z) => {
          expect(valueNoise3(seed, x, y, z)).not.toBe(valueNoise3(seed + 1, x, y, z));
        },
      ),
    );
  });

  it("valueNoise3 stays in [0, 1) everywhere", () => {
    for (const seed of SEEDS) {
      for (let i = 0; i < 1000; i++) {
        const v = valueNoise3(seed, i * 0.37, i * 0.71, i * 0.13);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it("valueNoise3 is continuous across a lattice boundary", () => {
    for (const seed of SEEDS) {
      for (const boundary of [0, 1, 5, 23]) {
        const below = valueNoise3(seed, 0.5, boundary - 1e-6, 0.5);
        const at = valueNoise3(seed, 0.5, boundary, 0.5);
        const above = valueNoise3(seed, 0.5, boundary + 1e-6, 0.5);
        expect(Math.abs(below - at)).toBeLessThan(1e-6);
        expect(Math.abs(above - at)).toBeLessThan(1e-6);
      }
    }
  });

  it("fbm2 is deterministic for the same seed, coordinates and octave count", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer(),
        fc.integer(),
        fc.integer({ min: 1, max: 8 }),
        (seed, x, z, octaves) => {
          expect(fbm2(seed, x, z, octaves)).toBe(fbm2(seed, x, z, octaves));
        },
      ),
    );
  });

  it("fbm2 stays in [0, 1] for every positive octave count", () => {
    for (const seed of SEEDS) {
      for (let octaves = 1; octaves <= 8; octaves++) {
        for (let i = 0; i < 200; i++) {
          const v = fbm2(seed, i * 0.37, i * 0.71, octaves);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("fbm2 differs between different octave counts", () => {
    // More octaves means more detail, so the result must actually change.
    let differed = false;
    for (let i = 0; i < 500 && !differed; i++) {
      if (fbm2(1234, i * 0.37, i * 0.71, 1) !== fbm2(1234, i * 0.37, i * 0.71, 4)) {
        differed = true;
      }
    }
    expect(differed).toBe(true);
  });

  it("fbm2 differs between different seeds", () => {
    let differed = false;
    for (let i = 0; i < 500 && !differed; i++) {
      if (fbm2(1234, i * 0.37, i * 0.71, 4) !== fbm2(9999, i * 0.37, i * 0.71, 4)) {
        differed = true;
      }
    }
    expect(differed).toBe(true);
  });

  // RED-TEAM finding E1 (board T44). The engine's first handoff claimed
  // this was fixed and it was not: fbm2 computed `sum / norm`, and with no
  // octaves both are 0, so the result was 0/0 = NaN. A NaN height
  // propagates into every block placement that consumes it, and a NaN
  // block coordinate either indexes out of bounds or silently writes
  // nothing — a wrong-looking but plausible world, which is the worst
  // kind of bug to notice.
  //
  // FIXED by the engine on feature/engine/fix-e1-e2-tunnel: fbm2 now
  // clamps the octave count to at least one, so it is total over its whole
  // input domain. This test was an `it.fails` until that fix landed; it
  // flipped RED to announce the closure, and is now a plain `it` that
  // asserts the FIXED behaviour and must stay passing.
  it("E1: fbm2 must not return NaN for a zero octave count", () => {
    expect(Number.isFinite(fbm2(1234, 10.5, 20.5, 0))).toBe(true);
  });

  it("E1: fbm2 must not return NaN for a negative octave count", () => {
    expect(Number.isFinite(fbm2(1234, 10.5, 20.5, -3))).toBe(true);
  });

  it("E1: fbm2 returns a finite value for every octave count", () => {
    for (const octaves of [-100, -3, -1, 0, 1, 2, 8, 100]) {
      expect(Number.isFinite(fbm2(1234, 10.5, 20.5, octaves))).toBe(true);
    }
  });

  it("control: fbm2 with one or more octaves is finite", () => {
    // True before and after the E1 fix, so this control never needed
    // converting: it proves the probe is live without pinning the bug.
    expect(Number.isFinite(fbm2(1234, 10.5, 20.5, 1))).toBe(true);
    expect(Number.isFinite(fbm2(1234, 10.5, 20.5, 4))).toBe(true);
  });
});
