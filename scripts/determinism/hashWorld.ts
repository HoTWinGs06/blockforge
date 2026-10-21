/**
 * Gate G6 — world hash worker.
 *
 * Builds a world from a seed and prints its hash. Run as a separate process
 * by check.ts, so the two hashes come from two genuinely fresh runs.
 *
 * Usage: node hashWorld.js <seed>
 */

import { World } from "../../src/core/world.js";

const seed = Number.parseInt(process.argv[2] ?? "0", 10);

// A spread of chunks around the origin, including negative coordinates, so
// the hash covers chunk keys, terrain, ores, water and features.
const world = new World(seed);
for (let cx = -1; cx <= 1; cx++) {
  for (let cz = -1; cz <= 1; cz++) {
    world.getChunk({ cx, cz });
  }
}

process.stdout.write(`${world.hash()}\n`);
