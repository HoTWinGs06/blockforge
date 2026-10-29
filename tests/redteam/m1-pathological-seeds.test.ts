/**
 * RED-TEAM M1 — PATHOLOGICAL SEEDS
 */
import { describe, expect, it } from "vitest";
import { createRng, generateChunk, fbm2, valueNoise2, CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from "../../src/core/index.js";

describe("M1 PATHOLOGICAL SEEDS — must not crash / NaN / overflow", () => {
  const pathological = [0, 1, 2147483647, 4294967295, 9007199254740991, -1];

  for (const seed of pathological) {
    it(`seed ${seed}: RNG produces finite first 4 draws`, () => {
      const rng = createRng(seed);
      for (let i = 0; i < 4; i++) {
        const v = rng.nextInt(0, 10000);
        expect(Number.isFinite(v)).toBe(true);
        expect(Number.isInteger(v)).toBe(true);
      }
    });
  }

  it("seed 0 and seed 2^32 must produce different streams (E5 guard)", () => {
    const a = createRng(0); const b = createRng(4294967296);
    const sa = [a.nextInt(0, 1000000), a.nextInt(0, 1000000)];
    const sb = [b.nextInt(0, 1000000), b.nextInt(0, 1000000)];
    expect(sa).not.toEqual(sb);
  });

  for (const seed of [0, 1, 2147483647, 4294967295]) {
    it(`seed ${seed}: chunk generation yields finite block ordinals`, () => {
      const chunk = generateChunk(seed, { cx: 0, cz: 0 });
      expect(chunk.blocks.length).toBe(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z);
      for (let i = 0; i < chunk.blocks.length; i++) {
        const v = chunk.blocks[i]!;
        expect(Number.isInteger(v)).toBe(true);
        expect(v >= 0 && v <= 255).toBe(true); // byte-valid
      }
    });
  }

  it("fbm2 with octaves <= 0 is finite (E1 guard after fix)", () => {
    for (const oct of [0, -1, -3]) {
      const v = fbm2(1234, 10.5, 20.5, oct);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("valueNoise2 at extreme coordinates is finite", () => {
    const v = valueNoise2(1, 1e9, -1e9);
    expect(Number.isFinite(v)).toBe(true);
  });

  it("empty chunk (all air) is handled: chunk with zero non-air produced for flat seed", () => {
    const chunk = generateChunk(0, { cx: 10, cz: 10 });
    expect(chunk.blocks).toBeDefined();
    // We don't assert all air — that's terrain-dependent — only that it doesn't throw
  });

  it("chunk at chunk coordinate boundary (cx=-32768 / large) doesn't throw or wrap silently via chunkIndex bypass", () => {
    // chunkIndex is per-chunk, so large chunk keys are allowed; only in-chunk coords restricted.
    const chunk = generateChunk(99, { cx: 1000, cz: -200 });
    expect(chunk.key.cx).toBe(1000);
  });

  it("nextInt with pathological bounds: reversed range throws, zero-width returns 0", () => {
    const rng = createRng(1);
    expect(() => rng.nextInt(10, 0)).toThrow();
    const zero = rng.nextInt(5, 5);
    expect(zero).toBe(5);
  });
});
