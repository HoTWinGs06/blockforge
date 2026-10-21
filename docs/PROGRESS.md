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

## 1c. G1 status correction (read before reporting any gate)

**G1 is NOT passed.** The M1 kickoff cycle reported the coverage floor as
satisfied for the test-suite slice. The measurement was real but was taken
against a 49-statement denominator — `types.ts`, `constants.ts`, `index.ts` —
which contained **no executable code**. Re-measured on the real combination
(the test suite at `52528ad` plus the ENGINE agent's `src/core/rng.ts` and
`src/core/world/*.ts`), independently by hermes-linux:

| | |
|---|---|
| `npm test` | 58 / 58 pass |
| `npm run coverage` | **exit 1** |
| statements | 26.62 % (78/293) |
| branches | 20.56 % (22/107) |
| functions | 35 % (14/40) |
| lines | 27.59 % (77/279) |

**The gate is correctly armed.** It now fails because there is real code to
cover, and the 85 % floor is enforced in `vitest.config.ts` exactly as
intended. G1 closes when the ENGINE code has real tests against it — not
before, and not by lowering the floor.

What *is* proven: the threshold fails the build below 85 %, the test author's
46-test suite passes against the contract, and the contract itself now carries
41 purpose-built assertions (see the architect hardening branch below).

## 1d. The build fleet (expanded during kickoff)

The fleet is larger than the four herdr panes. On the Linux host there are
**seven headless Hermes build agents, one per role**, working in the
per-agent worktrees above:

| Role | Board owner | Worktree |
|---|---|---|
| ENGINE | `engine` | `~/workspace/worktrees/bf-engine` |
| GAMEPLAY | `gameplay` | `~/workspace/worktrees/bf-gameplay` |
| RENDER/UI | `renderui` | `~/workspace/worktrees/bf-render` |
| NETCODE | `netcode` | `~/workspace/worktrees/bf-netcode` |
| TEST AUTHOR | `testauthor` | `~/workspace/worktrees/bf-test-author` |
| RED-TEAM | `redteam` | `~/workspace/worktrees/bf-redteam` |
| RELEASE | `release` | `~/workspace/worktrees/bf-release` |

`board.py` `VALID_OWNERS` was **extended** to include these seven role owners
alongside the four coordination agents (`hermes-win`, `hermes-linux`,
`antigravity`, `opencode`) and `operator`. It was extended, **not weakened** —
an unknown owner is still rejected with exit 1.

### Two overlapping breakdowns, being reconciled

| Board task | Owner | Note |
|---|---|---|
| T26 ENGINE | `engine` | role agent now owns the implementation |
| T27 TEST AUTHOR | `antigravity` | 46-test contract suite landed @ `52528ad` |
| T28 RENDER/UI | `hermes-win` | slice 1 landed @ `956858d` |
| T29 RELEASE | `hermes-win` | CI + README landed @ `480a2f8` |
| T30 RED-TEAM | `redteam` / `opencode` | 11 findings filed (T40–T50) |
| T32 gameplay | `gameplay` | M3 work |
| T34/T39 netcode | `netcode` | M4 work |

T33 (renderui) and T37 (release) were dropped in favour of T28 and T29.

**Open gate-order flag:** M3/M4 work is running while M1 is not complete. The
brief says never start M(n+1) until every gate of M(n) passes. Raised for the
architect's decision — finish M1 first, or run ahead and hold the ordering at
merge time.

## 1e. GitHub access (discovered, verified — do not rediscover)

**Account:** `HoTWinGs06` (user type, not site_admin). Fine-grained token,
prefix `github_pat_`.

### The token lives in ONE place

```sh
# Linux host only
~/.hermes/.env        ->  GITHUB_TOKEN=<the fine-grained PAT>
```

It is **not** in `~/.config/gh/hosts.yml`, and the `gh` CLI does not read
`~/.hermes/.env` — you must export it yourself:

```sh
export GH_TOKEN=$(grep -m1 -oE '^GITHUB_TOKEN=.*' ~/.hermes/.env | cut -d= -f2- | tr -d '"')
gh auth status        # -> Logged in to github.com account HoTWinGs06 (GH_TOKEN)
```

### What works, and what does not — measured, not assumed

| Host | `gh` CLI | Git transport to GitHub | Notes |
|---|---|---|---|
| Linux build host | **yes**, 2.102.0 at `~/.local/bin/gh` | **HTTPS + token — verified** (`git ls-remote` exit 0) | SSH to GitHub is **not** authorised: the key is offered but never accepted |
| Windows (the PC) | **not installed** | **HTTPS + Git Credential Manager — verified** (stored credential, user `HoTWinGs06`) | `gh` absent; GCM 2.7.0 present; no GitHub SSH key either (`git@github.com` → permission denied) |

**Use HTTPS remotes everywhere.** SSH to GitHub fails from both hosts.

Linux push without ever writing the token to disk or into a URL:

```sh
git config --global credential.helper   '!f() { echo username=x-access-token; echo password=$(grep -m1 -oE "^GITHUB_TOKEN=.*" ~/.hermes/.env | cut -d= -f2- | tr -d """); }; f'
git remote add origin https://github.com/HoTWinGs06/blockforge.git
```

The Windows side needs nothing extra — GCM already holds the credential.

### gitleaks — now installed on both hosts

Required by the brief before any push, and a gate in the CI workflow.

| Host | Path | Version |
|---|---|---|
| Linux | `~/.local/bin/gitleaks` | 8.30.1 |
| Windows | `C:\Users\JOEL\AppData\Local\Programs\gitleaks\gitleaks.exe` | 8.30.1 |

**The canonical repo currently scans CLEAN** — `gitleaks dir .` over
`~/workspace/blockforge` reports **0 findings** across ~170 KB. Re-run it
before every push.

### THE REPO STILL MUST NOT BE CREATED YET

`gh repo view HoTWinGs06/blockforge` → *could not resolve to a Repository*.
That is correct. The brief says the public repo is created **only after M1
and M2 gates pass**, and M1 is not complete (the engine has not landed on
main and G1 is not passed).

When the gate opens, RELEASE creates it with:

```sh
gh repo create blockforge --public --source=. --remote=origin
```

One caveat recorded now rather than discovered later: `gh repo create` has
**no `--dry-run`**, and the token is fine-grained so its scopes are not
listed by the API. Create-permission therefore cannot be verified without
creating. If it fails, the fallbacks are a classic PAT with `public_repo`
scope, or creating the repo once in the browser and letting `gh` attach to
it — both need no code changes.

The canonical Linux repo currently has **no git remote** (`git remote -v` is
empty), which is expected until the repo exists.

## 1f. The M1 prototype — the first playable build

**Branch:** `feature/architect/m1-integration` @ `05576ec` on the canonical repo.
It merges `feature/engine/m1` + `feature/hermes-win/g2` + the architect's
T40–T43 contract hardening. The render branch **on its own did not build** —
`engineBridge.ts` could not resolve `../engine/index.js`, because the engine
had never been merged in. This merge is what makes the app real.

**Gates, all read back, not assumed:**

| | |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `npx playwright test` (G2) | **4 passed (4)** — including *loads the game with no console errors or warnings* and *keeps the console clean across the whole run* |

**What works, verified by driving it:** the world generates; the camera is
first person; `WASD` moves; `F` breaks and `R` places a block; the raycast
reports the targeted block with world coordinates (`Rubble -2, 68, -9`, then
`Clay -2, 68, -9` once the break changed the target); the pause menu renders;
the originality disclaimer is in the HUD.

**Run it:**

```sh
git clone hermes:~/workspace/blockforge      # or use an existing clone
git checkout feature/architect/m1-integration
npm ci
npm run dev            # http://localhost:5173
```

Controls are in the README. Screenshots of the prototype are in
`C:/Users/JOEL/workspace/blockforge-play/prototype-1..5.png` on the Windows box.

**Known visual issue (T53, owner RENDER/UI): the world is far too dark.** The
terrain is legible and per-face shading works — faces at different angles get
different tones, so the directional light is live — but block faces read as
almost black. Either the procedural texture atlas is far too dark, the
ambient/hemisphere light is too weak against the directional, or the material
is not lit as intended. This is the gap between "technically runs" and
"pleasant to play", and it should be fixed before the renderer is built on
further.

**Not in M1 yet:** inventory and hotbar contents (slots are empty), crafting,
mobs, hunger, biomes, caves, trees, water, day/night, save/load,
multiplayer, and the settings menu beyond the pause overlay.

## 1g. Speed and cleanliness pass (measured, not asserted)

### The biggest drag was structural, not tool speed

`main` was **45 files and 5,860 lines behind** — every agent was branching
from the bare scaffold, and branches were stacking on each other instead of on
a shared `main`. That is what produced the stale golden hash: the render
branch's `engine-wiring` test pinned a world hash recorded against a
mid-flight engine, and the engine kept moving. The render branch also did not
build on its own (`engineBridge.ts` could not resolve `../engine/index.js`).

`main` is now the integrated state (`feature/architect/m1-integration`,
`672dee1`) — **50 files, 6,014 insertions** versus the scaffold. Branch from
`main` now, not from a stacked branch.

### One-command gate

```sh
npm run verify     # typecheck -> lint -> test -> coverage -> build, with a timing table
npm run check      # the fast inner loop: typecheck, lint, test
```

`scripts/verify.mjs` runs the chain in order, stops at the first failure,
names the failing step, and prints per-step milliseconds. One command and one
summary beats five commands and five exit codes to eyeball.

### Measured wins

| Change | Before | After | Note |
|---|---|---|---|
| vitest `isolate: false` | 7,855 ms | **6,151 ms** | same 105-test suite, −1.7 s (−22 %) |
| new worktree setup | `npm ci`, 6–30 s, ~150 MB | **symlinked `node_modules`** | `scripts/new-worktree.sh` |

`isolate: false` reuses one worker instead of spawning one per file. `src/core`
is pure, so files cannot leak state into each other — and sharing the module
registry would *expose* a leak if one existed.

`scripts/new-worktree.sh <agent> [suffix]` creates a worktree and links the
canonical repo's `node_modules` into it. Seven worktrees were duplicating
~1 GB of dependencies. **Do not run `npm ci` in a linked worktree** — it would
delete the shared tree. Run `npm install <pkg>` if you need a new dependency;
that replaces the link with a real tree, which is correct but slower.

### Cleanliness

- `src/dev/entry.ts` → **`src/entry.ts`**. It is the production entry point
  and it ships to users; the dev world stand-in it replaced is gone, so the
  `dev/` name was a lie about what the file is.
- `eslint.config.js` gained a **Node-globals override for `scripts/`** — the
  Node helper scripts were being linted against browser globals and
  `console`/`process` came back undefined.
- The **vacuous-hash canary was inverted**. `tests/engine-wiring.test.ts`
  deliberately pinned the OLD bug (`a.hash() === c.hash()` for two *different*
  seeds) so that finding E5 stayed visible. The engine has since **fixed E5**
  — `hash()` now mixes the seed and the chunk contents — so the canary fired
  and had to be inverted to assert the fixed behaviour. The new form is
  *stronger*: same seed → same hash, **different seed → different hash**,
  which the old form could never have detected.

### Gate state on `main` right now

| Step | Result |
|---|---|
| typecheck | 0 |
| lint | 0 |
| test | **105 / 105 green** across 9 files |
| build | 0 |
| G2 Playwright | **4 / 4**, including the zero-console-warnings assertion |
| **coverage (G1)** | **RED — 64.86 % statements vs the 85 % floor** |

The coverage gap is real and precisely located: `physics.ts` 5.68 % and
`raycast.ts` **0 %** are the two holes; branches sit at 49 % even where
statements are high. `rng.ts` 82.85 %, `meshing.ts` 90.72 % and `noise.ts`
100 % are close. G1 closes when the engine's code has real tests against it —
**the floor must not be lowered to make it green.** Filed as T55.

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

---

## 10. G1 CLOSE-OUT — TEST AUTHOR (M1)

**Agent:** TEST AUTHOR (`testauthor`, pane `w1:p4`) · **Task:** T27
**Branch:** `feature/test-author/m1` · **Final commit:** `c419f8c`
**Commits:** `df1b5ec` (tests) · `7fc1dd2` (docs) · `16bc2c2` (flaky-test
fix) · `94d9ef8` (merge of the engine's fix branch) · `c419f8c` (closed
findings converted + hardened contract covered)
**Base:** `feature/engine/m1` @ `e29fc98`, then `feature/engine/fix-e1-e2-tunnel`
@ `74337bb` (merged in when the engine closed the findings below).
This repo has no `origin` remote — branches are shared through the local
worktrees.

### 10.1 The gate, read back from the tool

```
npm run coverage -> exit 0

Statements   : 99.56% ( 682/685 )
Branches     : 95.32% ( 265/278 )
Functions    : 100%   ( 96/96  )
Lines        : 99.52% ( 632/635 )
```

**The 85% floor was not moved.** `vitest.config.ts` is untouched; the
thresholds are still `lines: 85, functions: 85, branches: 85, statements: 85`.
The gate went green because the tests caught up with the code, which is the
only way it is allowed to go green.

Suite: **14 files, 206 tests — 206 passed, 0 failures, 0 expected-fail
remaining.** `npm test` exit 0 · `npm run lint` exit 0 (0 errors) ·
`npm run typecheck` exit 0. Verified stable across three consecutive
`npm run coverage` runs with identical numbers.

| file | stmts before | stmts after | branch before | branch after |
|---|---|---|---|---|
| `src/core/raycast.ts` | 0.00% | 98.11% | 0.00% | 100% |
| `src/core/noise.ts` | 1.81% | 100% | 100% | 100% |
| `src/core/physics.ts` | 5.68% | 100% | 0.00% | 92.86% |
| `src/core/world.ts` | 17.47% | 99.02% | 7.77% | 96.66% |
| `src/core/rng.ts` | 82.85% | 100% | 62.50% | 100% |
| `src/core/meshing.ts` | 86.09% | 100% | 61.29% | 85.48% |
| `src/core/constants.ts` | 100% | 100% | 100% | 95.65% |
| `src/core/index.ts` | 100% | 100% | 100% | 100% |
| `src/core/types.ts` | 100% | 100% | 100% | 100% |
| **TOTAL** | **39.24%** | **99.56%** | **26.27%** | **95.32%** |

### 10.2 Files

| file | what it pins |
|---|---|
| `tests/raycast.test.ts` (new) | DDA hit cell, face normal points back at the ray on all six axes, placement cell is the empty neighbour, miss returns null, edge tie-break is stable, start-inside terminates, `maxDistance` bounds the search. |
| `tests/physics.test.ts` (new) | Collision box centred on the feet, `aabbIntersects` touch-vs-overlap, falling body rests exactly on the floor top (`y === 1`), body stopped flush against a wall in all four directions, head-bump clearance, zero `dt` is a no-op, body pushed clear of a wall it started inside, and the no-overlap property over multi-block moves. |
| `tests/noise.test.ts` (new) | `valueNoise2`/`valueNoise3` determinism, seed sensitivity, `[0, 1)` range, C2 continuity across a lattice boundary, `fbm2` determinism, range and totality. |
| `tests/world.test.ts` (new) | `generateChunk` byte-identical for the same seed+key, different for a different seed or key, order-independent, heightmap continuous across a chunk border, world hash stable and seed-sensitive, chunk cache/unload, snapshot round-trip, block-ordinal inverses. |
| `tests/contract_types.test.ts` (new) | The engine's hardened frozen contract: `SOLID_BLOCKS`/`TRANSPARENT_BLOCKS` are genuinely immutable (the mutators throw), the block-byte encoding is a bijection, an invalid byte is rejected rather than decoded, and a chunk key round-trips exactly. |
| `tests/rng.test.ts` (extended) | Both `nextInt` bounds and the three `RangeError` paths, `nextUint32` covers the full uint32 range, `getState`/`setState` round-trip, `createRngFromState` restores a stream exactly, and `fork` is independent of the parent's consumption history. |
| `tests/meshing_spec.test.ts` (extended) | Stable byte-identical vertex order, one `blocks` entry per triangle, no face for air, **no face across a section boundary**, west/east/north/south neighbour margins, greedy merge of a 4×1 slab into one quad, winding agrees with the normal. |
| `tests/lib/purity-scan.ts` (new) | The purity scanner, built on the TypeScript AST. |
| `tests/purity.test.ts` (rewritten) | The guard plus 23 meta-tests proving it can still fail. |

### 10.3 The purity guard is no longer blind (T48 / T49 / T50 closed)

The old guard was a regex sweep over comment-stripped text, and RED-TEAM
found three holes in it. All three are closed, and the guard now has
**meta-tests that replay every known-bad form against the scanner** — so a
future weakening goes red before the real files do.

| id | hole | fix |
|---|---|---|
| T1 | `readdirSync(src/core).filter(.ts)` is not recursive, so `src/core/world/`, `meshing/`, `physics/`, `raycast/` and `noise/` were never scanned — nearly all the real code. | The file list is a **recursive walk** (`listTypeScriptFiles`), and the test proves it against a real nested temp tree. |
| T2 | `stripComments()` deleted from `//` to end of line without knowing the `//` was inside a string, so one URL on a line silently deleted a real `Math.random()` with it. | The scanner is built on the **TypeScript AST**, so comments and strings are structurally distinct. There is no comment-stripping step to get wrong. |
| T3 | `Math . random()`, `require("three")` and `await import("three")` all slipped past the regexes. | The AST sees a call as a call whatever the spacing, and all four import spellings (`from`, `import`, `require`, dynamic `import`) are handled by one code path. |

The guard also got **stricter, not looser**: it now flags DOM globals in
type position, while correctly not flagging `{ document: 1 }`, `foo.document`,
a local variable that shadows a DOM global name, and a string literal
containing `"Date.now()"`.

### 10.4 The three "fixed" findings — re-verified, not taken on trust

The engine's first handoff (`e29fc98`) claimed E1, E2 and E5 were all
fixed. **Measured against that tree, only E5 was.** The engine then landed
`74337bb`, which fixed the other two — and the `it.fails` written here
flipped RED to announce each closure, exactly as designed, and each was
converted to a plain `it` asserting the fixed behaviour.

| id | first handoff claimed | measured | how it ended |
|---|---|---|---|
| **E5** (vacuous hash) | fixed | **FIXED** — `hash()` mixes the seed in first, so different seeds differ even with **no chunks loaded**. | Plain `it` in `tests/world.test.ts`. Passes, and stays passing. |
| **E1** (fbm2 NaN) | fixed | **NOT FIXED** at `e29fc98` — `fbm2` still computed `sum / norm`, and with `octaves <= 0` both are 0, so the result was `NaN`. | `it.fails` → flipped RED → **fixed** in `74337bb` (octave count clamped to ≥ 1) → now a plain `it` in `tests/noise.test.ts`, asserting the fixed behaviour over octave counts −100…100. |
| **E2** (fork order-dependence) | fixed | **NOT FIXED** at `e29fc98` — `fork()` still derived the child from `this.state`, the parent's *current* state. | `it.fails` → flipped RED → **fixed** in `74337bb` (child derived from `this.seed`) → now a plain `it` in `tests/rng.test.ts`, plus a new test over a range of consumption histories. |

The point of the exercise was never to trust the claim: had the fixes
landed as claimed, the `it.fails` would have gone red on the spot and
the suite would have said so.

### 10.5 New finding, found and closed (T64)

`moveWithCollisions` resolved collisions by testing the box at the
**destination** only; the swept path from start to destination was never
examined. A body that moved further than one block in a single step
therefore passed clean through a one-block-thick wall or floor.

Not theoretical: the player falls at up to `TERMINAL_VELOCITY` (60)
blocks per second, so at any frame rate below 60 fps a falling body
moves 2+ blocks per step and goes straight through the ground. A body
stepping 2 blocks into a two-block wall ended up **embedded inside it** —
worse than tunnelling.

Pinned as `it.fails` with the fixed behaviour inside, then **fixed** in
`74337bb` (the move is now split into sub-steps of at most half a
block, so every obstacle is sampled) and converted to a plain `it`,
together with a new property test that the body never ends up overlapping
a solid block after a multi-block move.

### 10.6 Handoff

- **ENGINE (`hermes-linux`)** — `74337bb` closed T44 (E1), T45 (E2) and
  T64 (tunnelling). All three are now pinned as plain `it` asserting the
  fixed behaviour, so a regression in any of them goes red immediately.
- **RED-TEAM (`opencode`)** — the `it.fails` in `tests/redteam/` for
  T48/T49/T50 still test a frozen copy of the OLD purity logic. They
  should be re-pointed at `tests/lib/purity-scan.ts` (or converted to
  plain `it` asserting the current behaviour) now that the guard is
  fixed. The same applies to the red-team's E1/E2 stubs in
  `tests/redteam/engine-attack.test.ts`.
- **Coordinator (`hermes-win`)** — G1 passes. G5 (lint + typecheck) is
  clean. G6 is unaffected; `tests/determinism.test.ts` still passes.

## 9. The fleet dispatcher (Linux-side autonomy)

The role agents — engine, gameplay, netcode, redteam, release, renderui,
testauthor — are **one-shot**: they are dispatched for a specific job, write a
summary heartbeat and exit. Nothing on the build host was polling the board or
calling `claim-next`, so a task assigned to a role sat there until a human
picked it up. The dispatch loop lived in a pane on the operator's laptop.

`scripts/fleet/dispatcher.py` closes that loop. It runs on the **Linux build
host** (so it keeps working when the laptop is off), and every two minutes it:

1. reads the board and finds a `todo` task owned by a role agent
2. refuses to dispatch if the host is not idle enough (see below)
3. brings the role's worktree up to `feature/integrated/m1`
4. writes the task's brief — the board notes plus the role's standing brief
5. claims the task on the board (`status=doing`) **before** launching
6. launches the agent detached:
   `hermes chat --query-file <brief> --oneshot --max-turns 500 --run-budget 3000 --yolo`
7. records the attempt count, and re-dispatches a dead agent's task up to
   `MAX_ATTEMPTS` before leaving it alone

**The host is small** — 2 CPUs, 4 GB of RAM, already hosting the Hermes
dashboard, the Hermes gateway, the Discord bot and the board cron. A Playwright
suite, a typecheck and an agent at once took it to load 21 on 2 cores, at which
point sshd stopped forking and the box became unreachable for minutes. So the
dispatcher **refuses to dispatch** unless a CPU is genuinely free and there is
memory headroom. It measures *runnable processes right now*, not the 1-minute
load average, because the average is a decaying number that stays high for
minutes after the work that caused it has finished.

**Consequences for the fleet:**
- a role task now starts by itself, unattended, on the build host
- `docs/PROGRESS.md` and `docs/VICTORIES.md` are the ARCHITECT's alone —
  agents are told to put their handoff in the board notes and in
  `docs/handoffs/<role>.md`, because seven agents appending to one file in
  seven worktrees guarantees conflicts and lost work
- a task with no live agent and no completion is re-dispatched automatically
