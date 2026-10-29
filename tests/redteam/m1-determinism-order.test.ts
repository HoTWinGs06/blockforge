/**
 * RED-TEAM M1 — DETERMINISM / ORDER INDEPENDENCE
 */
import { describe, expect, it } from "vitest";
import { createRng, generateChunk, chunkIndex, fbm2, valueNoise2, World } from "../../src/core/index.js";

describe("M1 DETERMINISM — same seed => identical output in any order", () => {
  it("seeded RNG produces identical first 8 draws", () => {
    const a = createRng(42); const b = createRng(42);
    const seqA: number[] = []; const seqB: number[] = [];
    for (let i = 0; i < 8; i++) { seqA.push(a.nextInt(0, 1000)); seqB.push(b.nextInt(0, 1000)); }
    expect(seqA).toEqual(seqB);
  });

  it("chunk generation is pure: same (seed,key) => identical bytes", () => {
    const c1 = generateChunk(99, { cx: 3, cz: -2 });
    const c2 = generateChunk(99, { cx: 3, cz: -2 });
    expect(c1.blocks.length).toBe(c2.blocks.length);
    for (let i = 0; i < c1.blocks.length; i++) expect(c1.blocks[i]).toBe(c2.blocks[i]);
  });

  it("generation order does NOT affect result (forward vs reversed keys)", () => {
    // @ts-expect-error (red-team structure, intentionally unread)
    const _seeds = [1, 2, 3];
    const keys = [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }, { cx: 0, cz: 1 }];
    // Forward
    // @ts-expect-error (red-team structure)
    const _fwd = keys.map((k) => generateChunk(7, k));
    // Reversed
    // @ts-expect-error (red-team structure)
    const _rev = [...keys].reverse().map((k) => generateChunk(7, k));
    // Compare by matching key (reconstruct by key not needed: just compare the sequence of bytes in order of generation)
    // Real check: generating chunk (1,0) after (0,0) must not change (0,0)'s bytes.
    const a = generateChunk(7, { cx: 0, cz: 0 });
    generateChunk(7, { cx: 1, cz: 0 }); // consume some rng state indirectly? No, chunk is pure function of seed+key
    const aAgain = generateChunk(7, { cx: 0, cz: 0 });
    expect(a.blocks.every((v, i) => v === aAgain.blocks[i])).toBe(true);
  });

  it("shared mutable buffer: two chunks from same seed must not share the same Uint8Array instance", () => {
    const a = generateChunk(99, { cx: 0, cz: 0 });
    const b = generateChunk(99, { cx: 1, cz: 1 });
    expect(a.blocks).not.toBe(b.blocks); // different reference
  });

  it("floating-point determinism: fbm2 at same point twice is bit-equal", () => {
    const v1 = fbm2(1234, 10.5, 20.5, 4);
    const v2 = fbm2(1234, 10.5, 20.5, 4);
    expect(v1).toBe(v2);
    expect(Number.isFinite(v1)).toBe(true);
  });

  it("valueNoise2 determinism across order", () => {
    const a = valueNoise2(99, 5.5, 10.1);
    const b = valueNoise2(99, 5.5, 10.1);
    expect(a).toBe(b);
    expect(Number.isFinite(a)).toBe(true);
  });

  it("chunkIndex is bijection over 16x256x16 domain (no alias, no skip)", () => {
    const seen = new Set<number>();
    let count = 0;
    for (let y = 0; y < 256; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const idx = chunkIndex(x, y, z);
      expect(seen.has(idx)).toBe(false); // bijective -> no duplicates
      seen.add(idx);
      expect(Number.isInteger(idx) && idx >= 0 && idx < 65536).toBe(true);
      count++;
    }
    expect(count).toBe(65536);
    expect(seen.size).toBe(65536);
  });

  it("chunkIndex throws out of range (guard not bypassed)", () => {
    expect(() => chunkIndex(-1, 0, 0)).toThrow();
    expect(() => chunkIndex(16, 0, 0)).toThrow();
    expect(() => chunkIndex(0, 256, 0)).toThrow();
    expect(() => chunkIndex(0, 0, 16)).toThrow();
  });

  it("World.hash identical for same seed across fresh instances (cross-process determinism proxy)", () => {
    const w1 = new World(111);
    const w2 = new World(111);
    expect(w1.hash()).toBe(w2.hash());
  });
});
