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
