/**
 * Gate G6 — determinism proof.
 *
 * Two FRESH processes, the same seed, must produce identical world hashes.
 *
 * This script is the proof: it spawns two separate Node processes, each of
 * which builds a world from the same seed and prints its hash, then compares
 * the two. Fresh processes, not fresh calls in one process — the whole point
 * of the gate is that nothing survives between runs (no shared module state,
 * no cached value, no ambient clock).
 *
 * Build and run:
 *   npx tsc -p scripts/tsconfig.build.json
 *   node .build/scripts/determinism/check.js
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** The seeds to prove. 0 is the default; the others catch seed-specific bugs. */
const SEEDS = [0, 1, 12345, 0x7fffffff, -1];

function hashInFreshProcess(seed: number): string {
  const result = spawnSync(
    process.execPath,
    [join(here, "hashWorld.js"), String(seed)],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `hash process for seed ${seed} failed (${result.status}): ${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

let failed = 0;
for (const seed of SEEDS) {
  const first = hashInFreshProcess(seed);
  const second = hashInFreshProcess(seed);
  const match = first === second && first.length > 0;
  if (!match) {
    failed++;
  }
  process.stdout.write(
    `seed ${seed}: ${first} ${match ? "==" : "!="} ${second} ${match ? "MATCH" : "MISMATCH"}\n`,
  );
}

if (failed > 0) {
  process.stderr.write(`G6 FAILED: ${failed} seed(s) produced different hashes\n`);
  process.exit(1);
}
process.stdout.write(
  `G6 PASS: ${SEEDS.length} seeds, identical hashes across fresh processes\n`,
);
