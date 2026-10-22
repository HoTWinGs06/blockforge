/**
 * Engine self-check: the seed fix must NOT change existing worlds.
 *
 * The seed fix (RED-TEAM E5, board T98) splits a seed into its low and high
 * 32-bit halves. For every seed in [0, 2^32) the high half is zero, so the
 * RNG must produce the EXACT stream it produced before the fix - otherwise
 * every existing world's content and every recorded world hash would move.
 *
 * This script re-implements the OLD (buggy) algorithm verbatim and compares
 * it against the real `createRng`, draw for draw, for the parent stream and
 * for a forked child stream.
 *
 * Build and run:
 *   npx tsc -p scripts/tsconfig.build.json
 *   node .build/scripts/selfcheck/rngCompatCheck.js
 */

import { createRng } from "../../src/core/rng.js";

/** The splitmix32 increment, as the old implementation had it. */
const GAMMA = 0x9e3779b9;

/** The old finalizer, verbatim. */
function oldMix32(value: number): number {
  let z = value | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return z >>> 0;
}

/** The old FNV-1a label hash, verbatim. */
function oldHashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The old generator: the seed truncated to 32 bits, and nothing else. */
class OldRng {
  private seed: number;
  private state: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  nextUint32(): number {
    this.state = (this.state + GAMMA) >>> 0;
    return oldMix32(this.state);
  }

  fork(label: string): OldRng {
    return new OldRng(oldMix32((this.seed ^ oldHashLabel(label)) >>> 0));
  }
}

let failures = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    process.stdout.write(`  ok   ${name}\n`);
  } else {
    failures++;
    process.stdout.write(`  FAIL ${name}${detail ? `: ${detail}` : ""}\n`);
  }
}

/** The seeds a world can realistically be created with. */
const SEEDS = [
  0, 1, 2, 42, 1234, 12345, 65535, 65536, 1337, 2147483647, 4294967295,
  0xabcdef, 987654321, 2000000000, 4294967294,
];

const LABELS = ["terrain", "decorations", "spawns", "clouds", "music"];

let parentMismatch = 0;
let childMismatch = 0;
for (const seed of SEEDS) {
  const oldRng = new OldRng(seed);
  const newRng = createRng(seed);
  for (let i = 0; i < 64; i++) {
    if (oldRng.nextUint32() !== newRng.nextUint32()) parentMismatch++;
  }
  for (const label of LABELS) {
    const oldChild = oldRng.fork(label);
    const newChild = newRng.fork(label);
    for (let i = 0; i < 32; i++) {
      if (oldChild.nextUint32() !== newChild.nextUint32()) childMismatch++;
    }
  }
}

check(
  "the parent stream is unchanged for every seed in [0, 2^32)",
  parentMismatch === 0,
  `${parentMismatch} draws differ`,
);
check(
  "the forked child stream is unchanged for every seed in [0, 2^32)",
  childMismatch === 0,
  `${childMismatch} draws differ`,
);

// And the new behaviour: seeds 2^32 apart MUST differ.
const a = createRng(0);
const b = createRng(4294967296);
let differ = false;
for (let i = 0; i < 16 && !differ; i++) {
  if (a.nextUint32() !== b.nextUint32()) differ = true;
}
check("seeds 2^32 apart now differ", differ);

if (failures > 0) {
  process.stderr.write(`\nrng compat self-check FAILED: ${failures} check(s)\n`);
  process.exit(1);
}
process.stdout.write("\nrng compat self-check PASSED\n");
