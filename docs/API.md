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

## Second extension: the operator feature list

Added in the same commit as the feature list (see `docs/ARCHITECTURE.md` §7).

### Break times

```ts
const BREAK_TIME_SECONDS: Readonly<Record<string, number>>; // 23 distinct values
function breakSeconds(id: string): number;                    // unknown -> 9.0
```

`0.1` foliage · `0.12` emberlamp · `0.2` crystpane · `0.25` tidewater · `0.3` emberflow ·
`0.35` sand · `0.4` gravel · `0.45` clay · `0.55` regolith · `0.6` loam · `0.7` millplank ·
`0.9` timber · `1.1` masonry · `1.3` rubble · `1.7` slate · `2.2` smeltforge · `2.5` craftbench ·
`3.2` anthracite · `4.0` ironveil · `5.0` gildenseam · `6.5` lumencrystal · `9.0` voidstone.

### Time and seasons

```ts
const TICKS_PER_DAY = 14400;      // a day is 12 minutes at 20 ticks/s
const TICKS_PER_SEASON = 57600;   // a year is four seasons
const SEASONS: readonly Season[]; // thaw, green, harvest, frost
const DAY_PHASES: readonly DayPhase[]; // dawn, day, dusk, night

function seasonAt(tick: number): Season;
function dayPhaseAt(tick: number): DayPhase;
```

Both are pure functions of the tick. **Never derive time from the wall clock** — the
purity scanner will reject `Date.now()` in `src/core/`, and it is right to.

`World` gained `tick: number` and `advanceTicks(ticks: number): void`. `World.snapshot()`
records `season` and `tick`; `World.fromSnapshot()` restores the tick, so a saved world
keeps its season and its time of day.

### Mobs

```ts
type MobKind = "grazer" | "flutter" | "shellback" | "lurker" | "snarler";
type MobStateKind = "idle" | "wander" | "graze" | "flee" | "chase" | "attack" | "dead";

interface MobState {
  readonly id: number;
  readonly kind: MobKind;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly yaw: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly state: MobStateKind;
  readonly home: ChunkKey;
  readonly aiTimer: number;
  readonly age: number;
  readonly onGround: boolean;
  readonly deathTimer: number;
}
```

Mob AI must be a pure function of `(world state, tick)`: no clock reads, and no decision
may depend on the order in which mobs happen to be updated.

### Items

```ts
type ItemId = string;   // block items use the block's name
```
