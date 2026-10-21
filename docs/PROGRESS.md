# BlockForge — PROGRESS

> **This file is the handoff state, not a diary.** Update it after every
> single cycle. The next agent reads this and nothing else to find out where
> the project is.

**Project:** BlockForge — an original, unofficial Minecraft-inspired voxel sandbox.
**Current milestone:** M1 — ENGINE
**Last updated:** 2026-10-21 (M1 kickoff cycle)
**Status:** M1 kickoff complete. Contract frozen, repo scaffolded, toolchain green.

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

**Not yet done (do not assume otherwise):** no engine code, no renderer, no
tests, no CI, no README, no GitHub repo. The public repo is created only
after M1 and M2 gates pass.

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

1. **TEST AUTHOR** — write the determinism/purity suite first: `src/core` must
   contain no `Math.random`/`Date.now`/`performance.now`, no DOM access, no
   `localStorage`/`IndexedDB`, no network calls, no Three.js import; and must
   not import from `src/engine`, `src/render`, `src/net`, `src/gameplay` or
   `server/`. This is the load-bearing property of the whole project.
2. **ENGINE** — implement `SeededRng` in `src/core/rng.ts` (own
   implementation, no library), then terrain generation, greedy meshing,
   physics and raycasting against the frozen contract. Nothing in the
   contract may be renamed.
3. **RENDER/UI** — first-person camera and block break/place wiring; textures
   generated procedurally with canvas 2D (no committed art assets).
4. **RELEASE** — set up `.github/workflows/ci.yml` (the repo has no CI yet, so
   G5's "CI green" is not yet satisfiable) and the README with the required
   disclaimer:

   > BlockForge is an original, unofficial Minecraft-inspired voxel sandbox.
   > Not affiliated with, endorsed by, or sponsored by Mojang or Microsoft.
   > Minecraft is a trademark of Mojang AB / Microsoft.

5. **RED-TEAM** — attack the core once ENGINE has landed: pathological
   seeds, property-test violations, non-determinism.
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
