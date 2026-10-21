/**
 * BlockForge — frozen world geometry constants.
 *
 * OWNERSHIP: ARCHITECT. Part of the M1 contract. These values are FROZEN.
 *
 * CHUNK LAYOUT
 * ────────────
 * A chunk is 16 x 256 x 16, split vertically into 16 sections of 16 blocks.
 * Meshing operates per section so a mesh build never has to touch more than
 * 16 y-layers at a time.
 *
 * STORAGE ORDER (frozen)
 * ──────────────────────
 * Blocks are stored y-major: for a given y, all (x, z) pairs are contiguous.
 *
 *     index = x + CHUNK_SIZE_X * (z + CHUNK_SIZE_Z * y)
 *
 * This ordering is part of the serialisation format and of the
 * byte-identical determinism guarantee. Changing it invalidates saved worlds
 * and every recorded world hash.
 */

/** Blocks along X in a chunk. */
export const CHUNK_SIZE_X = 16;
/** Blocks along Y in a chunk (full world height). */
export const CHUNK_SIZE_Y = 256;
/** Blocks along Z in a chunk. */
export const CHUNK_SIZE_Z = 16;

/** Height of one meshing section. */
export const SECTION_HEIGHT = 16;
/** Number of sections in a chunk. */
export const SECTIONS_PER_CHUNK = CHUNK_SIZE_Y / SECTION_HEIGHT;

/** Total blocks in a chunk: 16 * 256 * 16 = 65536. */
export const CHUNK_VOLUME = CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z;

/** Lowest world Y (inclusive). */
export const WORLD_MIN_Y = 0;
/** Highest world Y (exclusive). */
export const WORLD_MAX_Y = CHUNK_SIZE_Y;

/**
 * Index of a block inside a chunk's block array.
 *
 * FROZEN storage order, y-major. Throws on out-of-range coordinates so that
 * a mistake fails loudly at the boundary instead of silently corrupting
 * neighbouring blocks.
 */
export function blockIndex(x: number, y: number, z: number): number {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    !Number.isInteger(z) ||
    x < 0 ||
    x >= CHUNK_SIZE_X ||
    y < 0 ||
    y >= CHUNK_SIZE_Y ||
    z < 0 ||
    z >= CHUNK_SIZE_Z
  ) {
    throw new RangeError(
      `blockIndex out of range: (${x}, ${y}, ${z}) for chunk 16x256x16`,
    );
  }
  return x + CHUNK_SIZE_X * (z + CHUNK_SIZE_Z * y);
}

/**
 * Stable string form of a chunk key. Used for map keys and save files.
 *
 * Validates both components: a key that cannot be read back is not a key, so
 * serialising a fractional, NaN or infinite coordinate would produce a string
 * that this module's own inverse rejects.
 */
export function chunkKeyToString(key: { cx: number; cz: number }): string {
  const cx = requireSafeInteger(key.cx, "cx");
  const cz = requireSafeInteger(key.cz, "cz");
  return `${cx},${cz}`;
}

/**
 * Inverse of {@link chunkKeyToString}.
 *
 * Parses STRICTLY: only a canonical decimal integer literal is accepted.
 * `Number()` alone is far too permissive - it yields 0 for "" and " ", 16 for
 * "0x10", 1000 for "1e3", 5 for "+5" and "0b101", and 1 for "1.0" - so "1,"
 * and "1,0" would address the same chunk. This is the canonical form
 * {@link chunkKeyToString} emits, so round-tripping is exact.
 */
export function chunkKeyFromString(text: string): { cx: number; cz: number } {
  const parts = text.split(",");
  if (parts.length !== 2) {
    throw new Error(`invalid chunk key: ${JSON.stringify(text)}`);
  }
  const cx = parseIntegerLiteral(parts[0] as string);
  const cz = parseIntegerLiteral(parts[1] as string);
  if (cx === null || cz === null) {
    throw new Error(`invalid chunk key: ${JSON.stringify(text)}`);
  }
  return { cx, cz };
}

/** Canonical decimal integer literal only: no sign-plus, hex, exponent, or dot. */
const INTEGER_LITERAL = /^-?(?:0|[1-9][0-9]*)$/;

function parseIntegerLiteral(text: string): number | null {
  if (!INTEGER_LITERAL.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function requireSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `chunk key ${name} must be a safe integer, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * Version of the save-file schema written by M2. Bump on any breaking change
 * to the on-disk format; readers must tolerate older versions.
 */
export const SAVE_SCHEMA_VERSION = 1;
