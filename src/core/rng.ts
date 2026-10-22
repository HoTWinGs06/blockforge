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
 * Odd multiplier for the seed's HIGH half. Odd, so it is a bijection on
 * 32-bit words: two different high halves can never fold to the same word.
 */
const HIGH_WORD_MULT = 0x27d4eb2d;

/**
 * The high 32 bits of a seed, as a signed int32.
 *
 * The seed is a plain `number` in the frozen contract, so it is not bounded
 * to 32 bits. Splitting it into a low word (`seed >>> 0`) and this high
 * word is the same decomposition the noise layer and the world layer use.
 */
function high32(seed: number): number {
  return Math.floor(seed / TWO_POW_32) | 0;
}

/**
 * Fold a seed's HIGH half into one 32-bit word.
 *
 * The old code coerced the seed with `>>> 0`, which threw away everything
 * above bit 31: a seed of 0 and a seed of 2^32 produced the SAME stream, so
 * two different world seeds shared every RNG-driven subsystem.
 *
 * The multiplier is odd, so it is a bijection on 32-bit words, and the
 * finalizer is a bijection too, so two DIFFERENT high halves always fold to
 * different words. A high half of zero folds to zero, so every seed in
 * [0, 2^32) produces EXACTLY the stream it always did - this fix only
 * gives the high half a say, and changes no existing world's content.
 */
function highWord(seed: number): number {
  return mix32(Math.imul(high32(seed), HIGH_WORD_MULT));
}

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
 *
 * THE SEED IS NOT TRUNCATED. A seed is a plain `number` in the frozen
 * contract, so it carries up to 53 bits. It is split into a low 32-bit word
 * and a high 32-bit word; the low word drives the counter exactly as before
 * (so every seed in [0, 2^32) produces the stream it always did) and the
 * high word is XORed into every draw. Two seeds 2^32 apart therefore have
 * DIFFERENT streams, instead of sharing one.
 */
export class SeededRngImpl implements SeededRng {
  /** The seed exactly as it was given, for `getState`. */
  private seed: number;
  /** The low 32 bits of the seed: the counter's starting value. */
  private low: number;
  /** The high half folded into one 32-bit word, mixed into every draw. */
  private highWord: number;
  /** The running 32-bit generator state. */
  private state: number;

  constructor(seed: number) {
    this.seed = seed;
    this.low = seed >>> 0;
    this.highWord = highWord(seed);
    this.state = this.low;
  }

  nextUint32(): number {
    this.state = (this.state + GAMMA) >>> 0;
    return mix32((this.state ^ this.highWord) >>> 0);
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
    // Derived from the parent's SEED, not its live state: a child stream must
    // depend only on (seed, label), so two subsystems forked from the same
    // parent produce identical worlds regardless of what else consumed the
    // parent in between.
    //
    // The parent's HIGH half reaches the child through `highWord`, so two
    // parents 2^32 apart do not hand their subsystems the same child stream.
    // The child seed stays a single 32-bit word: `mix32` is a bijection, so
    // two different parents collide only at the birthday rate, never
    // systematically.
    //
    // For a seed in [0, 2^32) the high half is zero, so the child seed is
    // EXACTLY the one this method always produced.
    const labelHash = hashLabel(label);
    const childSeed = mix32((this.low ^ labelHash ^ this.highWord) >>> 0);
    return new SeededRngImpl(childSeed);
  }

  getState(): RngState {
    return { seed: this.seed, state: this.state };
  }

  setState(state: RngState): void {
    this.seed = state.seed;
    this.low = state.seed >>> 0;
    this.highWord = highWord(state.seed);
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
