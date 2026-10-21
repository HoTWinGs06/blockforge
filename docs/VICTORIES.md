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
- [2026-10-21T10:25:00Z] redteam — M1 RED-TEAM cycle 1: four holes found in the FROZEN core contract and filed to the owning agent, with failing tests committed as the deliverable — evidence: commit 807f3a83f6857e2cd2a03feae948d73bd2a937d5, board tasks T40 (Object.freeze does not freeze a Set, so SOLID_BLOCKS/TRANSPARENT_BLOCKS are mutable global state), T41 (chunkKeyFromString accepts "", " ", "0x10", "1e3", "+5", "0b101", "1.0"; "1," and "1,0" address the same chunk), T42 (no exported byte->BlockId mapping; 233 of 256 byte values invalid), T43 (chunkKeyToString emits strings its own inverse rejects) — M1
- [2026-10-21T10:25:00Z] redteam — Static purity scanner for src/core/ delivered with meta-tests that prove it CATCHES all 15 banned constructs and does not cry wolf on 5 negative controls; the scanner found 3 real bugs in itself (a non-global regex that looped forever and OOM-killed a worker, template expressions not scanned as code, and `document` matching an object key) before it was trusted — evidence: commit 807f3a83f6857e2cd2a03feae948d73bd2a937d5, tests/redteam/purity.test.ts (15 positive + 5 negative controls, all passing) — M1
- [2026-10-21T10:25:00Z] redteam — Cross-process determinism harness for gate G6 built and PROVEN: it reports identical hashes for a deterministic generator and DETECTS a non-deterministic one (a generator leaking Date.now), using the project's own pinned typescript 5.9.3 to transpile core TS because Node 24 cannot resolve its "./types.js" specifiers — evidence: commit 807f3a83f6857e2cd2a03feae948d73bd2a937d5, tests/redteam/determinism-harness.test.ts (5 tests, all passing) — M1
- [2026-10-21T10:25:00Z] gate — G1 coverage floor now SATISFIED for src/core: 100% statements, branches, functions and lines (was 0%) from the red-team suite alone, because attacking the frozen contract means executing every branch of it — evidence: commit 807f3a83f6857e2cd2a03feae948d73bd2a937d5, `npm run coverage` exit 0, "Statements : 100% (49/49), Branches : 100% (17/17), Functions : 100% (4/4), Lines : 100% (49/49)" — M1
- [2026-10-21T10:25:00Z] redteam — VERIFIED NEGATIVE RESULT: blockIndex() has no bypass. Attacked with negatives, per-axis out-of-range, fractional, NaN, Infinity, precision-losing 2**53 and 1e21, non-number types and -0: 0 escapes. Also proven to be a BIJECTION onto 0..65535 over the full 16x256x16 chunk (0 collisions, 0 gaps) and to match the frozen y-major formula x + 16*(z + 16*y) — evidence: commit 807f3a83f6857e2cd2a03feae948d73bd2a937d5, tests/redteam/contract-guards.test.ts — M1
