# BlockForge — Architecture

> Owner: ARCHITECT (opencode). Frozen for M1. Changes require an ADR in this
> file plus a note on the board.

## 1. Layer contract

BlockForge is a strict layering. Dependencies point **downward only**.

```
        src/render/   src/gameplay/   src/net/        server/
              \             |            |              /
               \            |            |             /
                +------- src/engine/ ----------------+
                          |            |
                          +---- src/core/ ---------+
```

| Layer | May import | Must NOT import |
|---|---|---|
| `src/core/` | nothing (leaf) | three, DOM, `src/engine`, `src/render`, `src/net`, `src/gameplay`, `server/` |
| `src/engine/` | `src/core/` | `src/render`, `src/gameplay`, `src/net`, `server/` |
| `src/render/` | `src/core/`, `src/engine/` | `src/gameplay`, `src/net`, `server/` |
| `src/gameplay/` | `src/core/`, `src/engine/` | `src/render`, `src/net`, `server/` |
| `src/net/` | `src/core/`, `src/engine/` | `server/` |
| `server/` | `src/core/` | `src/render`, `src/engine`, `src/gameplay` |

`src/core/` is additionally constrained to be **pure**: no `Math.random`, no
`Date.now`, no `performance.now`, no DOM access, no `localStorage`/
`IndexedDB`, no network calls, no Three.js. It must import and run in Node
under Vitest with no GPU, no browser and no canvas. The RED-TEAM agent owns
the static checks that enforce this.

**Determinism invariant (the project's single most important property):**
world generation, meshing, physics and crafting are pure functions of
`(seed, state)`. The same seed and the same inputs produce a **byte-identical**
world — in any order, in any process. Gate G6 verifies this across two fresh
processes.

## 2. Frozen core contract (`src/core/types.ts`)

Defined in M1 and **not renamed afterwards**. Agents build against these
names:

`BlockId` · `Chunk` · `WorldSnapshot` · `ChunkKey` · `SeededRng` ·
`MeshOutput` · `PlayerState` · `Inventory` · `Recipe` · `ItemStack`

Supporting frozen values in `src/core/constants.ts`:

`CHUNK_SIZE_X` (16) · `CHUNK_SIZE_Y` (256) · `CHUNK_SIZE_Z` (16) ·
`SECTION_HEIGHT` (16) · `SECTIONS_PER_CHUNK` (16) · `CHUNK_VOLUME` (65536) ·
`blockIndex()` · `chunkKeyToString()` · `chunkKeyFromString()` ·
`SAVE_SCHEMA_VERSION` · `PROTOCOL_VERSION` (1)

### Chunk storage order (frozen)

A chunk is 16 × 256 × 16, split into 16 sections of 16 blocks for meshing.
Blocks are stored **y-major**:

```
index = x + CHUNK_SIZE_X * (z + CHUNK_SIZE_Z * y)
```

This is part of the save format and of the byte-identical guarantee.
Changing it invalidates saved worlds and every recorded world hash.

### `MeshOutput` conventions

`positions` / `normals` / `uvs` are per-vertex `Float32Array`;
`indices` is a `Uint32Array` of 3 per triangle; `blocks` is a `Uint8Array`
with **one entry per triangle, parallel to `indices`**, holding the `BlockId`
of that face — so the renderer can select a texture without a reverse lookup.
Vertex order is stable: same chunk + same neighbours ⇒ byte-identical arrays.

## 3. Randomness

All randomness flows from one seeded PRNG (`SeededRng`, implemented in
`src/core/rng.ts`). It is our own implementation — no library. Independent
subsystems take deterministic child streams via `rng.fork(label)`, so terrain,
decoration and mob spawns never interfere with one another.

## 4. Module ownership

| Agent | Owns |
|---|---|
| ENGINE | `src/core/world`, `src/core/meshing`, `src/core/physics`, `src/engine/` |
| GAMEPLAY | `src/core/crafting`, `src/gameplay/` |
| RENDER/UI | `src/render/` |
| NETCODE | `server/`, `src/net/` |
| TEST AUTHOR | `tests/` (exclusively) |
| RED-TEAM | `tests/redteam/` (finding commits) |
| RELEASE | `.github/`, `README.md`, the only push to `main` |
| ARCHITECT | `src/core/types.ts`, `src/core/constants.ts`, `src/core/index.ts`, `docs/ARCHITECTURE.md`, `docs/API.md` |

**Builders must not create, edit or delete anything under `tests/`.** If a
builder needs a behaviour guaranteed, they describe it to the TEST AUTHOR on
the board and wait.

## 5. Branching and merging

- Only RELEASE pushes to `main`.
- Every other agent works on `feature/<agent>/<short-topic>` and opens a PR.
- A PR needs green CI **and** the TEST AUTHOR's tests for the touched area.
- Downstream agents start from a **merged SHA**, never from someone's
  uncommitted branch.
- `main` is the integration branch; merge order follows the dependency order
  in §1.

## 6. Reserved original names

The brief requires original naming for every concept. Reserved and decided
here so no agent reaches for a well-known name:

| Concept | BlockForge name |
|---|---|
| Logic/redstone-like system (M4) | **Conduit** (blocks: `conduit`, `conduit lamp`) |
| Cobblestone-like | `rubble` |
| Log | `timber` |
| Leaves | `foliage` |
| Bedrock-like | `voidstone` |
| Diamond ore | `lumencrystal` |
| Iron ore | `ironveil` |
| Gold ore | `gildenseam` |
| Coal | `anthracite` |
| Glass | `crystpane` |
| Bricks | `masonry` |
| Crafting table | `craftbench` |
| Furnace | `smeltforge` |
| Torch | `emberlamp` |
| Water | `tidewater` |
| Lava | `emberflow` |

**Forbidden everywhere:** any Mojang/Microsoft asset (texture, model, sound,
logo, font, music); decompiled or reverse-engineered Minecraft code; the word
"Minecraft" in the app title, package name, domain, repo name, class or
identifier names, or in-game text; anything implying affiliation with or
endorsement by Mojang/Microsoft.

The word "Minecraft" **may** appear in the README and docs, only in the
sentence "a Minecraft clone inspired by Minecraft" and in the disclaimer.
