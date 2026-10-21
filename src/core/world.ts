/**
 * BlockForge — the chunked world.
 *
 * OWNERSHIP: ENGINE.
 *
 * Everything the world is made of: the block metadata every layer shares, the
 * chunk storage helpers, the terrain generator and the sparse `World` map.
 *
 * A `World` is a sparse map of chunks keyed by their chunk key. It owns
 * generation, block access across chunk borders, and the world hash used by
 * gate G6.
 *
 * Everything here is pure with respect to the outside world: the world
 * depends only on its seed, so two worlds with the same seed are identical.
 */
import { ALL_BLOCK_IDS, BlockId, SOLID_BLOCKS, TRANSPARENT_BLOCKS } from "./types.js";
import type { Chunk, ChunkKey, WorldSnapshot } from "./types.js";
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  CHUNK_VOLUME,
  SAVE_SCHEMA_VERSION,
  blockIndex,
  chunkKeyFromString,
  chunkKeyToString,
} from "./constants.js";
import { fbm2, valueNoise2, valueNoise3 } from "./noise.js";

// ── blocks ────────────────────────────────────────────────────
/** BlockId -> ordinal. */
const ORDINAL_BY_ID = new Map<BlockId, number>(
  ALL_BLOCK_IDS.map((id, index) => [id, index]),
);

/** Ordinal -> BlockId. */
const ID_BY_ORDINAL: readonly BlockId[] = ALL_BLOCK_IDS;

/** Ordinal of a block id. Throws on an unknown id rather than guessing. */
export function blockOrdinal(id: BlockId): number {
  const ordinal = ORDINAL_BY_ID.get(id);
  if (ordinal === undefined) {
    throw new Error(`unknown BlockId: ${JSON.stringify(id)}`);
  }
  return ordinal;
}

/** Block id for an ordinal. Throws when the ordinal is out of range. */
export function blockFromOrdinal(ordinal: number): BlockId {
  const id = ID_BY_ORDINAL[ordinal];
  if (id === undefined) {
    throw new RangeError(`block ordinal out of range: ${ordinal}`);
  }
  return id;
}

/**
 * Per-ordinal lookup tables, precomputed so the mesher's inner loop never
 * touches a Map.
 */
const TRANSPARENT_BY_ORDINAL: readonly boolean[] = ALL_BLOCK_IDS.map((id) =>
  TRANSPARENT_BLOCKS.has(id),
);
const OPAQUE_BY_ORDINAL: readonly boolean[] = ALL_BLOCK_IDS.map(
  (id) => SOLID_BLOCKS.has(id) && !TRANSPARENT_BLOCKS.has(id),
);

/** True when the ordinal is a transparent block (air, tidewater, ...). */
export function isTransparentOrdinal(ordinal: number): boolean {
  return TRANSPARENT_BY_ORDINAL[ordinal] === true;
}

/**
 * True when the ordinal blocks light — a full opaque cube. Tidewater,
 * emberflow and crystpane are transparent even when solid, so they do not
 * occlude a neighbour's face.
 */
export function isOpaqueOrdinal(ordinal: number): boolean {
  return OPAQUE_BY_ORDINAL[ordinal] === true;
}

/**
 * Should the face of `self` toward its neighbour `other` be drawn?
 *
 * - air has no faces;
 * - an opaque neighbour hides the face entirely, so two solid blocks never
 *   show a seam between them;
 * - a face between two blocks of the same kind is culled, which is what keeps
 *   the inside of a body of water free of internal quads.
 */
export function shouldRenderFace(self: number, other: number): boolean {
  if (self === 0) {
    return false; // air never has a face
  }
  if (self === other) {
    return false; // no face between two blocks of the same kind
  }
  return !isOpaqueOrdinal(other);
}

// ── chunk ─────────────────────────────────────────────────────
/** Ordinal of Air. */
export const AIR_ORDINAL = 0;

/**
 * The four horizontal neighbours of a chunk, by chunk offset.
 *
 * `west` is at (cx - 1, cz), `east` at (cx + 1, cz), `north` at (cx, cz - 1)
 * and `south` at (cx, cz + 1). A missing neighbour is treated as air, so a
 * chunk at the edge of a generated region still meshes — with visible side
 * faces — instead of failing.
 *
 * Lives here rather than in the mesher so that both the mesher and the world
 * can use it without importing each other.
 */
export interface ChunkNeighbours {
  readonly west?: Chunk | undefined;
  readonly east?: Chunk | undefined;
  readonly north?: Chunk | undefined;
  readonly south?: Chunk | undefined;
}

/** A chunk full of air. */
export function createChunk(key: ChunkKey): Chunk {
  return { key, blocks: new Uint8Array(CHUNK_VOLUME) };
}

/**
 * Index of a block inside a chunk, without the range check of `blockIndex`.
 * Callers are responsible for the bounds; used on hot paths.
 */
export function chunkIndex(x: number, y: number, z: number): number {
  return x + CHUNK_SIZE_X * (z + CHUNK_SIZE_Z * y);
}

/** Read a block. Out-of-range coordinates read as air. */
export function getBlock(chunk: Chunk, x: number, y: number, z: number): number {
  if (x < 0 || x >= CHUNK_SIZE_X || y < 0 || y >= CHUNK_SIZE_Y || z < 0 || z >= CHUNK_SIZE_Z) {
    return AIR_ORDINAL;
  }
  return chunk.blocks[chunkIndex(x, y, z)] ?? AIR_ORDINAL;
}

/** Write a block. Out-of-range coordinates are ignored. */
export function setBlock(
  chunk: Chunk,
  x: number,
  y: number,
  z: number,
  id: BlockId,
): void {
  if (x < 0 || x >= CHUNK_SIZE_X || y < 0 || y >= CHUNK_SIZE_Y || z < 0 || z >= CHUNK_SIZE_Z) {
    return;
  }
  chunk.blocks[chunkIndex(x, y, z)] = blockOrdinal(id);
}

// ── terrain ───────────────────────────────────────────────────
/** Sea level. Below it, columns flood with tidewater. */
export const SEA_LEVEL = 62;
/** Lowest terrain height. */
export const MIN_HEIGHT = 8;
/** Highest terrain height (leaves room for trees). */
export const MAX_HEIGHT = 140;

/** Ordinals, resolved once at module load. */
const O_VOIDSTONE = blockOrdinal(BlockId.Voidstone);
const O_SLATE = blockOrdinal(BlockId.Slate);
const O_RUBBLE = blockOrdinal(BlockId.Rubble);
const O_REGOLITH = blockOrdinal(BlockId.Regolith);
const O_LOAM = blockOrdinal(BlockId.Loam);
const O_SAND = blockOrdinal(BlockId.Sand);
const O_GRAVEL = blockOrdinal(BlockId.Gravel);
const O_CLAY = blockOrdinal(BlockId.Clay);
const O_TIDEWATER = blockOrdinal(BlockId.Tidewater);
const O_TIMBER = blockOrdinal(BlockId.Timber);
const O_FOLIAGE = blockOrdinal(BlockId.Foliage);
const O_ANTHRACITE = blockOrdinal(BlockId.Anthracite);
const O_IRONVEIL = blockOrdinal(BlockId.Ironveil);
const O_GILDENSEAM = blockOrdinal(BlockId.Gildenseam);
const O_LUMENCRYSTAL = blockOrdinal(BlockId.Lumencrystal);
const O_CRYSTPANE = blockOrdinal(BlockId.Crystpane);

/**
 * Terrain height at a world column.
 *
 * Two noise layers: a broad continental shape (low frequency, high amplitude)
 * and a rolling hill layer (higher frequency, lower amplitude). The result is
 * continuous across chunk borders because it is a function of world x/z.
 */
export function terrainHeight(
  seed: number,
  worldX: number,
  worldZ: number,
): number {
  const continental = fbm2(seed, worldX / 180, worldZ / 180, 4);
  const hills = fbm2(seed ^ 0x5f356495, worldX / 48, worldZ / 48, 3);
  const raw = 24 + continental * 74 + hills * 26;
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(raw)));
}

/**
 * Which surface block sits on top of a column.
 *
 * Determined by a low-frequency noise field so that sand beaches, clay flats
 * and gravel screes form coherent regions rather than per-column noise.
 */
function surfaceBlock(
  seed: number,
  worldX: number,
  worldZ: number,
  height: number,
): number {
  const moisture = valueNoise2(seed ^ 0x2545f491, worldX / 64, worldZ / 64);
  if (height <= SEA_LEVEL + 1) {
    return O_SAND;
  }
  if (moisture > 0.72) {
    return O_CLAY;
  }
  if (moisture < 0.28) {
    return O_GRAVEL;
  }
  return O_LOAM;
}

/**
 * Fill a chunk's block array from the seed and its key.
 *
 * Mutates `blocks` in place; the caller owns the array.
 */
function fillChunk(seed: number, key: ChunkKey, blocks: Uint8Array): void {
  const baseX = key.cx * CHUNK_SIZE_X;
  const baseZ = key.cz * CHUNK_SIZE_Z;

  // Pass 1: the column stack.
  for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
    const worldX = baseX + lx;
    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      const worldZ = baseZ + lz;
      const height = terrainHeight(seed, worldX, worldZ);
      const surface = surfaceBlock(seed, worldX, worldZ, height);

      for (let y = 0; y <= height; y++) {
        let block: number;
        if (y === 0) {
          block = O_VOIDSTONE;
        } else if (y === height) {
          block = surface;
        } else if (y > height - 4) {
          block = O_REGOLITH;
        } else if (y > height - 8) {
          block = O_RUBBLE;
        } else {
          block = O_SLATE;
        }
        blocks[blockIndex(lx, y, lz)] = block;
      }

      // Water fills the column up to sea level.
      for (let y = height + 1; y <= SEA_LEVEL; y++) {
        blocks[blockIndex(lx, y, lz)] = O_TIDEWATER;
      }
    }
  }

  // Pass 2: ore veins, placed by 3D noise so they read as veins.
  for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
    const worldX = baseX + lx;
    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      const worldZ = baseZ + lz;
      for (let y = 1; y < 40; y++) {
        const vein = valueNoise3(seed ^ 0x7f4a7c15, worldX / 7, y / 7, worldZ / 7);
        let ore = -1;
        if (vein > 0.955) {
          ore = O_LUMENCRYSTAL;
        } else if (vein > 0.925) {
          ore = O_GILDENSEAM;
        } else if (vein > 0.895) {
          ore = O_IRONVEIL;
        } else if (vein > 0.865) {
          ore = O_ANTHRACITE;
        }
        if (ore >= 0) {
          blocks[blockIndex(lx, y, lz)] = ore;
        }
      }
    }
  }

  // Pass 3: features — trees and crystal outcrops. Placed from a hash of the
  // world column so a feature belongs to exactly one chunk regardless of
  // generation order.
  for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
    const worldX = baseX + lx;
    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      const worldZ = baseZ + lz;
      const height = terrainHeight(seed, worldX, worldZ);
      if (height <= SEA_LEVEL) {
        continue;
      }
      const surface = surfaceBlock(seed, worldX, worldZ, height);
      if (surface !== O_LOAM) {
        continue;
      }
      // Sparse per-column hash: roughly one tree per ~40 eligible columns.
      const pick = valueNoise2(seed ^ 0x1b873593, worldX * 0.37, worldZ * 0.37);
      if (pick > 0.965) {
        placeTree(seed, blocks, lx, height + 1, lz);
      } else if (pick < 0.012) {
        placeOutcrop(blocks, lx, height + 1, lz);
      }
    }
  }
}

/**
 * A tree: timber trunk with a foliage crown. Kept within the chunk so that
 * chunk contents never depend on a neighbour.
 */
function placeTree(
  seed: number,
  blocks: Uint8Array,
  lx: number,
  baseY: number,
  lz: number,
): void {
  const height = 4 + (Math.floor(valueNoise2(seed ^ 0x27d4eb2f, lx, lz) * 3) | 0);
  const topY = baseY + height - 1;
  if (topY + 2 >= CHUNK_SIZE_Y) {
    return;
  }
  for (let y = baseY; y <= topY; y++) {
    blocks[blockIndex(lx, y, lz)] = O_TIMBER;
  }
  // Crown: a 5x5x2 slab with the corners trimmed, then a 3x3 cap.
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) {
        continue;
      }
      const x = lx + dx;
      const z = lz + dz;
      if (x < 0 || x >= CHUNK_SIZE_X || z < 0 || z >= CHUNK_SIZE_Z) {
        continue;
      }
      blocks[blockIndex(x, topY, z)] = O_FOLIAGE;
      if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) {
        blocks[blockIndex(x, topY + 1, z)] = O_FOLIAGE;
      }
    }
  }
  blocks[blockIndex(lx, topY + 1, lz)] = O_FOLIAGE;
}

/** A small crystal outcrop on the surface. */
function placeOutcrop(
  blocks: Uint8Array,
  lx: number,
  baseY: number,
  lz: number,
): void {
  if (baseY + 1 >= CHUNK_SIZE_Y) {
    return;
  }
  blocks[blockIndex(lx, baseY, lz)] = O_CRYSTPANE;
}

/**
 * Generate the chunk at `key` from `seed`.
 *
 * Deterministic and order-independent: the result depends only on the seed
 * and the chunk key.
 */
export function generateChunk(seed: number, key: ChunkKey): Chunk {
  const blocks = new Uint8Array(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z);
  fillChunk(seed, key, blocks);
  return { key, blocks };
}

// ── world ─────────────────────────────────────────────────────
/** A block reference in world coordinates. */
export interface WorldBlockPos {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * A chunked world.
 *
 * Chunks are generated on demand and cached. Generation is deterministic, so
 * a chunk that is evicted and regenerated comes back byte-identical.
 */
export class World {
  readonly seed: number;
  private readonly chunks = new Map<string, Chunk>();

  constructor(seed: number) {
    this.seed = seed;
  }

  /** The chunk at `key`, generating it if it is not loaded. */
  getChunk(key: ChunkKey): Chunk {
    const id = chunkKeyToString(key);
    const existing = this.chunks.get(id);
    if (existing) {
      return existing;
    }
    const chunk = generateChunk(this.seed, key);
    this.chunks.set(id, chunk);
    return chunk;
  }

  /** The chunk at `key`, or undefined if it has not been loaded. */
  peekChunk(key: ChunkKey): Chunk | undefined {
    return this.chunks.get(chunkKeyToString(key));
  }

  /** True when the chunk at `key` is loaded. */
  hasChunk(key: ChunkKey): boolean {
    return this.chunks.has(chunkKeyToString(key));
  }

  /** Every loaded chunk, in a deterministic order (by key string). */
  loadedChunks(): Chunk[] {
    return [...this.chunks.values()].sort((a, b) =>
      chunkKeyToString(a.key) < chunkKeyToString(b.key) ? -1 : 1,
    );
  }

  /** Drop a chunk from the cache. */
  unloadChunk(key: ChunkKey): void {
    this.chunks.delete(chunkKeyToString(key));
  }

  /**
   * The block at world coordinates.
   *
   * Coordinates outside the world read as air.
   */
  getBlockAt(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= CHUNK_SIZE_Y) {
      return BlockId.Air;
    }
    const chunk = this.getChunk({
      cx: Math.floor(x / CHUNK_SIZE_X),
      cz: Math.floor(z / CHUNK_SIZE_Z),
    });
    const localX = x - chunk.key.cx * CHUNK_SIZE_X;
    const localZ = z - chunk.key.cz * CHUNK_SIZE_Z;
    return blockFromOrdinal(getBlock(chunk, localX, y, localZ));
  }

  /** Write a block at world coordinates. Returns false when out of bounds. */
  setBlockAt(x: number, y: number, z: number, block: BlockId): boolean {
    if (y < 0 || y >= CHUNK_SIZE_Y) {
      return false;
    }
    const key = { cx: Math.floor(x / CHUNK_SIZE_X), cz: Math.floor(z / CHUNK_SIZE_Z) };
    const chunk = this.getChunk(key);
    setBlock(
      chunk,
      x - key.cx * CHUNK_SIZE_X,
      y,
      z - key.cz * CHUNK_SIZE_Z,
      block,
    );
    return true;
  }

  /**
   * The four horizontal neighbours of a chunk, for the mesher.
   *
   * A neighbour that has not been loaded is returned as undefined, which the
   * mesher treats as air.
   */
  neighbours(key: ChunkKey): ChunkNeighbours {
    const west = this.peekChunk({ cx: key.cx - 1, cz: key.cz });
    const east = this.peekChunk({ cx: key.cx + 1, cz: key.cz });
    const north = this.peekChunk({ cx: key.cx, cz: key.cz - 1 });
    const south = this.peekChunk({ cx: key.cx, cz: key.cz + 1 });
    return { west, east, north, south };
  }

  /** The terrain height at a world column, without generating anything. */
  heightAt(x: number, z: number): number {
    return terrainHeight(this.seed, x, z);
  }

  /**
   * A hash of the whole world.
   *
   * The SEED is mixed in first, so two worlds with different seeds can never
   * hash the same however few chunks they have loaded. Loaded chunks then
   * contribute their key and their bytes, in key order, so the hash depends
   * on the world content and not on the order it was built in.
   *
   * This is the value gate G6 compares across processes.
   */
  hash(): string {
    let h = 0x811c9dc5;
    const mix = (byte: number): void => {
      h ^= byte & 0xff;
      h = Math.imul(h, 0x01000193);
    };
    // The seed, as four little-endian bytes.
    const seed = this.seed >>> 0;
    mix(seed & 0xff);
    mix((seed >>> 8) & 0xff);
    mix((seed >>> 16) & 0xff);
    mix((seed >>> 24) & 0xff);
    for (const chunk of this.loadedChunks()) {
      for (const char of chunkKeyToString(chunk.key)) {
        mix(char.charCodeAt(0));
      }
      for (let i = 0; i < chunk.blocks.length; i++) {
        mix(chunk.blocks[i] as number);
      }
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  /** A serialisable snapshot of the loaded chunks. */
  snapshot(): WorldSnapshot {
    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      seed: this.seed,
      chunks: this.loadedChunks().map((chunk) => ({
        key: chunk.key,
        blocks: chunk.blocks.slice(),
      })),
    };
  }

  /** Rebuild a world from a snapshot. */
  static fromSnapshot(snapshot: WorldSnapshot): World {
    const world = new World(snapshot.seed);
    for (const chunk of snapshot.chunks) {
      world.chunks.set(chunkKeyToString(chunk.key), {
        key: chunk.key,
        blocks: chunk.blocks.slice(),
      });
    }
    return world;
  }

  /** Parse a chunk key from its string form. */
  static parseKey(text: string): ChunkKey {
    return chunkKeyFromString(text);
  }
}
