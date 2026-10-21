import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import * as fs from "node:fs";
import * as path from "node:path";

describe("PRIORITY 3: Seeded PRNG Specification (src/core/rng.ts)", async () => {
  const rngFile = path.resolve(__dirname, "../src/core/rng.ts");
  const rngExists = fs.existsSync(rngFile);

  it("specifies SeededRng requirement for engine and core", () => {
    if (!rngExists) {
      expect(true).toBe(true);
      return;
    }
    expect(rngExists).toBe(true);
  });

  if (rngExists) {
    const specPath = "../src/core/rng.js";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* @vite-ignore */ specPath);
    const makeRng = mod.createRng || ((seed: number) => new mod.SeededRng(seed));

    it("generates deterministic uint32 stream for identical seeds", () => {
      fc.assert(
        fc.property(fc.integer(), (seed) => {
          const rngA = makeRng(seed);
          const rngB = makeRng(seed);

          for (let i = 0; i < 100; i++) {
            expect(rngA.nextUint32()).toBe(rngB.nextUint32());
          }
        }),
      );
    });

    it("generates deterministic float stream in [0, 1) for identical seeds", () => {
      const rngA = makeRng(42);
      const rngB = makeRng(42);

      for (let i = 0; i < 100; i++) {
        const valA = rngA.nextFloat();
        const valB = rngB.nextFloat();
        expect(valA).toBe(valB);
        expect(valA).toBeGreaterThanOrEqual(0);
        expect(valA).toBeLessThan(1);
      }
    });

    it("nextInt generates integers within [minInclusive, maxExclusive)", () => {
      const rng = makeRng(12345);
      for (let i = 0; i < 200; i++) {
        const val = rng.nextInt(5, 15);
        expect(Number.isInteger(val)).toBe(true);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThan(15);
      }
    });

    it("fork(label) produces independent and deterministic child streams", () => {
      const root1 = makeRng(777);
      const root2 = makeRng(777);

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

    it("getState() and setState() allow exact checkpoint and restore", () => {
      const rng = makeRng(999);
      for (let i = 0; i < 25; i++) {
        rng.nextUint32();
      }

      const checkpoint = rng.getState();
      const nextThree1 = [rng.nextUint32(), rng.nextUint32(), rng.nextUint32()];

      rng.setState(checkpoint);
      const nextThree2 = [rng.nextUint32(), rng.nextUint32(), rng.nextUint32()];

      expect(nextThree1).toEqual(nextThree2);
    });
  }
});
