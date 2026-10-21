/**
 * BlockForge — the real engine bridge.
 *
 * This is the handover point agreed between RENDER/UI and ENGINE: the renderer
 * consumes the ENGINE's real world, and the temporary development stand-in
 * (src/dev/world.ts) is deleted rather than left as a second way to do the
 * same thing.
 *
 * The engine's ChunkStore (src/engine/chunkStore.ts) already provides
 * everything the render layer needs:
 *   getBlockAt / setBlockAt / isSolid   - world-space block access
 *   meshChunk(key)                      - the mesher, with neighbours
 *   hash()                              - the determinism check
 *
 * Nothing in src/core/ or src/engine/ is modified by this file. It is an
 * adapter, and it lives on the render side of the seam.
 */

import type { BlockId, ChunkKey } from "../core/types.js";
import { CHUNK_SIZE_X, CHUNK_SIZE_Z } from "../core/constants.js";
import { ChunkStore } from "../engine/index.js";
import type { WorldRenderer } from "./index.js";
import type { EngineBridge } from "../main.js";

/** The seed the world is generated from. */
export const WORLD_SEED = 1337;

/**
 * The canonical chunk set the determinism hash is computed over.
 *
 * Fixed on purpose: the hash must depend only on the seed and this set, never
 * on which chunks happen to be cached.
 */
const CANONICAL_HASH_CHUNKS: readonly ChunkKey[] = [
  { cx: 0, cz: 0 },
  { cx: 1, cz: 0 },
  { cx: -1, cz: 0 },
  { cx: 0, cz: 1 },
  { cx: 0, cz: -1 },
];

/** Chunks around the origin that are meshed at startup. */
const STARTUP_CHUNKS: readonly ChunkKey[] = [
  { cx: 0, cz: 0 },
  { cx: 1, cz: 0 },
  { cx: -1, cz: 0 },
  { cx: 0, cz: 1 },
  { cx: 0, cz: -1 },
];

/**
 * Adapts the ENGINE's ChunkStore to the render layer's EngineBridge.
 */
export class EngineWorld implements EngineBridge {
  private readonly store: ChunkStore;
  private readonly dirty = new Set<string>();

  constructor(seed: number = WORLD_SEED) {
    this.store = new ChunkStore(seed);
    for (const key of STARTUP_CHUNKS) {
      this.dirty.add(this.keyOf(key));
    }
  }

  private keyOf(key: ChunkKey): string {
    return `${key.cx},${key.cz}`;
  }

  blockAt(x: number, y: number, z: number): BlockId {
    return this.store.getBlockAt(x, y, z);
  }

  setBlock(x: number, y: number, z: number, id: BlockId): void {
    if (this.store.setBlockAt(x, y, z, id)) {
      this.dirty.add(this.keyOf({ cx: Math.floor(x / CHUNK_SIZE_X), cz: Math.floor(z / CHUNK_SIZE_Z) }));
    }
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.store.isSolid(x, y, z);
  }

  pendingChunks(): ChunkKey[] {
    const out: ChunkKey[] = [];
    for (const id of this.dirty) {
      const parts = id.split(",");
      const cx = Number(parts[0]);
      const cz = Number(parts[1]);
      if (Number.isInteger(cx) && Number.isInteger(cz)) {
        out.push({ cx, cz });
      }
    }
    this.dirty.clear();
    return out;
  }

  syncChunk(key: ChunkKey, renderer: WorldRenderer): void {
    renderer.setChunk(key, this.store.meshChunk(key));
  }

  /**
   * The world's determinism hash, for the G6 check.
   *
   * NOTE: this does NOT call store.hash() directly. The engine's hash() walks
   * only the chunks already cached, so on a fresh store it returns the FNV
   * offset basis - a CONSTANT, identical for every seed. That is finding E5
   * against the engine, and it is exactly the kind of check that cannot fail
   * while reporting green.
   *
   * So the renderer hashes a FIXED, canonical chunk set: the origin chunk
   * plus its four horizontal neighbours, generated on demand. The value now
   * depends only on the seed and the chunk set, never on call order or on
   * what happens to be cached.
   */
  get worldHash(): string {
    let h = 0x811c9dc5;
    const mix = (byte: number): void => {
      h ^= byte & 0xff;
      h = Math.imul(h, 0x01000193);
    };
    for (const key of CANONICAL_HASH_CHUNKS) {
      for (const char of `${key.cx},${key.cz}`) {
        mix(char.charCodeAt(0));
      }
      const chunk = this.store.getChunk(key);
      for (let i = 0; i < chunk.blocks.length; i++) {
        mix(chunk.blocks[i] as number);
      }
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
}
