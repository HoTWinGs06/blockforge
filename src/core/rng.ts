/**
 * BlockForge — the project's only source of randomness.
 *
 * OWNERSHIP: ENGINE.
 *
 * Own implementation, no library. Deterministic and portable: the same seed
 * produces the same stream in any process, on any platform, forever. There is
 * no Math.random, no Date.now, no performance.now anywhere in this file.
 *
 * Algorithm: splitmix32. The classic splitmix64 keeps a 64-bit state, which
 * JavaScript numbers cannot hold exactly (a double has 53 bits of mantissa),
 * so a 64-bit state would have to be split across two fields and would not
 * round-trip through `RngState` losslessly. splitmix32 keeps the same
 * well-known mixing constants in 32 bits: the state fits a `number` exactly,
 * the stream is statistically sound for terrain, and `getState`/`setState`
 * round-trip byte-identically.
 *
 * Portability: all arithmetic is 32-bit via `Math.imul` and `>>>`, so the
 * result does not depend on the host's floating point behaviour.
 */

import type { RngState, SeededRng } from "./types.js";

/** splitmix32 increment (the 32-bit sibling of the golden-ratio constant). */
const GAMMA = 0x9e3779b9;
/** 2^32 — used to map uint32 into [0, 1). */
const TWO_POW_32 = 4294967296;

/**
 * The splitmix32 finalizer. Pure 32-bit integer mixing.
 */
function mix32(value: number): number {
  let z = value | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return z >>> 0;
}

/**
 * FNV-1a over the UTF-16 code units of a label. Used to turn a stream label
 * into a 32-bit number so that `fork` can derive an independent child stream.
 */
function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Concrete {@link SeededRng}.
 *
 * `fork` is PURE: it does not advance the parent. That is what makes
 * subsystems independent of each other and of generation order — the terrain
 * stream, the decoration stream and the spawn stream can be forked in any
 * order from the same parent and still produce identical worlds.
 */
export class SeededRngImpl implements SeededRng {
  private seed: number;
  private state: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  nextUint32(): number {
    this.state = (this.state + GAMMA) >>> 0;
    return mix32(this.state);
  }

  nextFloat(): number {
    // Exact in binary64: dividing by a power of two cannot round.
    return this.nextUint32() / TWO_POW_32;
  }

  nextInt(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
      throw new RangeError(
        `nextInt bounds must be integers: [${minInclusive}, ${maxExclusive})`,
      );
    }
    if (maxExclusive < minInclusive) {
      throw new RangeError(
        `nextInt maxExclusive ${maxExclusive} < minInclusive ${minInclusive}`,
      );
    }
    if (maxExclusive === minInclusive) {
      return minInclusive;
    }
    const span = maxExclusive - minInclusive;
    return minInclusive + Math.floor(this.nextFloat() * span);
  }

  fork(label: string): SeededRng {
    const childSeed = mix32((this.state ^ hashLabel(label)) >>> 0);
    return new SeededRngImpl(childSeed);
  }

  getState(): RngState {
    return { seed: this.seed, state: this.state };
  }

  setState(state: RngState): void {
    this.seed = state.seed >>> 0;
    this.state = state.state >>> 0;
  }
}

/** Create the project's only source of randomness. */
export function createRng(seed: number): SeededRng {
  return new SeededRngImpl(seed);
}

/** Restore an rng from a previously captured state. */
export function createRngFromState(state: RngState): SeededRng {
  const rng = new SeededRngImpl(state.seed);
  rng.setState(state);
  return rng;
}
