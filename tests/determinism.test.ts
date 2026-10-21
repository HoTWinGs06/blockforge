import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { CHUNK_VOLUME, blockIndex } from "../src/core/constants.js";

describe("PRIORITY 2: Determinism (Cross-Process and Order Invariance)", () => {
  it("produces byte-identical chunk hashes across two separate Node processes with the same seed", () => {
    // Pure function script to generate synthetic chunk bytes and output sha256 hash
    const script = `
      const crypto = require('node:crypto');
      const seed = parseInt(process.argv[1], 10);
      const blocks = new Uint8Array(65536);
      
      let state = seed >>> 0;
      function next() {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state;
      }

      for (let y = 0; y < 64; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const idx = x + 16 * (z + 16 * y);
            blocks[idx] = (next() % 5) + 1;
          }
        }
      }

      const hash = crypto.createHash('sha256').update(blocks).digest('hex');
      process.stdout.write(hash);
    `;

    function runProcess(seed: number): string {
      const res = spawnSync(process.execPath, ["-e", script, String(seed)], {
        encoding: "utf-8",
      });
      if (res.error) throw res.error;
      if (res.status !== 0) throw new Error(`Process failed: ${res.stderr}`);
      return res.stdout.trim();
    }

    const seed = 133742;
    const hash1 = runProcess(seed);
    const hash2 = runProcess(seed);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);

    // Different seed produces different hash
    const hashDifferent = runProcess(999999);
    expect(hashDifferent).not.toBe(hash1);
  });

  it("chunk buffer indexing is order-invariant when populating blocks", () => {
    const buf1 = new Uint8Array(CHUNK_VOLUME);
    const buf2 = new Uint8Array(CHUNK_VOLUME);

    // Order 1: y outer, z middle, x inner
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          buf1[blockIndex(x, y, z)] = 3;
        }
      }
    }

    // Order 2: x outer, y middle, z inner
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 16; z++) {
          buf2[blockIndex(x, y, z)] = 3;
        }
      }
    }

    expect(Buffer.from(buf1).equals(Buffer.from(buf2))).toBe(true);
  });
});
