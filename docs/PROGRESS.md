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

---

## 9. M1 RED-TEAM — cycle 1 handoff (RED-TEAM)

**Branch:** `feature/redteam/m1` · **Commit:** `807f3a83f6857e2cd2a03feae948d73bd2a937d5`
**Base:** main @ `9080292` · **Owns:** `tests/redteam/` only
**Board:** T30 (this task) · findings filed as **T40, T41, T42, T43** (owner: opencode)

### 9.1 What landed

| Item | Where | Notes |
|---|---|---|
| Static purity scanner for `src/core/` | `tests/redteam/lib/purity-scan.ts` | The static checks that `docs/ARCHITECTURE.md` §1 assigns to RED-TEAM. Lexes each file, blanks comments and string contents, then matches the banned constructs against the remaining **code** — so the frozen contract's own doc comment ("no Math.random, Date.now, performance.now") is not flagged. Catches `Math.random`, `Date.now`, `new Date`, `performance.now`, `crypto.getRandomValues`, DOM/storage globals, network APIs, `node:` builtins, `three`/`react`, and imports from `src/engine`, `src/render`, `src/net`, `src/gameplay`, `server/`. |
| Purity scanner meta-tests | `tests/redteam/purity.test.ts` | 15 positive controls (the scanner must CATCH each banned construct), 5 negative controls (it must NOT cry wolf), plus a scan of the real `src/core/`. |
| Cross-process determinism harness | `tests/redteam/lib/determinism-harness.ts` | Gate G6 needs **fresh processes**; a Vitest process is not one. Transpiles TS to a temp dir with the project's own pinned `typescript` 5.9.3 (Node 24 cannot resolve the core's `"./types.js"` specifiers to the `.ts` file behind them) and spawns real child processes. |
| Harness self-test | `tests/redteam/determinism-harness.test.ts` | Proves the harness **DETECTS** a non-deterministic generator (one that leaks `Date.now`) and reports identical hashes for a deterministic one. A determinism harness that cannot fail is decoration. |
| Contract guard attack | `tests/redteam/contract-guards.test.ts` | The architect's explicit ask: confirm no path bypasses `blockIndex`/`chunkKeyFromString`. |
| Findings F1–F4 | `tests/redteam/f1-…` … `f4-…` | Each with a `control:` test pinning current behaviour, so a green `it.fails` can never hide a dead assertion. |
| Finding index | `tests/redteam/findings.ts` | The list of open findings, their owners, board tasks and repros. |

### 9.2 Findings (the deliverable)

A red-team test that **fails** is the deliverable. Each finding is encoded with Vitest's
`it.fails`: while the bug exists the inner assertion fails and the **shared suite stays
green for every other agent**; the moment the owner fixes it, `it.fails` goes **red**
("expected to fail but passed") and announces the finding as closed. RED-TEAM then
converts it to a plain `it` in the closing commit. No finding is ever silently forgotten.

| # | Task | Owner | Severity | Finding |
|---|---|---|---|---|
| F1 | T40 | opencode | high | `SOLID_BLOCKS`/`TRANSPARENT_BLOCKS` are `Object.freeze`d **Sets**. `Object.freeze` does not freeze a Set's contents (`[[SetData]]` is not a property), so both are **mutable global state** in the layer that must be pure. `SOLID_BLOCKS.add("air")` succeeds and air becomes solid; `Object.isFrozen` still reports `true`. |
| F2 | T41 | opencode | high | `chunkKeyFromString` accepts malformed keys — the guard is `Number.isInteger(Number(part))` and `Number()` parses `""`→0, `" "`→0, `"0x10"`→16, `"1e3"`→1000, `"+5"`→5, `"0b101"`→5, `"1.0"`→1. `"1,"` and `"1,0"` address the **same chunk**, so it is not the inverse of `chunkKeyToString`. |
| F3 | T42 | opencode | medium | `Chunk.blocks` is a `Uint8Array` "indexed by BlockId ordinal", but no byte→BlockId mapping is exported and **233 of 256** byte values are invalid. Consumers must each invent a mapping; if two disagree by one position, every block in every saved world silently becomes a different block. |
| F4 | T43 | opencode | medium | `chunkKeyToString` emits strings its own inverse rejects: `{cx:1.5,cz:2}`→`"1.5,2"` and `chunkKeyFromString("1.5,2")` **throws** (same for `NaN`, `Infinity`). A key the engine can produce but the save file cannot read back is a silent data-loss path. |

**Hypotheses of cause** (may be wrong — said so): F1 and F2 both come from guarding with a
*type* (`ReadonlySet`) and a *convenient coercion* (`Number()`) instead of a runtime check.
F3 and F4 come from the storage format being specified in a comment rather than in an
exported, validated function.

**Verified negative result — `blockIndex` is CLEAN.** Every attack was tried (negatives,
out-of-range on each axis, fractional, `NaN`, `Infinity`, precision-losing `2**53`/`1e21`,
non-number types, `-0`): **0 bypasses**. It is also a proven **bijection** onto
`0..65535` over the full 16×256×16 space (0 collisions, 0 gaps), and it matches the frozen
y-major formula `x + 16*(z + 16*y)`. The storage-order contract is trustworthy.

### 9.3 Gates — read back, not assumed

| Command | Result |
|---|---|
| `npm run typecheck` | **exit 0** — `tsc --noEmit` clean (my test files are in the tsconfig scope) |
| `npm run lint` | **exit 0** — ESLint 10, 0 errors 0 warnings |
| `npm run test` | **exit 0** — 7 files, **75 passed / 25 expected fail** (100 total) |
| `npm run coverage` | **exit 0** — **100%** statements/branches/functions/lines on `src/core` (was 0% — my red-team suite now covers the whole frozen contract, which also unblocks G1's 85% floor) |

### 9.4 What this depends on, what it blocks

- **Depends on:** nothing. All of it runs against the frozen contract at `9080292` and needs
  no engine code. The engine has not landed any code yet (`feature/engine/m1` is still at
  `9080292`), so the engine-facing attacks (pathological seeds, RNG order-dependence,
  meshing edge cases, malformed packets) are **queued, not done**.
- **Blocks:** F1–F4 block a correct M2 save format and a correct M4 wire protocol, both of
  which key chunks by `chunkKeyToString` and carry `Chunk.blocks` bytes. F2 and F4 in
  particular are on the gate-G4 path ("the server must reject 100% of malformed input").
- **Does NOT block:** G5 or the build. The shared suite is green — my findings are encoded so
  they do not break anyone else's run.

### 9.5 Next (RED-TEAM)

1. **Poll the board** for ENGINE's first commit and attack the moment it lands: the seeded
   RNG (order-dependence, `fork` independence), pathological seeds (0, 1, 2³¹−1, 2³²−1),
   meshing edge cases (all-air, all-solid, world-border, negative coordinates) and the
   cross-process determinism of the real world generator via the harness in
   `tests/redteam/lib/determinism-harness.ts` — which is already built and proven.
2. **NETCODE** has no M1 work, so the malformed-packet attacks wait for M4. The board task
   says so; I will re-check the board each cycle.
3. Re-run F1–F4 after ARCHITECT fixes them, and log each closed finding in
   `docs/VICTORIES.md` with the closing SHA.

### 9.6 Notes for the next agent

- The scanner's `it.fails` idiom is the reason the shared suite stays green while four real
  bugs are open. Do not "fix" a red `it.fails` by weakening the assertion — that is the
  RED-TEAM's own version of cheating.
- `tests/redteam/lib/purity-scan.ts` is lexical, not an AST parse. A violation hidden behind
  computed member access (`Math["ra" + "ndom"]`) is not detected. Recorded as a known limit
  in the file header.
- Node 24 cannot `import` the core's TypeScript directly (its `"./types.js"` specifiers do
  not resolve to the `.ts` file behind them). The harness transpiles with the pinned
  `typescript` 5.9.3 instead — do not add a new dependency for this.
