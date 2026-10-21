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
 * Hash a 2D lattice point to a uint32. Strong avalanche from a multiply-xor
 * chain; identical in every JS engine because it is pure 32-bit integer math.
 */
function hash2(seed: number, x: number, z: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d)) | 0;
  h = Math.imul(h ^ (z | 0), 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Hash a 3D lattice point to a uint32. */
function hash3(seed: number, x: number, y: number, z: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d)) | 0;
  h = Math.imul(h ^ (y | 0), 0x85ebca6b);
  h = Math.imul(h ^ (z | 0), 0x165667b1);
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
 * each lattice point is a hash of (seed, x, z).
 */
export function valueNoise2(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fz = fade(z - z0);

  const n00 = hash2(seed, x0, z0) / TWO_POW_32;
  const n10 = hash2(seed, x0 + 1, z0) / TWO_POW_32;
  const n01 = hash2(seed, x0, z0 + 1) / TWO_POW_32;
  const n11 = hash2(seed, x0 + 1, z0 + 1) / TWO_POW_32;

  return lerp(lerp(n00, n10, fx), lerp(n01, n11, fx), fz);
}

/**
 * 3D value noise in [0, 1). Used for ore veins, which must be volumetric to
 * look like veins rather than blobs pasted on a surface.
 */
export function valueNoise3(
  seed: number,
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

  const c000 = hash3(seed, x0, y0, z0) / TWO_POW_32;
  const c100 = hash3(seed, x0 + 1, y0, z0) / TWO_POW_32;
  const c010 = hash3(seed, x0, y0 + 1, z0) / TWO_POW_32;
  const c110 = hash3(seed, x0 + 1, y0 + 1, z0) / TWO_POW_32;
  const c001 = hash3(seed, x0, y0, z0 + 1) / TWO_POW_32;
  const c101 = hash3(seed, x0 + 1, y0, z0 + 1) / TWO_POW_32;
  const c011 = hash3(seed, x0, y0 + 1, z0 + 1) / TWO_POW_32;
  const c111 = hash3(seed, x0 + 1, y0 + 1, z0 + 1) / TWO_POW_32;

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
    sum +=
      valueNoise2(seed + octave * 0x9e3779b9, x * frequency, z * frequency) *
      amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}