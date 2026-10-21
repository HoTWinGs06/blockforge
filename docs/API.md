# BlockForge — Core API

> Owner: ARCHITECT. Documents the frozen public surface of `src/core/`.
> The names below are frozen as of M1.

Import from the barrel, not from individual files:

```ts
import { BlockId, CHUNK_SIZE_X, blockIndex, type Chunk } from "../src/core/index.js";
```

## Types

### `BlockId`
String enum of block kinds. See `docs/ARCHITECTURE.md` §6 for the full
original-name table. Helpers exported alongside it:

| Export | Type | Meaning |
|---|---|---|
| `ALL_BLOCK_IDS` | `readonly BlockId[]` | every value, declaration order |
| `SOLID_BLOCKS` | `ReadonlySet<BlockId>` | blocks that collide |
| `TRANSPARENT_BLOCKS` | `ReadonlySet<BlockId>` | blocks light passes through |

### `ChunkKey`
```ts
interface ChunkKey { readonly cx: number; readonly cz: number }
```
Signed coordinates. Negative values are legal.

### `Chunk`
```ts
interface Chunk { readonly key: ChunkKey; readonly blocks: Uint8Array }
```
`blocks.length === CHUNK_VOLUME` (65536). Indexed by `blockIndex(x, y, z)`.

### `ChunkSnapshot` / `WorldSnapshot`
```ts
interface ChunkSnapshot { readonly key: ChunkKey; readonly blocks: Uint8Array }
interface WorldSnapshot {
  readonly schemaVersion: number;
  readonly seed: number;
  readonly chunks: readonly ChunkSnapshot[];
}
```
`WorldSnapshot` is the shape the M2 save file writes and the M4 server
serialises. `schemaVersion` carries `SAVE_SCHEMA_VERSION` (currently `1`).

### `SeededRng`
```ts
interface RngState { readonly seed: number; readonly state: number }
interface SeededRng {
  nextUint32(): number;
  nextFloat(): number;
  nextInt(minInclusive: number, maxExclusive: number): number;
  fork(label: string): SeededRng;
  getState(): RngState;
  setState(state: RngState): void;
}
```
The project's only source of randomness. Own implementation, no library.
`fork` derives a deterministic child stream from a label.

### `MeshOutput`
```ts
interface MeshOutput {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly blocks: Uint8Array;
}
```
Per-vertex arrays for `positions`/`normals`/`uvs`; `indices` holds 3 per
triangle; `blocks` holds **one entry per triangle, parallel to `indices`**,
carrying that face's `BlockId`. Vertex order is stable — the determinism
suite compares these arrays byte-for-byte.

### `PlayerState`
```ts
interface PlayerState {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly onGround: boolean;
  readonly health: number;
  readonly hunger: number;
}
```
`health` and `hunger` are declared in M1 so that adding them in M3 is not a
breaking change to a frozen type.

### `ItemStack` / `Inventory`
```ts
interface ItemStack { readonly id: string; readonly count: number; readonly durability?: number }
interface Inventory { readonly slots: readonly ItemStack[]; readonly selected: number }
```
`selected` is the active hotbar index.

### `Recipe`
```ts
interface Recipe {
  readonly id: string;
  readonly kind: "shaped" | "shapeless";
  readonly ingredients: readonly string[];
  readonly shape?: readonly (readonly string[])[];
  readonly result: ItemStack;
}
```
`shape` is present for shaped recipes (rows of ingredient tags, row-major)
and absent for shapeless ones.

### Geometry helpers
```ts
interface Vec3 { readonly x: number; readonly y: number; readonly z: number }
interface Aabb {
  readonly minX: number; readonly minY: number; readonly minZ: number;
  readonly maxX: number; readonly maxY: number; readonly maxZ: number;
}
```

### Network protocol
```ts
const PROTOCOL_VERSION = 1;
interface ProtocolEnvelope { readonly protocolVersion: number; readonly type: string; readonly payload: unknown }
interface BlockEditPayload { readonly cx: number; readonly cz: number; readonly x: number; readonly y: number; readonly z: number; readonly block: BlockId }
```
The server rejects any packet whose `protocolVersion` does not match.

## Constants and functions

| Export | Value / signature | Notes |
|---|---|---|
| `CHUNK_SIZE_X` | `16` | |
| `CHUNK_SIZE_Y` | `256` | full world height |
| `CHUNK_SIZE_Z` | `16` | |
| `SECTION_HEIGHT` | `16` | one meshing section |
| `SECTIONS_PER_CHUNK` | `16` | |
| `CHUNK_VOLUME` | `65536` | `16 * 256 * 16` |
| `WORLD_MIN_Y` | `0` | inclusive |
| `WORLD_MAX_Y` | `256` | exclusive |
| `SAVE_SCHEMA_VERSION` | `1` | bump on breaking save-format change |
| `PROTOCOL_VERSION` | `1` | bump only on a breaking wire change |
| `blockIndex(x, y, z)` | `number` | y-major storage index; **throws** `RangeError` out of range |
| `chunkKeyToString(key)` | `string` | `"cx,cz"` |
| `chunkKeyFromString(text)` | `ChunkKey` | throws `Error` on malformed input |

## Purity rules for `src/core/`

`src/core/` must be plain TypeScript with zero side effects and zero I/O. It
may not use `Math.random`, `Date.now`, `performance.now`, DOM APIs,
`localStorage`/`IndexedDB`, network calls, or import Three.js. It must import
and run in Node under Vitest with no GPU, no browser and no canvas.

Import only from `src/core/index.js` (or another file inside `src/core/`).
