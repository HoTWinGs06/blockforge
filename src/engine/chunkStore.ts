/**
 * BlockForge — chunk store.
 *
 * OWNERSHIP: ENGINE.
 *
 * The store owns the chunk cache: it generates chunks on demand, keeps them
 * addressable by chunk key, serves world-space block reads and writes, and
 * hands the mesher the four horizontal neighbours it needs to get chunk
 * borders right.
 *
 * This layer may use browser APIs (it is `src/engine/`, not `src/core/`),
 * but it stays deterministic: chunk content is a pure function of the seed.
 */

import { BlockId, SOLID_BLOCKS } from "../core/types.js";
import type { Chunk, ChunkKey, MeshOutput } from "../core/types.js";
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  chunkKeyToString,
} from "../core/constants.js";
import { blockFromOrdinal, blockOrdinal } from "../core/world.js";
import { getBlock, setBlock } from "../core/world.js";
import { generateChunk } from "../core/world.js";
import { meshChunk, meshSection } from "../core/meshing.js";
import type { ChunkNeighbours } from "../core/world.js";
import type { RaycastWorld } from "../core/raycast.js";
import type { SolidWorld } from "../core/physics.js";
import { isFluidBlock } from "../core/physics.js";

/**
 * A cache of generated chunks with world-space access.
 */
export class ChunkStore implements SolidWorld, RaycastWorld {
  readonly seed: number;
  private readonly chunks = new Map<string, Chunk>();

  constructor(seed: number) {
    this.seed = seed;
  }

  /** The chunk at `key`, generated on demand. */
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

  /** The chunk at `key`, if it is already loaded. */
  peekChunk(key: ChunkKey): Chunk | undefined {
    return this.chunks.get(chunkKeyToString(key));
  }

  /** True when the chunk at `key` is loaded. */
  hasChunk(key: ChunkKey): boolean {
    return this.chunks.has(chunkKeyToString(key));
  }

  /** Every loaded chunk, in key order. */
  loadedChunks(): Chunk[] {
    return [...this.chunks.values()].sort((a, b) =>
      chunkKeyToString(a.key) < chunkKeyToString(b.key) ? -1 : 1,
    );
  }

  /** The number of loaded chunks. */
  get size(): number {
    return this.chunks.size;
  }

  /** The block at world coordinates. Out-of-world reads are air. */
  getBlockAt(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= CHUNK_SIZE_Y) {
      return BlockId.Air;
    }
    const key = {
      cx: Math.floor(x / CHUNK_SIZE_X),
      cz: Math.floor(z / CHUNK_SIZE_Z),
    };
    const chunk = this.getChunk(key);
    return blockFromOrdinal(
      getBlock(
        chunk,
        x - key.cx * CHUNK_SIZE_X,
        y,
        z - key.cz * CHUNK_SIZE_Z,
      ),
    );
  }

  /** The block at world coordinates, for the raycaster. */
  blockAt(x: number, y: number, z: number): BlockId {
    return this.getBlockAt(x, y, z);
  }

  /** Write a block at world coordinates. */
  setBlockAt(x: number, y: number, z: number, block: BlockId): boolean {
    if (y < 0 || y >= CHUNK_SIZE_Y) {
      return false;
    }
    const key = {
      cx: Math.floor(x / CHUNK_SIZE_X),
      cz: Math.floor(z / CHUNK_SIZE_Z),
    };
    const chunk = this.getChunk(key);
    setBlock(chunk, x - key.cx * CHUNK_SIZE_X, y, z - key.cz * CHUNK_SIZE_Z, block);
    return true;
  }

  /** True when the block at world coordinates collides with bodies. */
  isSolid(x: number, y: number, z: number): boolean {
    if (y < 0) {
      return true; // the world floor
    }
    return SOLID_BLOCKS.has(this.getBlockAt(x, y, z));
  }

  /**
   * True when the block at world coordinates is a fluid a body can be in.
   *
   * Tidewater is not solid, so a body can be inside it - and then it floats
   * and swims. A world that cannot answer has no fluids.
   */
  isFluid(x: number, y: number, z: number): boolean {
    if (y < 0) {
      return false;
    }
    return isFluidBlock(this.getBlockAt(x, y, z));
  }

  /** The four horizontal neighbours of a chunk, for the mesher. */
  neighbours(key: ChunkKey): ChunkNeighbours {
    const west = this.peekChunk({ cx: key.cx - 1, cz: key.cz });
    const east = this.peekChunk({ cx: key.cx + 1, cz: key.cz });
    const north = this.peekChunk({ cx: key.cx, cz: key.cz - 1 });
    const south = this.peekChunk({ cx: key.cx, cz: key.cz + 1 });
    return { west, east, north, south };
  }

  /** Mesh one 16-tall section of a chunk. */
  meshSection(key: ChunkKey, section: number): MeshOutput {
    return meshSection(this.getChunk(key), section, this.neighbours(key));
  }

  /** Mesh a whole chunk, all 16 sections. */
  meshChunk(key: ChunkKey): MeshOutput {
    return meshChunk(this.getChunk(key), this.neighbours(key));
  }

  /**
   * A hash of the loaded chunks.
   *
   * The SEED is mixed in first, as EIGHT little-endian bytes - the low 32
   * bits and then the high 32 bits - so two stores with different seeds
   * never hash the same however few chunks they have loaded. (Mixing only
   * the low half made a seed and that seed 2^32 apart hash identically.)
   * Chunks are then hashed in key order with their block bytes, so the
   * value depends on the world's content and not on the order it was built
   * in.
   */
  hash(): string {
    let h = 0x811c9dc5;
    const mix = (byte: number): void => {
      h ^= byte & 0xff;
      h = Math.imul(h, 0x01000193);
    };
    const low = this.seed >>> 0;
    const high = Math.floor(this.seed / 4294967296) | 0;
    mix(low & 0xff);
    mix((low >>> 8) & 0xff);
    mix((low >>> 16) & 0xff);
    mix((low >>> 24) & 0xff);
    mix(high & 0xff);
    mix((high >>> 8) & 0xff);
    mix((high >>> 16) & 0xff);
    mix((high >>> 24) & 0xff);
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

  /** The ordinal of a block id, for callers that store raw bytes. */
  ordinalOf(block: BlockId): number {
    return blockOrdinal(block);
  }
}
