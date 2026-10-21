# BlockForge — PROGRESS

> **This file is the handoff state, not a diary.** Update it after every
> single cycle. The next agent reads this and nothing else to find out where
> the project is.

**Project:** BlockForge — an original, unofficial Minecraft-inspired voxel sandbox.
**Current milestone:** M1 — ENGINE
**Last updated:** 2026-10-21 (M1 ENGINE cycle 1 — engine landed)
**Status:** **ENGINE LANDED.** The whole M1 engine is committed on
`feature/engine/m1`: PRNG, noise, world generation, greedy mesher, physics,
raycast, chunk store and worker pool. G3 (3.96 ms/chunk avg) and G6
(identical hashes across fresh processes) both PASS. The TEST AUTHOR's
suite (52528ad) is merged and passes 97/97. G1 is NOT closed: coverage is
40.17% because the engine's new code has no tests against it yet — that is
the TEST AUTHOR's remaining work, and the gate is correctly armed.

---

## 1. What landed

| Item | Where | Notes |
|---|---|---|
| Frozen core contract | `src/core/types.ts` | All 10 required types: `BlockId`, `Chunk`, `WorldSnapshot`, `ChunkKey`, `SeededRng`, `MeshOutput`, `PlayerState`, `Inventory`, `Recipe`, `ItemStack`. Plus `PROTOCOL_VERSION`, `BlockEditPayload`, `ProtocolEnvelope`. |
| Frozen geometry constants | `src/core/constants.ts` | Chunk 16×256×16, 16 sections of 16, **y-major** `blockIndex()`, chunk key helpers, `SAVE_SCHEMA_VERSION`. |
| Core barrel | `src/core/index.ts` | Agents import from here, not from individual files. |
| Architecture contract | `docs/ARCHITECTURE.md` | Layer rules, purity rules, module ownership, **reserved original names** (incl. M4's logic system → **Conduit**). |
| Core API reference | `docs/API.md` | Every exported name, signature and convention. |
| Toolchain | `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js` | All versions pinned exactly. No `^`. |
| Layout | `src/{core,engine,render,gameplay,net}`, `server/`, `scripts/bench/`, `docs/` | Matches the repository contract exactly. |
| Repo | `~/workspace/blockforge` (Linux host) | Git initialised, branch `main`. |
| **Seeded PRNG** | `src/core/rng.ts` | `SeededRngImpl` — own splitmix32, no library. `fork()` is PURE (does not advance the parent), so subsystems fork in any order and still match. 32-bit state round-trips exactly through the frozen `RngState` (a `number`). |
| **Value noise** | `src/core/noise.ts` | Hash-based 2D/3D value noise + fBm. A sample is a function of `(seed, x, y, z)` alone, so terrain is continuous across chunk borders. |
| **World generation** | `src/core/world.ts` | Block metadata (ordinals, face rules), chunk storage helpers, terrain generator, `World` class. A chunk is a pure function of `(seed, chunkKey)`. |
| **Greedy mesher** | `src/core/meshing.ts` | `meshSection(chunk, section, neighbours?)` and `meshChunk(chunk, neighbours?)`. Stable vertex order; `blocks.length === indices.length / 3`. |
| **Physics** | `src/core/physics.ts` | AABB collision + gravity, axis-resolved, snapping to the surface it hit. Pure. |
| **Raycast** | `src/core/raycast.ts` | DDA (Amanatides & Woo). Returns the hit block, the face normal, and the placement cell. Pure. |
| **Chunk store** | `src/engine/chunkStore.ts` | Generation on demand, world-space block read/write, neighbour lookup for the mesher. Implements `SolidWorld` and `RaycastWorld`. |
| **Worker pool** | `src/engine/workerPool.ts` | Chunk generation off the main thread. Injectable worker factory: real Web Workers in the browser, a plain function in Node. |
| **Gate scripts** | `scripts/{determinism,bench,selfcheck}/` | G3 bench, G6 determinism proof, and the mesher/physics self-checks. All TypeScript, so they are typechecked and linted. |

**Not yet done (do not assume otherwise):** the engine's new code has **no
tests against it** — the TEST AUTHOR's suite only covers the frozen contract
and the dormant specs. G1 is therefore **NOT** closed: coverage is 40.17%
against an 85% floor. There is still no renderer, no CI, no README, no
GitHub repo. The public repo is created only after M1 and M2 gates pass.

### 1a. ENGINE contracts the downstream agents can rely on

These are the conventions the engine guarantees. They are stated so the
TEST AUTHOR can pin them and the RENDERER can consume them without guessing.

**Mesher output** (`src/core/meshing.ts`):
- `positions` are local to what was meshed — x and z run 0..16; y runs
  0..**16 for a section** and 0..**256 for a whole chunk**. A section mesh
  is placed at `section * SECTION_HEIGHT` by the renderer.
- `normals` are unit axis vectors, one per vertex. The winding always
  agrees with the normal (front-facing), verified by the self-check.
- `uvs` run 0..width and 0..height in **block units** — a merged 4×3 quad
  gets a 4×3 texture. **The renderer must wrap textures.**
- `blocks` hold the **ordinal** of the face's `BlockId` (the same ordinal
  the chunk storage uses), one entry per triangle, parallel to `indices`.
- A missing neighbour chunk is treated as air, so a chunk at the edge of a
  generated region still meshes.

**World** (`src/core/world.ts`): `World.getChunk(key)` generates on demand
and caches; `World.hash()` mixes the **seed** in first, so two worlds with
different seeds can never hash the same, even when empty.

**Physics** (`src/core/physics.ts`): a blocked axis **snaps** to the surface
it hit — a body resting on a block has its feet exactly on the block's top
face (y = 1 for a block at y = 0), and a body sliding into a wall stops
flush against it.

**Chunk store** (`src/engine/chunkStore.ts`): `getBlockAt` / `setBlockAt` /
`isSolid` are world-space; `meshChunk(key)` and `meshSection(key, section)`
take the neighbours from the store automatically.

**Flat file layout, deliberately.** `src/core/*.ts` is flat (rng, noise,
world, meshing, physics, raycast) rather than a directory of sub-barrels,
because the TEST AUTHOR's purity suite scans the **top-level** files of
`src/core` — a nested module would silently escape it.

## 1b. Repository topology (read this before touching anything)

The **canonical repo is on the Linux host**: `~/workspace/blockforge`, branch
`main`. It is the git "origin" for everyone.

**Linux cannot reach Windows** — Windows has no `sshd` installed — so the
Windows box can clone *from* Linux but never the reverse. Any agent working on
Windows must clone **from** Linux:

```sh
git clone hermes:~/workspace/blockforge
```

A clone already exists at `C:\Users\JOEL\workspace\blockforge` with
`origin = hermes:~/workspace/blockforge` (fetch and push both work).

### Per-agent git worktrees (Linux host)

All created from `main` @ `9080292`:

| Agent | Worktree | Branch |
|---|---|---|
| ENGINE | `~/workspace/worktrees/bf-engine` | `feature/engine/m1` |
| TEST AUTHOR | `~/workspace/worktrees/bf-test-author` | `feature/test-author/m1` |
| RENDER/UI | `~/workspace/worktrees/bf-render` | `feature/render/m1` |
| RELEASE | `~/workspace/worktrees/bf-release` | `feature/release/m1` |
| RED-TEAM | `~/workspace/worktrees/bf-redteam` | `feature/redteam/m1` |

### M1 board breakdown

| Task | Role | Owner |
|---|---|---|
| T26 | ENGINE — core RNG, terrain, greedy mesher, physics, raycast | hermes-linux |
| T27 | TEST AUTHOR — determinism, purity and property suite (`tests/`) | antigravity |
| T28 | RENDER/UI — camera, break/place wiring, procedural textures | hermes-win |
| T29 | RELEASE — CI workflow and README with the disclaimer | hermes-win |
| T30 | RED-TEAM — attack the core | opencode |

Board commands (Linux host):

```sh
python3 ~/workspace/agent-queue/board.py status
python3 ~/workspace/agent-queue/board.py claim-next --owner <you>
python3 ~/workspace/agent-queue/board.py update <T-id> --owner <you> --status done --notes "..."
```

> **Quoting warning:** board notes go through `bash` when passed as shell
> arguments. Backticks and `$` inside a note are interpreted as command
> substitution and will corrupt the note. Write board operations as a small
> Python script that calls `board.py` with an **argv array** instead of
> building a shell string.

## 2. Toolchain (discovered, verified — do not rediscover)

| Tool | Version | Location |
|---|---|---|
| Node | **v24.22.0** | `~/.local/opt/node/bin/node` (Linux host); PATH exported in `~/.bashrc` |
| npm | **11.19.1** | same prefix |
| git | 2.47.3 | Linux host |
| TypeScript | **5.9.3** | pinned in `package.json` |
| Three.js | 0.186.1 | pinned |
| Vite | 8.3.5 | pinned |
| Vitest | 5.0.5 | pinned |
| fast-check | 4.10.2 | pinned |
| @playwright/test | 1.64.1 | pinned |
| ws | 8.22.0 | pinned |
| ESLint | 10.13.0 | pinned |

**The Linux host is the canonical build box.** It has git but had no Node —
Node v24.22.0 was installed to `~/.local/opt/node` (no sudo needed) and
`~/.bashrc` now exports:

```sh
export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH"
```

Non-interactive shells do not read `~/.bashrc`; export the PATH yourself or
use `bash -lc`.

### Two dependency decisions worth remembering

1. **TypeScript is 5.9.3, not 7.x.** `typescript-eslint@8.72.0` declares
   `peerDependencies.typescript: ">=4.8.4 <6.1.0"`, so TypeScript 7.0.2
   (the current `latest`) is **incompatible** with the linter and no
   `typescript-eslint` release supports it yet. Pinning TS 7 would break gate
   G5 (`npm run lint`).
2. **`coverage.all` does not exist in Vitest 5.** It was removed; `include`
   now also pulls in untested files. `vitest.config.ts` uses
   `include: ["src/core/**/*.ts"]` with no `all` key. Adding `all: true`
   back breaks `npm run typecheck`.

## 3. Verified state of the gates (read back, not assumed)

Run on the Linux host after `npm install` (156 packages, 0 vulnerabilities):

| Command | Result |
|---|---|
| `npm run typecheck` | **exit 0** — `tsc --noEmit` clean under `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| `npm run lint` | **exit 0** — ESLint 10 flat config, 0 errors 0 warnings |
| `npm audit` | **exit 0** — `found 0 vulnerabilities` |
| `npm run coverage` | **exit 1** — *correct*: no tests exist yet (TEST AUTHOR owns `tests/`). The 85% thresholds are enforced and the run fails below them, which is exactly what gate G1 requires. |

`npm install` was run with `--no-audit --no-fund`; `npm audit` was then run
separately and is clean.

### Playwright (gate G2) — runs on the Windows host

**The Linux host cannot run Playwright.** It has no Chromium and none of its
runtime libraries (`libnss3`, `libatk`, `libgbm`, `libasound`, `libxkbcommon`,
`libpango`, `libcairo`), and **no sudo**, so `npx playwright install --with-deps`
cannot work there. It does have a working docker daemon and the user is in the
`docker` group, so the official Playwright container is a viable alternative.

**The Windows host works, and is verified.** Playwright 1.64.1 with
`chromium-1248` and `chromium_headless_shell-1248` installed under
`%LOCALAPPDATA%\ms-playwright`. Verified by launching it: Chromium
**156.0.8078.4** starts headless, a page loads, and the console stream is
observable (0 messages on a clean page) — which is exactly what gate G2 asserts
on.

```sh
cd C:\Users\JOEL\workspace\blockforge
npm ci
npx playwright install chromium
```

**Watch out:** running `npx playwright install chromium` *outside* the repo
installs whatever build the global `playwright` wants (build 1208), not the one
the pinned `@playwright/test@1.64.1` expects (build 1248) — the launch then
fails with "Executable doesn't exist". Always run it from inside the repo.

RELEASE (T29) owns the final decision on where CI runs the smoke test.

## 3b. ENGINE gate results (M1 cycle 1 — read this, do not re-measure blind)

Measured on the Linux host from the committed tree at `0276bad`.

| Gate | Result | Evidence |
|---|---|---|
| **G3** — chunk generation + meshing | **PASS** | avg **3.958 ms/chunk**, p95 **4.175 ms** (budget: avg < 16 ms). Generation avg 1.176 ms, meshing avg 2.782 ms. `node node_modules/.cache/blockforge-scripts/scripts/bench/chunkBench.js` |
| **G6** — cross-process determinism | **PASS** | 5 seeds × 2 **fresh processes**, all identical: seed 0 `d6e4cc59`, seed 1 `bd3879a7`, seed 12345 `57b308bb`, seed 2147483647 `66e09129`, seed -1 `4df02b13`. `node node_modules/.cache/blockforge-scripts/scripts/determinism/check.js` |
| **G5** — typecheck / lint | **PASS** | `npm run typecheck` exit 0, `npm run lint` exit 0 (0 errors, 0 warnings), both re-read after the last commit. |
| **G1** — coverage floor | **NOT CLOSED** | `npm run coverage` exit 1 at 40.17% lines / 39.55% statements / 35.63% functions / 26.27% branches, against the 85% floor. The TEST AUTHOR's suite (52528ad) covers the frozen contract and the dormant specs; it does not exercise the engine's new code. **This is the gate working, not a regression — do not lower the floor.** |
| **Purity** — `src/core` static scan | **PASS** | 0 violations across all 9 top-level core files, using the TEST AUTHOR's own patterns and comment-stripping: no `Math.random`, `Date.now`, `performance.now`, no DOM/`localStorage`/`indexedDB`, no network calls, no Three.js, no cross-layer imports. |

**G6 both hashes, as required by the brief** (each seed run twice, in two
separate processes, compared):

```
seed 0           d6e4cc59 == d6e4cc59 MATCH
seed 1           bd3879a7 == bd3879a7 MATCH
seed 12345       57b308bb == 57b308bb MATCH
seed 2147483647  66e09129 == 66e09129 MATCH
seed -1          4df02b13 == 4df02b13 MATCH
G6 PASS: 5 seeds, identical hashes across fresh processes
```

### How to run the gate scripts

The scripts are TypeScript, so they are typechecked and linted like the rest
of the code. Build them once, then run:

```sh
export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH"
cd ~/workspace/worktrees/bf-engine
npx tsc -p scripts/tsconfig.build.json
B=node_modules/.cache/blockforge-scripts
node $B/scripts/bench/chunkBench.js        # G3
node $B/scripts/determinism/check.js       # G6
node $B/scripts/selfcheck/meshCheck.js    # mesher invariants
node $B/scripts/selfcheck/engineCheck.js  # physics + raycast invariants
```

`scripts/tsconfig.build.json` emits to `node_modules/.cache/blockforge-scripts`,
which is already gitignored — nothing in the repo is polluted by a build.

### ENGINE commits (branch `feature/engine/m1`)

| SHA | What |
|---|---|
| `1056b3a` | `feat(core)`: seeded PRNG, value noise, chunked world generation |
| `c035e87` | `feat(core)`: greedy mesher with a stable, comparable vertex order |
| `52e6891` | `feat(core)`: AABB physics with gravity, and DDA raycasting |
| `d2bb059` | `feat(engine)`: chunk store and worker orchestration |
| `0276bad` | `feat(core)`: barrel exports + the gate scripts |

The TEST AUTHOR's suite (`52528ad`) is merged into this branch, so the
engine is verified against a real suite rather than an empty core.

### A defect found and fixed from the render side

The RENDER agent found that `hash()` was **vacuous on an empty store** — it
walked only the loaded chunks, so every seed produced the same constant
`811c9dc5` (the FNV-1a offset basis). It also never mixed the **seed** in
at all, so two worlds could in principle collide. Fixed in both
`World.hash()` and `ChunkStore.hash()`: the seed is mixed in first, as four
little-endian bytes. `scripts/selfcheck/engineCheck.ts` now pins this — an
empty world still hashes differently per seed, the same seed and chunks hash
the same, and loading a chunk changes the hash.

## 4. Milo butler discovery (do not rediscover)

The brief required discovering the Milo interface exactly rather than
guessing. All four prescribed locations were checked:

| # | Location checked | Result |
|---|---|---|
| 1 | `Get-Command milo` (Windows) | **not found on PATH** |
| 2 | `milo --help` | **not invocable** — "The term 'milo' is not recognized" |
| 3 | `~/.config/opencode/opencode.jsonc` (MCP config) | contains only `$schema` — **no MCP servers configured**; `list_mcp_resources` returns `{"resources":[],"templates":[]}` |
| 4 | `herdr integration status` | **no `milo` / butler integration entry** |

**However, a working Milo butler endpoint exists** and was verified live:

```sh
~/.hermes/scripts/discord_bot/.venv/bin/python ~/workspace/agent-queue/butler.py post '<text>'
```

- `butler.py --help` → "Milo the Butler Discord helper", subcommands
  `post | read | watch | channels`
- `butler.py channels` → live, returns the guild's channel list
- It posts as the **MILO bot** to the "Milo the Butler" Discord server
- Use the **venv interpreter**; plain `python3` fails with `ModuleNotFoundError: audioop`
  (discord.py imports `audioop`, removed in Python 3.13+)

This is the interface to use for the victory log. There is **no `milo` CLI and
no Milo MCP tool** — if a future agent finds neither, they must set
`milo: PENDING — <reason>` on the entry rather than inventing a command.

## 5. Ownership map

| Agent | Owns |
|---|---|
| ENGINE | `src/core/world`, `src/core/meshing`, `src/core/physics`, `src/engine/` |
| GAMEPLAY | `src/core/crafting`, `src/gameplay/` |
| RENDER/UI | `src/render/` |
| NETCODE | `server/`, `src/net/` |
| TEST AUTHOR | `tests/` — **exclusively** |
| RED-TEAM | `tests/redteam/` (finding commits) |
| RELEASE | `.github/`, `README.md`, the only push to `main` |
| ARCHITECT | `src/core/types.ts`, `src/core/constants.ts`, `src/core/index.ts`, `docs/ARCHITECTURE.md`, `docs/API.md` |

**Builders must not create, edit or delete anything under `tests/`.**

## 6. Blockers

None open. See `docs/BLOCKERS.md`.

## 7. Next actions

Full detail for every task is on the board. Summary:

1. **T27 TEST AUTHOR (antigravity)** — **G1's remaining work, and the
   critical path now.** The engine's code exists, so the coverage denominator
   is real: 40.17% lines against the 85% floor. The files needing tests, in
   priority order: `src/core/raycast.ts` (0%), `src/core/noise.ts` (1.8%),
   `src/core/world.ts` (17.9%), `src/core/physics.ts` (5.7%),
   `src/core/meshing.ts` (86.1%, gaps at 184/189-190/427-442),
   `src/core/rng.ts` (82.9%, gaps at 82/87/92/120-122). The behaviour
   contracts to pin are in **§1a** above. The suite's dormant rng and mesher
   specs now **arm against the real code** and pass. **Do not lower the
   floor** — the gate is correctly armed.
2. **T26 ENGINE (hermes-linux)** — **DONE for M1.** The whole engine is
   landed and committed on `feature/engine/m1` (see §3b for the SHAs and the
   measured gates). Nothing in the frozen contract was renamed. The engine's
   API for the renderer is in §1a.
3. **T28 RENDER/UI (hermes-win)** — first-person camera and block
   break/place wiring; textures generated procedurally with canvas 2D (no
   committed art assets). **MERGE ORDER: ENGINE FIRST** — the render branch
   imports `ChunkStore` from `../engine/index.js` and does not build without
   `src/engine/` and `src/core/world.ts` present.
4. **T29 RELEASE (hermes-win)** — set up `.github/workflows/ci.yml` (the repo
   has no CI yet, so G5's "CI green" is not yet satisfiable) and the README
   with the required disclaimer:

   > BlockForge is an original, unofficial Minecraft-inspired voxel sandbox.
   > Not affiliated with, endorsed by, or sponsored by Mojang or Microsoft.
   > Minecraft is a trademark of Mojang AB / Microsoft.

5. **T30 RED-TEAM (opencode)** — attack the core once ENGINE has landed:
   pathological seeds, property-test violations, non-determinism. A red-team
   test that fails is a success, not a bug in their work.
6. **NETCODE** — no M1 work; the wire protocol is frozen at
   `PROTOCOL_VERSION = 1` but multiplayer is an M4 gate.

## 8. Coordination

- Board: `~/workspace/agent-queue` on the Linux host, via
  `python3 ~/workspace/agent-queue/board.py <cmd>`.
- Owners: `hermes-win`, `hermes-linux`, `antigravity`, `opencode`.
- Peers: `herdr agent prompt <pane> "<msg>"` to another pane's agent;
  `herdr pane send-text <pane> "<msg>"` for the remote Hermes TUI in `w1:p1`
  (agent prompt does not work there).
- `herdr agent prompt` has **no `--file`/stdin flag**: multi-line messages
  must be shell-quoted carefully — backticks and `$` are interpreted by bash.
  Write the message to a file and send with a Node `spawn` using an argv
  array, or use `$(cat file)`.


## 9. Test Author Handoff (M1 Slice 1)

- **Agent:** TEST AUTHOR (`antigravity`, pane `w1:p4`)
- **Task:** T27 — M1/TEST-AUTHOR
- **Files Created:**
  - `tests/purity.test.ts`: Static analysis enforcing zero `Math.random`, `Date.now`, `performance.now`, DOM/browser globals, network requests, Three.js imports, or cross-layer imports inside `src/core/`.
  - `tests/constants.test.ts`: Property-based (`fast-check`) verification of bijection over `(16, 256, 16)`, y-major indexing, `RangeError` bounds enforcement, and `chunkKeyToString` / `chunkKeyFromString` round-tripping.
  - `tests/types.test.ts`: Frozen `BlockId` validity, `ALL_BLOCK_IDS` completeness, `SOLID_BLOCKS` / `TRANSPARENT_BLOCKS` sets, and strict originality checks ensuring no prohibited Mojang block identifiers.
  - `tests/determinism.test.ts`: Cross-process byte-identical chunk hash equivalence across independent Node processes with matching seeds, and order-invariant block array population.
  - `tests/contract.test.ts`: Surface validation of `src/core/index.ts` re-exports against `docs/API.md`.
  - `tests/rng.test.ts`: Behavioral and property specification for `SeededRng` (`src/core/rng.ts`).
  - `tests/meshing_spec.test.ts`: Behavioral and property specification for Greedy Meshing (`MeshOutput` structure, zero air faces, section boundary bounds, deterministic output).
- **Verification:**
  - `npm test`: 7/7 test suites passing (46/46 tests green).
  - `npm run coverage`: 100% statements, 100% branches, 100% functions, 100% lines on `src/core/` (satisfies G1 >= 85% requirement).
  - `npm run lint`: 0 errors / 0 warnings.
  - `npm run typecheck`: clean (`tsc --noEmit` exit 0).
- **Handoff Target:** `ENGINE` (`hermes-linux` on T26) — build `src/core/rng.ts` and the chunk generator / greedy mesher against these test specs.
