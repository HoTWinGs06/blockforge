/**
 * BlockForge — development world bridge.
 *
 * TEMPORARY SEAM. The real world comes from the ENGINE agent
 * (src/core/world + src/engine). Until that lands, this provides a small
 * deterministic stand-in so the renderer, the HUD and the G2 smoke test have
 * something real to drive.
 *
 * This file is owned by RENDER/UI and lives deliberately OUTSIDE src/engine/
 * and OUTSIDE src/core/ so it never collides with the engine's ownership and
 * never pollutes the pure core. It is deleted and replaced by the engine's
 * real implementation the moment the engine's mesh API lands.
 *
 * It is deterministic on purpose: a fixed integer hash, no Math.random.
 */

import { BlockId, type ChunkKey } from "../core/types.js";
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from "../core/constants.js";
import type { EngineBridge } from "../main.js";
import { installConsoleGuard, type WorldRenderer } from "../render/index.js";

/** The chunks this bridge keeps meshes for. */
const CHUNKS: readonly ChunkKey[] = [
  { cx: 0, cz: 0 },
  { cx: 1, cz: 0 },
  { cx: 0, cz: 1 },
  { cx: -1, cz: 0 },
];

/** Deterministic value noise, good enough for a flat-ish test landscape. */
function terrainHeight(x: number, z: number): number {
  let h = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let octave = 0; octave < 3; octave++) {
    const fx = Math.floor(x * frequency);
    const fz = Math.floor(z * frequency);
    const v = hash2(fx, fz) * 2 - 1;
    h += v * amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return Math.floor(64 + h * 6);
}

function hash2(x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

/** A development world: a chunk store, a block grid and a greedy-free mesher. */
export class DevWorld implements EngineBridge {
  private readonly chunks = new Map<string, Map<string, BlockId>>();
  private readonly dirty = new Set<string>();

  constructor() {
    for (const key of CHUNKS) {
      this.chunks.set(this.keyOf(key), this.generate(key));
      this.dirty.add(this.keyOf(key));
    }
  }

  private keyOf(key: ChunkKey): string {
    return `${key.cx},${key.cz}`;
  }

  private generate(key: ChunkKey): Map<string, BlockId> {
    const blocks = new Map<string, BlockId>();
    for (let x = 0; x < CHUNK_SIZE_X; x++) {
      for (let z = 0; z < CHUNK_SIZE_Z; z++) {
        const wx = key.cx * CHUNK_SIZE_X + x;
        const wz = key.cz * CHUNK_SIZE_Z + z;
        const h = terrainHeight(wx, wz);
        for (let y = 0; y < h && y < CHUNK_SIZE_Y; y++) {
          const id =
            y === h - 1
              ? BlockId.Loam
              : y > h - 4
                ? BlockId.Regolith
                : BlockId.Slate;
          blocks.set(`${wx},${y},${wz}`, id);
        }
      }
    }
    return blocks;
  }

  blockAt(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= CHUNK_SIZE_Y) {
      return BlockId.Air;
    }
    const chunk = this.chunks.get(this.keyOf(this.chunkKeyOf(x, z)));
    if (!chunk) {
      return BlockId.Air;
    }
    return chunk.get(`${x},${y},${z}`) ?? BlockId.Air;
  }

  setBlock(x: number, y: number, z: number, id: BlockId): void {
    if (y < 0 || y >= CHUNK_SIZE_Y) {
      return;
    }
    const ck = this.chunkKeyOf(x, z);
    const chunk = this.chunks.get(this.keyOf(ck));
    if (!chunk) {
      return;
    }
    chunk.set(`${x},${y},${z}`, id);
    this.dirty.add(this.keyOf(ck));
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.blockAt(x, y, z) !== BlockId.Air;
  }

  chunkKeyOf(x: number, z: number): ChunkKey {
    return {
      cx: Math.floor(x / CHUNK_SIZE_X),
      cz: Math.floor(z / CHUNK_SIZE_Z),
    };
  }

  pendingChunks(): ChunkKey[] {
    const out: ChunkKey[] = [];
    for (const id of this.dirty) {
      const [cx, cz] = id.split(",").map(Number);
      out.push({ cx: cx ?? 0, cz: cz ?? 0 });
    }
    this.dirty.clear();
    return out;
  }

  syncChunk(key: ChunkKey, renderer: WorldRenderer): void {
    renderer.setChunk(key, this.meshChunk(key));
  }

  /** A simple per-face mesher for the dev world. */
  private meshChunk(key: ChunkKey): {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    indices: Uint32Array;
    blocks: Uint8Array;
  } {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const blockIds: number[] = [];

    const ox = key.cx * CHUNK_SIZE_X;
    const oz = key.cz * CHUNK_SIZE_Z;

    const faces: readonly {
      readonly dir: readonly [number, number, number];
      readonly corners: readonly (readonly [number, number, number])[];
    }[] = [
      { dir: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
      { dir: [0, -1, 0], corners: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
      { dir: [0, 0, 1], corners: [[1, 0, 1], [0, 0, 1], [0, 1, 1], [1, 1, 1]] },
      { dir: [0, 0, -1], corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
      { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
      { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]] },
    ];

    for (let x = 0; x < CHUNK_SIZE_X; x++) {
      for (let z = 0; z < CHUNK_SIZE_Z; z++) {
        for (let y = 0; y < CHUNK_SIZE_Y; y++) {
          const id = this.blockAt(ox + x, y, oz + z);
          if (id === BlockId.Air) {
            continue;
          }
          for (const face of faces) {
            const [dx, dy, dz] = face.dir;
            if (this.isSolid(ox + x + dx, y + dy, oz + z + dz)) {
              continue;
            }
            const base = positions.length / 3;
            for (const c of face.corners) {
              positions.push(c[0] + x, c[1] + y, c[2] + z);
              normals.push(dx, dy, dz);
              uvs.push(c[0], c[2]);
            }
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            // one entry per triangle
            blockIds.push(ordinalOf(id), ordinalOf(id));
          }
        }
      }
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      indices: new Uint32Array(indices),
      blocks: new Uint8Array(blockIds),
    };
  }
}

/** The ordinal of a block id, matching the order of the BlockId enum. */
function ordinalOf(id: BlockId): number {
  return ALL_IDS.indexOf(id);
}

const ALL_IDS: readonly BlockId[] = [
  BlockId.Air,
  BlockId.Voidstone,
  BlockId.Slate,
  BlockId.Rubble,
  BlockId.Regolith,
  BlockId.Loam,
  BlockId.Sand,
  BlockId.Gravel,
  BlockId.Clay,
  BlockId.Timber,
  BlockId.Foliage,
  BlockId.Tidewater,
  BlockId.Emberflow,
  BlockId.Crystpane,
  BlockId.Masonry,
  BlockId.Anthracite,
  BlockId.Ironveil,
  BlockId.Gildenseam,
  BlockId.Lumencrystal,
  BlockId.Emberlamp,
  BlockId.Smeltforge,
  BlockId.Craftbench,
  BlockId.Millplank,
];

/** Boot the game with the development world. */
export function bootDev(): void {
  // Install the console guard BEFORE the WebGL context is created, so the
  // driver's own performance chatter never reaches the console stream that
  // the G2 gate asserts on. Real errors are never filtered.
  installConsoleGuard();

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (!canvas) {
    throw new Error("canvas #game not found");
  }
  void import("../main.js").then(({ mountGame }) => {
    mountGame(canvas, new DevWorld());
  });
}

// Boot on import: this module is the entry script in index.html.
bootDev();
