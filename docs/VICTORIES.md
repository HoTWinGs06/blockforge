# BlockForge — Victory Log

> Every win is logged here immediately, and posted to the Milo butler server.
> Format is fixed:
>
> `- [ISO timestamp] <category> — <what happened> — <evidence> — <milestone>`
>
> Rules that are not negotiable:
> - Never log a win that did not actually happen. **No aspirational entries.**
> - "verified" means the result was read back, never "the command returned ok".
> - Every entry is also posted to the Milo butler server. If no Milo interface
>   is discoverable, the entry carries a `milo: PENDING — <reason>` flag and
>   the discovery attempt is recorded in `docs/PROGRESS.md`.
> - Milo reporting must never block the build.

## Categories

`milestone` · `gate` · `benchmark` · `redteam` · `ci` · `deploy` · `bugfix` ·
`toolchain`

---

## Entries

- [2026-10-21T09:47:50Z] toolchain — Build toolchain provisioned on the Linux build host and every dependency pinned exactly (no caret ranges); TypeScript 7.x rejected because typescript-eslint@8.72.0 declares a peer range of `>=4.8.4 <6.1.0`, so pinning TS 7 would have broken gate G5 — evidence: commit ba41f192216305857ebe6093a114b2377ae8353e, `package.json` — M1
- [2026-10-21T09:47:50Z] milestone — M1 architecture contract frozen: all ten required core types (`BlockId`, `Chunk`, `WorldSnapshot`, `ChunkKey`, `SeededRng`, `MeshOutput`, `PlayerState`, `Inventory`, `Recipe`, `ItemStack`) plus the y-major chunk storage order, using original naming with no Mojang vocabulary — evidence: commit ba41f192216305857ebe6093a114b2377ae8353e, `docs/API.md`, `src/core/types.ts` — M1
- [2026-10-21T09:47:50Z] gate — G5 tooling portion green: `npm run typecheck` exit 0 (tsc --noEmit under strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes), `npm run lint` exit 0, `npm audit` found 0 vulnerabilities. G5 is NOT fully closed — CI does not exist yet, as `.github/` is owned by RELEASE — evidence: commit ba41f192216305857ebe6093a114b2377ae8353e — M1
- [2026-10-21T09:47:50Z] gate — G1 coverage floor proven enforced in config: `npm run coverage` exits 1 with "Coverage for lines (0%) does not meet global threshold (85%)" on the untouched scaffold, confirming CI will fail below 85% rather than relying on a human reading a report — evidence: commit ba41f192216305857ebe6093a114b2377ae8353e, `vitest.config.ts` — M1
- [2026-10-21T10:01:12Z] gate — G2 readiness proven: Playwright 1.64.1 with Chromium 156.0.8078.4 launches headless on the Windows host, a page loads, and the console stream is observable (0 messages on a clean page) - the exact signal gate G2 asserts on. The Linux host cannot run Playwright at all: no Chromium, none of its runtime libraries (libnss3, libatk, libgbm, libasound, libxkbcommon, libpango, libcairo) and no sudo, so 'playwright install --with-deps' is impossible there - evidence: chromium-1248 and chromium_headless_shell-1248 installed at %LOCALAPPDATA%/ms-playwright, repo clone at C:/Users/JOEL/workspace/blockforge — M1
- 2026-10-21T16:00:00Z | GATE G2 | Headless smoke test green: the game loads, the world
  generates, a block is broken and re-placed, and the console stream carries zero errors and zero
  warnings for the whole session. | evidence: commit 6140aac on feature/hermes-win/g2;
  npx vitest run tests/g2-smoke.test.ts -> exit 0, 4 passed (4); typecheck exit 0; lint exit 0 |
  M1
  NOTE: the world behind this run is the deterministic dev stand-in (src/dev/world.ts); it is
  replaced by the engine's real mesh API as soon as that lands. G2 proves the RENDER/UI side.
  NOTE: headless Chromium's SwiftShader driver injects "GPU stall due to ReadPixels" into the page
  console stream, bypassing the page's console.warn. Five Chromium flag combinations were tested
  and none silence it, so the gate filters that one driver format specifically and documents it.
  Real WebGL errors, three.js warnings and uncaught exceptions are not filtered.
