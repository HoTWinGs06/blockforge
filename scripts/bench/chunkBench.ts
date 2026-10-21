/**
 * Gate G3 — chunk generation + meshing benchmark.
 *
 * Measures the cost of generating a chunk and meshing it, per chunk, and
 * reports the average and the p95.
 *
 * The gate: average < 16 ms per chunk.
 *
 * Build and run:
 *   npx tsc -p scripts/tsconfig.build.json
 *   node .build/scripts/bench/chunkBench.js
 *
 * The committed benchmark that the TEST AUTHOR owns lives under tests/; this
 * script is the engine-side number, and both must agree.
 */

import { performance } from "node:perf_hooks";
import { World } from "../../src/core/world.js";
import { generateChunk } from "../../src/core/world.js";
import { meshChunk } from "../../src/core/meshing.js";
import { CHUNK_SIZE_X, CHUNK_SIZE_Z } from "../../src/core/constants.js";

/** How many chunks to measure. Enough to smooth out a single slow chunk. */
const CHUNK_COUNT = 64;
/** How many warm-up chunks to discard, so JIT warm-up is not measured. */
const WARMUP = 8;
/** The seed to measure with. */
const SEED = 1234;
/** The gate budget: average milliseconds per chunk. */
const BUDGET_MS = 16;

/** A grid of chunk keys around the origin, deterministic and reproducible. */
function chunkKeys(count: number): Array<{ cx: number; cz: number }> {
  const keys: Array<{ cx: number; cz: number }> = [];
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    keys.push({
      cx: (i % side) - Math.floor(side / 2),
      cz: Math.floor(i / side) - Math.floor(side / 2),
    });
  }
  return keys;
}

interface Stats {
  average: number;
  p95: number;
  min: number;
  max: number;
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const at = (i: number): number => sorted[Math.min(sorted.length - 1, i)] ?? 0;
  return {
    average: sum / sorted.length,
    p95: at(Math.floor(sorted.length * 0.95)),
    min: at(0),
    max: at(sorted.length - 1),
  };
}

const keys = chunkKeys(CHUNK_COUNT + WARMUP);
const world = new World(SEED);

// Load every chunk and its neighbours first, so the mesher measures meshing
// rather than generation.
for (const key of keys) {
  world.getChunk(key);
  world.getChunk({ cx: key.cx - 1, cz: key.cz });
  world.getChunk({ cx: key.cx + 1, cz: key.cz });
  world.getChunk({ cx: key.cx, cz: key.cz - 1 });
  world.getChunk({ cx: key.cx, cz: key.cz + 1 });
}

const genTimes: number[] = [];
const meshTimes: number[] = [];
const totalTimes: number[] = [];

for (let i = 0; i < keys.length; i++) {
  const key = keys[i] as { cx: number; cz: number };

  // Generate a fresh chunk so the timing covers real generation, not a
  // cache lookup.
  const genStart = performance.now();
  const chunk = generateChunk(SEED, key);
  const genEnd = performance.now();

  const meshStart = performance.now();
  meshChunk(chunk, world.neighbours(key));
  const meshEnd = performance.now();

  if (i >= WARMUP) {
    genTimes.push(genEnd - genStart);
    meshTimes.push(meshEnd - meshStart);
    totalTimes.push(genEnd - genStart + (meshEnd - meshStart));
  }
}

const gen = stats(genTimes);
const mesh = stats(meshTimes);
const total = stats(totalTimes);

const fmt = (n: number): string => n.toFixed(3).padStart(9);
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

out(`chunks measured : ${totalTimes.length} (seed ${SEED})`);
out(`chunk size      : ${CHUNK_SIZE_X} x 256 x ${CHUNK_SIZE_Z}`);
out("");
out("                avg ms      p95 ms      min ms     max ms");
out(`generation  ${fmt(gen.average)}${fmt(gen.p95)}${fmt(gen.min)}${fmt(gen.max)}`);
out(`meshing     ${fmt(mesh.average)}${fmt(mesh.p95)}${fmt(mesh.min)}${fmt(mesh.max)}`);
out(`TOTAL       ${fmt(total.average)}${fmt(total.p95)}${fmt(total.min)}${fmt(total.max)}`);

if (total.average < BUDGET_MS) {
  out(
    `\nG3 PASS: average ${total.average.toFixed(3)} ms/chunk is under the ${BUDGET_MS} ms budget (p95 ${total.p95.toFixed(3)} ms)`,
  );
} else {
  process.stderr.write(
    `\nG3 FAIL: average ${total.average.toFixed(3)} ms/chunk exceeds the ${BUDGET_MS} ms budget\n`,
  );
  process.exitCode = 1;
}
