/**
 * BlockForge — frozen core contract.
 *
 * OWNERSHIP: ARCHITECT (opencode). This file is the interface contract for the
 * whole project. Every other agent builds against it. Names declared here are
 * FROZEN as of M1 and must not be renamed — the brief requires the types to be
 * defined in milestone 1 and not renamed afterwards.
 *
 * HARD RULES for everything under src/core/ (enforced by the TEST AUTHOR's
 * determinism suite and the RED-TEAM's purity checks):
 *   - no Math.random, Date.now, performance.now
 *   - no DOM access, no localStorage/IndexedDB
 *   - no network calls, no Three.js imports
 *   - no imports from src/engine, src/render, src/net, src/gameplay, server/
 *   - plain TypeScript that runs in Node under Vitest with no GPU/canvas
 *
 * Consequence: same seed + same inputs => byte-identical world, in any order,
 * in any process.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Block kinds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Block kind identifiers.
 *
 * ORIGINALITY: these are BlockForge's own names. No Mojang/Microsoft block
 * name may be used here (or anywhere else in the project). The set below is
 * a game-idea re-expression, deliberately worded away from the well-known
 * vocabulary: a log is "timber", leaves are "foliage", cobblestone is
 * "rubble", diamond ore is "lumencrystal", and so on.
 */
export enum BlockId {
  Air = "air",
  Voidstone = "voidstone",
  Slate = "slate",
  Rubble = "rubble",
  Regolith = "regolith",
  Loam = "loam",
  Sand = "sand",
  Gravel = "gravel",
  Clay = "clay",
  Timber = "timber",
  Foliage = "foliage",
  Tidewater = "tidewater",
  Emberflow = "emberflow",
  Crystpane = "crystpane",
  Masonry = "masonry",
  Anthracite = "anthracite",
  Ironveil = "ironveil",
  Gildenseam = "gildenseam",
  Lumencrystal = "lumencrystal",
  Emberlamp = "emberlamp",
  Smeltforge = "smeltforge",
  Craftbench = "craftbench",
  Millplank = "millplank",
}

/**
 * A genuinely immutable Set.
 *
 * `Object.freeze` only makes an object's own PROPERTIES non-writable; a Set's
 * members live in internal slots that it cannot reach, so `Object.freeze(new
 * Set(...))` is still mutable. In the pure layer that is mutable global state,
 * which is exactly what the purity and determinism gates exist to prevent.
 *
 * This returns a Set whose mutating methods throw, so the type stays
 * `ReadonlySet<T>` (consumers keep using `.has()`) but a mutation attempt
 * fails loudly at the point of the mistake instead of silently corrupting
 * every later chunk.
 */
function immutableSet<T>(values: readonly T[]): ReadonlySet<T> {
  const target = new Set<T>(values);
  const mutators = new Set<string>(["add", "delete", "clear"]);
  return new Proxy(target, {
    get(source, prop) {
      const value = Reflect.get(source, prop, source);
      if (typeof value !== "function") return value;
      if (mutators.has(String(prop))) {
        return () => {
          throw new TypeError(
            "this block set is immutable - it is part of the frozen core contract",
          );
        };
      }
      return value.bind(source);
    },
  }) as ReadonlySet<T>;
}

/** Every BlockId value, in declaration order. Deterministic iteration order. */
export const ALL_BLOCK_IDS: readonly BlockId[] = Object.freeze(
  Object.values(BlockId) as BlockId[],
);

/** Blocks that are solid to collision. Air, Tidewater and Emberflow are not. */
export const SOLID_BLOCKS: ReadonlySet<BlockId> = immutableSet([
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
  ]);

/** Blocks that let light through (air, water, glass-like panes). */
export const TRANSPARENT_BLOCKS: ReadonlySet<BlockId> = immutableSet([
    BlockId.Air,
    BlockId.Tidewater,
    BlockId.Emberflow,
    BlockId.Crystpane,
  ]);

/**
 * Number of distinct block kinds. A chunk stores one byte per block, so byte
 * values at or above this are not valid block encodings.
 */
export const BLOCK_ID_COUNT = ALL_BLOCK_IDS.length;

/**
 * The byte that stores `id` in a chunk's block array.
 *
 * The encoding is the index of the id in {@link ALL_BLOCK_IDS} (declaration
 * order). This is the ONLY sanctioned mapping - consumers must not invent
 * their own.
 */
export function blockIdToByte(id: BlockId): number {
  const ordinal = ALL_BLOCK_IDS.indexOf(id);
  if (ordinal < 0) {
    throw new RangeError(`unknown BlockId: ${String(id)}`);
  }
  return ordinal;
}

/**
 * The BlockId encoded by `byte`.
 *
 * Throws for any byte that is not a valid ordinal. Callers decoding
 * untrusted bytes (a save file, a network packet) should screen with
 * {@link isValidBlockByte} first so a corrupt value is rejected rather than
 * thrown out of a decode loop.
 */
export function byteToBlockId(byte: number): BlockId {
  if (!isValidBlockByte(byte)) {
    throw new RangeError(
      `invalid block byte: ${String(byte)} (valid range 0..${BLOCK_ID_COUNT - 1})`,
    );
  }
  return ALL_BLOCK_IDS[byte] as BlockId;
}

/** True when `byte` encodes a real block kind. Cheap pre-check. */
export function isValidBlockByte(byte: number): boolean {
  return Number.isInteger(byte) && byte >= 0 && byte < BLOCK_ID_COUNT;
}

// ─────────────────────────────────────────────────────────────────────────────
// World geometry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Horizontal chunk coordinate. Chunk coordinates are signed; negative
 * coordinates are legal and must round-trip through `chunkKeyToString`.
 */
export interface ChunkKey {
  readonly cx: number;
  readonly cz: number;
}

/**
 * A chunk of blocks: 16 x 256 x 16.
 *
 * Storage order is FROZEN and defined by `blockIndex` in ./constants.ts:
 * blocks are stored y-major (all x/z for one y, then the next y layer).
 * Do not change this — it changes the serialized save format and the
 * byte-identical determinism guarantee.
 */
export interface Chunk {
  readonly key: ChunkKey;
  /** Length must equal CHUNK_VOLUME. One byte per block, indexed by BlockId ordinal. */
  readonly blocks: Uint8Array;
}

/**
 * A serialisable snapshot of one chunk. Used by the save format (M2) and by
 * the network protocol (M4). `blocks` uses the same frozen storage order as
 * {@link Chunk}.
 */
export interface ChunkSnapshot {
  readonly key: ChunkKey;
  readonly blocks: Uint8Array;
}

/**
 * Versioned, serialisable snapshot of an entire world.
 *
 * `schemaVersion` exists so that a save written by a later build can be
 * detected and handled rather than silently misread. M2 must write a
 * corruption-tolerant format; this type is the shape it writes.
 */
export interface WorldSnapshot {
  readonly schemaVersion: number;
  readonly seed: number;
  readonly chunks: readonly ChunkSnapshot[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic randomness
// ─────────────────────────────────────────────────────────────────────────────

/** Serialisable state of a {@link SeededRng}. */
export interface RngState {
  readonly seed: number;
  readonly state: number;
}

/**
 * The project's only source of randomness.
 *
 * Implementation lives in src/core/rng.ts and must be OWN (no library): a
 * splitmix64-style integer generator with float and range helpers. No
 * Math.random anywhere in the project.
 *
 * `fork` derives a deterministic child stream from a label, so independent
 * subsystems (terrain, decoration, mob spawns) can each have their own
 * reproducible stream without interfering with one another.
 */
export interface SeededRng {
  /** Uniform uint32. */
  nextUint32(): number;
  /** Uniform float in [0, 1). */
  nextFloat(): number;
  /** Uniform integer in [minInclusive, maxExclusive). */
  nextInt(minInclusive: number, maxExclusive: number): number;
  /** Deterministic child stream derived from this one and a label. */
  fork(label: string): SeededRng;
  /** Current state, for snapshot/restore. */
  getState(): RngState;
  /** Restore a previously captured state. */
  setState(state: RngState): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Meshing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Output of the greedy mesher for one chunk section.
 *
 * DETERMINISM: vertex order is stable. The same chunk and the same
 * neighbouring chunks must produce byte-identical arrays, in any process.
 *
 * Array conventions:
 *   - `positions` — 3 floats per vertex (x, y, z) in chunk-local space
 *   - `normals`   — 3 floats per vertex
 *   - `uvs`       — 2 floats per vertex
 *   - `indices`   — 3 per triangle, into the vertex arrays
 *   - `blocks`    — ONE entry per triangle, parallel to `indices`, holding the
 *                   BlockId of the face that triangle belongs to. The renderer
 *                   uses it to pick a texture without a reverse lookup. Length
 *                   is indices.length / 3.
 */
export interface MeshOutput {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly blocks: Uint8Array;
}

// ─────────────────────────────────────────────────────────────────────────────
// Player, inventory, items
// ─────────────────────────────────────────────────────────────────────────────

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Axis-aligned box used for collision and raycast intersection. */
export interface Aabb {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/**
 * Player state. Declared in full during M1 (including the survival fields
 * used in M3) so that adding them later is not a breaking change to a frozen
 * type.
 */
export interface PlayerState {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly onGround: boolean;
  readonly health: number;
  readonly hunger: number;
}

/** A stack of items in an inventory slot. */
export interface ItemStack {
  readonly id: string;
  readonly count: number;
  /** Remaining durability, if the item is a tool. */
  readonly durability?: number;
}

/**
 * Player inventory. `slots` is indexed by slot number; `selected` is the
 * hotbar index that is currently active.
 */
export interface Inventory {
  readonly slots: readonly ItemStack[];
  readonly selected: number;
}

/**
 * A crafting recipe.
 *
 * `shape` is present for shaped recipes (rows of ingredient tags, row-major,
 * any trailing empty rows trimmed) and absent for shapeless ones. M3 adds
 * ingredient-tag matching; the tag vocabulary lives in the recipe registry,
 * not here.
 */
export interface Recipe {
  readonly id: string;
  readonly kind: "shaped" | "shapeless";
  readonly ingredients: readonly string[];
  readonly shape?: readonly (readonly string[])[];
  readonly result: ItemStack;
}

// ─────────────────────────────────────────────────────────────────────────────
// Network protocol (M4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Version of the wire protocol. The server rejects any packet whose
 * `protocolVersion` does not match. Bump ONLY with a breaking change, and
 * coordinate the bump with NETCODE before merging.
 */
export const PROTOCOL_VERSION = 1;

/** Every client->server packet carries this. */
export interface ProtocolEnvelope {
  readonly protocolVersion: number;
  readonly type: string;
  readonly payload: unknown;
}

/**
 * Server-authoritative block edit. The server validates bounds, block
 * legality and rate; the client never gets to decide.
 */
export interface BlockEditPayload {
  readonly cx: number;
  readonly cz: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: BlockId;
}
