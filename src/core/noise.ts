/**
 * BlockForge — deterministic value noise.
 *
 * OWNERSHIP: ENGINE.
 *
 * Pure integer hashing plus smooth interpolation. No tables to seed, no
 * floating point accumulation across calls, no state: a sample is a function
 * of (seed, x, y, z) alone, so terrain is continuous across chunk borders and
 * identical in any process.
 */

/** 2^32 — maps a uint32 into [0, 1). */
const TWO_POW_32 = 4294967296;

/**
 * The high 32 bits of an integer, as a signed int32.
 *
 * The hash below mixes an input in as TWO 32-bit halves — the low half and
 * this high half — instead of truncating it with `| 0`. Truncating made the
 * lattice repeat with a period of 2^32: `x` and `x + 2^32` hashed the same,
 * so distant chunks shared terrain.
 *
 * The pair (low, high) is an exact decomposition of the integer: `low` is
 * the coordinate mod 2^32 and `high` is its floor quotient, so negative
 * coordinates decompose the same way positive ones do.
 */
function high32(value: number): number {
  // Multiply by 2^-32 rather than divide by 2^32: scaling by a power of two
  // is exact, and it is on the hot path.
  return Math.floor(value * 2.3283064365386963e-10) | 0;
}

/**
 * Fold a seed into one 32-bit word, using BOTH of its 32-bit halves.
 *
 * The old code coerced the seed with `^`, which does ToInt32 and so threw
 * away everything above bit 31: a seed of 0 and a seed of 2^32 hashed the
 * same, and two such worlds produced byte-identical terrain. Folding the
 * high half in with a multiply keeps the whole seed in play.
 *
 * The result is one word, so two seeds can still collide — but only at the
 * usual birthday rate, never systematically, and never for a seed and the
 * same seed 2^32 apart.
 */
function seedWord(seed: number): number {
  return (seed >>> 0) ^ Math.imul(high32(seed), 0x27d4eb2d);
}

/**
 * The low 32 bits of a lattice coordinate, as a uint32.
 */
function low32(value: number): number {
  return value >>> 0;
}

/**
 * The high 32 bits of the lattice coordinate `low + 1`, given the low and
 * high words of `low`.
 *
 * Adding one to the coordinate carries into the high word exactly when the
 * low word is all ones, so the second corner of a cell needs no second
 * division.
 */
function high32PlusOne(low: number, high: number): number {
  return high + (low === 0xffffffff ? 1 : 0);
}

/**
 * Hash a 2D lattice point to a uint32. Strong avalanche from a multiply-xor
 * chain; identical in every JS engine because it is pure 32-bit integer math.
 *
 * The seed and both coordinates are each mixed in as a pair of 32-bit halves
 * (low + high), so no part of an input is silently discarded: two seeds or
 * two coordinates that differ by 2^32 hash differently instead of
 * colliding.
 *
 * `stream` separates the octaves of an fBm sum. It is a hashed input in its
 * own right rather than a constant folded into the seed, because a seed plus
 * a constant overflows 32 bits and makes two different (seed, octave) pairs
 * collide.
 *
 * The seed and the coordinate halves arrive pre-split: they are the same for
 * every lattice point of a sample, so splitting them per point was pure
 * repeated work on the hot path.
 */
function hash2(
  seed: number,
  xLo: number,
  xHi: number,
  zLo: number,
  zHi: number,
  stream: number,
): number {
  let h = seed | 0;
  h = Math.imul(h ^ xLo, 0x165667b1);
  h = Math.imul(h ^ xHi, 0x2545f491);
  h = Math.imul(h ^ zLo, 0x9e3779b1);
  h = Math.imul(h ^ zHi, 0x85ebca6b);
  h = Math.imul(h ^ stream, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x1b873593);
  h ^= h >>> 13;
  return h >>> 0;
}

/**
 * Hash a 3D lattice point to a uint32.
 *
 * Same rule as {@link hash2}: every input is mixed in as a low/high pair of
 * 32-bit halves, so nothing is truncated away.
 */
function hash3(
  seed: number,
  xLo: number,
  xHi: number,
  yLo: number,
  yHi: number,
  zLo: number,
  zHi: number,
): number {
  let h = seed | 0;
  h = Math.imul(h ^ xLo, 0x165667b1);
  h = Math.imul(h ^ xHi, 0x2545f491);
  h = Math.imul(h ^ yLo, 0x9e3779b1);
  h = Math.imul(h ^ yHi, 0x85ebca6b);
  h = Math.imul(h ^ zLo, 0xc2b2ae35);
  h = Math.imul(h ^ zHi, 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Quintic fade — C2 continuous, so noise has no visible lattice creases. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Smoothstep in [0, 1]. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 2D value noise in [0, 1). The lattice is the integer grid; the value at
 * each lattice point is a hash of (seed, x, z) and the stream word.
 */
function valueNoise2Stream(
  seedIn: number,
  x: number,
  z: number,
  stream: number,
): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fz = fade(z - z0);

  // The seed and the coordinate halves are computed once per sample, not
  // once per lattice point: they are the same for every corner of the cell.
  const seed = seedWord(seedIn);
  const xLo = low32(x0);
  const xHi = high32(x0);
  const zLo = low32(z0);
  const zHi = high32(z0);
  const xLo1 = low32(x0 + 1);
  const xHi1 = high32PlusOne(xLo, xHi);
  const zLo1 = low32(z0 + 1);
  const zHi1 = high32PlusOne(zLo, zHi);

  const n00 = hash2(seed, xLo, xHi, zLo, zHi, stream) / TWO_POW_32;
  const n10 = hash2(seed, xLo1, xHi1, zLo, zHi, stream) / TWO_POW_32;
  const n01 = hash2(seed, xLo, xHi, zLo1, zHi1, stream) / TWO_POW_32;
  const n11 = hash2(seed, xLo1, xHi1, zLo1, zHi1, stream) / TWO_POW_32;

  return lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fz);
}

/**
 * 2D value noise in [0, 1). The lattice is the integer grid; the value at
 * each lattice point is a hash of (seed, x, z).
 */
export function valueNoise2(seed: number, x: number, z: number): number {
  return valueNoise2Stream(seed, x, z, 0);
}

/**
 * 3D value noise in [0, 1). Used for ore veins, which must be volumetric to
 * look like veins rather than blobs pasted on a surface.
 */
export function valueNoise3(
  seedIn: number,
  x: number,
  y: number,
  z: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const fz = fade(z - z0);

  // The seed and the coordinate halves are computed once per sample, not
  // once per lattice point: they are the same for every corner of the cell.
  const seed = seedWord(seedIn);
  const xLo = low32(x0);
  const xHi = high32(x0);
  const yLo = low32(y0);
  const yHi = high32(y0);
  const zLo = low32(z0);
  const zHi = high32(z0);
  const xLo1 = low32(x0 + 1);
  const xHi1 = high32PlusOne(xLo, xHi);
  const yLo1 = low32(y0 + 1);
  const yHi1 = high32PlusOne(yLo, yHi);
  const zLo1 = low32(z0 + 1);
  const zHi1 = high32PlusOne(zLo, zHi);

  const c000 = hash3(seed, xLo, xHi, yLo, yHi, zLo, zHi) / TWO_POW_32;
  const c100 = hash3(seed, xLo1, xHi1, yLo, yHi, zLo, zHi) / TWO_POW_32;
  const c010 = hash3(seed, xLo, xHi, yLo1, yHi1, zLo, zHi) / TWO_POW_32;
  const c110 = hash3(seed, xLo1, xHi1, yLo1, yHi1, zLo, zHi) / TWO_POW_32;
  const c001 = hash3(seed, xLo, xHi, yLo, yHi, zLo1, zHi1) / TWO_POW_32;
  const c101 = hash3(seed, xLo1, xHi1, yLo, yHi, zLo1, zHi1) / TWO_POW_32;
  const c011 = hash3(seed, xLo, xHi, yLo1, yHi1, zLo1, zHi1) / TWO_POW_32;
  const c111 = hash3(seed, xLo1, xHi1, yLo1, yHi1, zLo1, zHi1) / TWO_POW_32;

  const x00 = lerp(c000, c100, fx);
  const x10 = lerp(c010, c110, fx);
  const x01 = lerp(c001, c101, fx);
  const x11 = lerp(c011, c111, fx);
  const yA = lerp(x00, x10, fy);
  const yB = lerp(x01, x11, fy);
  return lerp(yA, yB, fz);
}

/**
 * Fractal Brownian motion over {@link valueNoise2}: `octaves` layers of noise
 * at doubling frequency and halving amplitude. Result is normalised to
 * roughly [0, 1].
 */
export function fbm2(
  seed: number,
  x: number,
  z: number,
  octaves: number,
): number {
  // At least one octave, or the normalisation below is 0/0 = NaN and the NaN
  // propagates into every block placement.
  const layers = Math.max(1, Math.floor(octaves));
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < layers; octave++) {
    // The octave index is a SEPARATE hashed input, not a constant added to
    // the seed. `seed + octave * 0x9e3779b9` leaves the 32-bit hash domain,
    // so two different (seed, octave) pairs landed on the same noise, and a
    // seed of 0 and a seed of 2^32 produced byte-identical terrain.
    sum +=
      valueNoise2Stream(
        seed,
        x * frequency,
        z * frequency,
        octave * 0x9e3779b9,
      ) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}