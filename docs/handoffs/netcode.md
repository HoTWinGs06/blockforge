# NETCODE handoff

> Owner: NETCODE. Files: `server/`, `src/net/`.
> Append to this file. Do not overwrite anyone else's section.
> Last entry: 2026-10-21 — M1 netcode complete at `40a604e`.

---

## 2026-10-21 — M1: wire protocol v1, server-authoritative validation, client sync

**Commit:** `40a604ea5155514621bf65da2d85465f7a3a6f66` on `feature/netcode/m1`
(worktree `~/workspace/worktrees/bf-netcode`).

### What landed

| File | What it is |
|---|---|
| `src/net/protocol.ts` | The wire format. Shared by both ends. Message names, the closed `RejectReason` list, the envelope codec, the base64 block codec, the limits. |
| `src/net/client.ts` | Client sync. `NetClient` and `ClientWorld`. |
| `src/net/index.ts` | The layer's barrel. |
| `server/validation.ts` | The rules. Pure functions: `validateBlockEdit`, `validateChunkRequest`, `validateSnapshot`. |
| `server/server.ts` | The WebSocket server. `ws@8.22.0`, JSON frames, the authority. |
| `server/world.ts` | The server's world: create, load, save, apply, serve chunks. |
| `server/attacks.ts` | The attack surface, written down. 36 attacks in 5 categories. |
| `server/selfcheck.ts` | The proof: fires the attacks at a live server. 46/46. |
| `server/main.ts` | The runnable server. |
| `server/tsconfig.build.json` | Builds `server/` + `src/core/` + `src/net/` to `node_modules/.cache/blockforge-server`. |

### The protocol, in one paragraph

Every frame in both directions is a `ProtocolEnvelope`:
`{ protocolVersion: 1, type: "...", payload: ... }`. The server refuses any
frame whose `protocolVersion` is not `PROTOCOL_VERSION`, and says so with
`protocol_version_mismatch`. Client→server types are `chunk_request` and
`block_edit`; server→client types are `welcome`, `chunk_data`,
`block_applied` and `error`.

**Coordinates.** A block edit names a CHUNK (`cx`, `cz`) and a position
INSIDE that chunk (`x`, `y`, `z`, where `x` and `z` run 0..15 and `y` runs
0..255). The world position is `cx*16 + x`, `y`, `cz*16 + z`. The mapping
lives in one place so it cannot drift between the two ends.

**Authority.** A client asks; the server decides. The client applies an
edit only when the server broadcasts `block_applied`, never on its own
say-so. A refused edit never reaches the client's world.

### The rules, and where each attack dies

The five categories from the brief, and the function that refuses each:

| Category | Refused by | Reasons |
|---|---|---|
| malformed packets | `parseClientEnvelope` (`src/net/protocol.ts`) | `malformed_json`, `not_an_object`, `malformed_envelope`, `malformed_packet`, `protocol_version_mismatch`, `missing_type`, `unknown_type`, `packet_too_large` |
| out-of-bounds block edits | `validateBlockEdit` | `out_of_bounds`, `malformed_payload` |
| impossible block states | `validateBlockEdit` | `unknown_block`, `immutable_bedrock` |
| huge chunk requests | `validateChunkRequest` | `chunk_request_too_large`, `out_of_bounds`, `malformed_payload` |
| save-file corruption | `validateSnapshot` | `save_corrupt`, `save_schema_mismatch` |

Plus `rate_limited` (a client that floods with legal edits) and
`internal_error` (a server bug; should never happen, and never takes the
process down).

The rules are applied in a FIXED ORDER, so a packet that breaks several
rules always gets the same reason. Same input, same verdict, forever.

### The two decisions worth knowing about

1. **A bad packet does not close the connection.** The server refuses the
   packet, says why, and the socket stays up. I changed this after my own
   first attack run failed: closing on a version mismatch meant one bad
   packet blinded every packet after it, which is exactly what a test
   suite must not be robbed of. A red-team suite firing many attacks down
   one socket now sees every refusal.

2. **The rate limiter only ever refuses an edit that would have been
   applied anyway.** Validation runs FIRST, so a packet that breaks a rule
   always gets its own reason. The limiter can never mask a validation
   failure, which is what keeps every rejection of a bad edit
   deterministic.

### How to run it

```sh
npx tsc -p server/tsconfig.build.json
node node_modules/.cache/blockforge-server/server/main.js [port] [seed]
# port defaults 8787, seed 1; port 0 binds a free one
```

### How to attack it

```sh
npx tsc -p server/tsconfig.build.json
node node_modules/.cache/blockforge-server/server/selfcheck.js
# 46/46 checks passed, exit 0
```

`server/attacks.ts` is the map: every attack, its category, and the reason
the server must answer with. The rules are pure functions, so a test can
call `validateBlockEdit` / `validateChunkRequest` / `validateSnapshot`
directly instead of going over a socket.

### Verified, read back

| Check | Result |
|---|---|
| `node .../server/selfcheck.js` | **46/46 checks passed, exit 0** — 36 attacks refused with the expected reason on one shared connection, server still serving afterwards, legal edit applied and broadcast to every client, edit really changed the server's world, legal chunk request served, flooding client rate limited, three kinds of damaged save file refused |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 (0 errors; 7 `no-console` warnings, same style as the existing `scripts/verify.mjs`) |
| `npm test` | 224/224 passed, 16 files |
| `npm run build` | exit 0 |

### What I did NOT do

- **No multiplayer UX.** M1 only needs the protocol and the validation to
  exist, compile and be unit-testable. The client is a library, not a
  screen: wiring it to the game is M4 work.
- **No tests under `tests/`.** That directory belongs to the TEST AUTHOR.
  The proof lives in `server/selfcheck.ts`, which is mine and runs
  standalone.
- **No change to `src/core/`.** `PROTOCOL_VERSION`, `ProtocolEnvelope` and
  `BlockEditPayload` are used exactly as frozen.
- **No chunk streaming or delta encoding.** Whole chunks go over the wire,
  base64. Simpler to reason about; M4 can make it cheaper.
- **No save-file FORMAT decision.** `server/world.ts` reads and writes the
  shape `WorldSnapshot` already describes. M2 owns the real on-disk format.

### Victory-log entry, for the ARCHITECT to fold into docs/VICTORIES.md

I do not own `docs/VICTORIES.md`, so here is the entry, ready to copy:

```
[2026-10-21T21:05:00Z] netcode - M1 wire protocol v1, server-authoritative
validation and client sync landed on feature/netcode/m1 @ 40a604e. The server
refuses every invalid edit with a deterministic reason from a closed list:
46/46 live-server attack checks pass, 36 documented attacks on one shared
connection, server still serving afterwards - commit 40a604e, test name
server/selfcheck.ts - M1
```

Milo: POSTED (message id 1562573112007073813, channel herdr-workspace).

### Open question for the ARCHITECT

`docs/ARCHITECTURE.md` §1 says `server/` may import `src/core/` only, but
the board brief says the shared protocol lives in `src/net/protocol.ts` and
`server/` imports it. I built it the brief's way and did not edit the
architecture doc or `src/core/`.

`src/net/protocol.ts` imports ONLY `src/core/`, so it is effectively a
leaf module. Moving it down to `src/core/protocol.ts` is a two-line import
change in three files (`server/validation.ts`, `server/server.ts`,
`src/net/client.ts`) — but I cannot make that move myself, because
`src/core/` is the architect's and it is frozen. **Ruling needed:** bless
`src/net/protocol.ts` as the shared protocol, or move it down.

### What the next agent needs to know

- The server is a LIBRARY plus a `main.ts` entry. There is no npm script
  for it; `package.json` is not mine to edit, so the two commands above
  are the way in. Adding a `server` script would be a one-line change for
  whoever owns `package.json`.
- The red team's attack surface is `server/attacks.ts`. If they find a
  packet that is accepted, that is a G4 hole and it is mine to fix.
- `scripts/tsconfig.build.json` is BROKEN on this branch (TS5096:
  `allowImportingTsExtensions` cannot be used with `noEmit: false`). It
  fails on a pristine checkout too — it is not from my work. I worked
  around it in `server/tsconfig.build.json` by setting
  `allowImportingTsExtensions: false`. The ENGINE/ARCHITECT should fix
  the scripts one the same way; `npm run gate:bench`, `gate:determinism`
  and `gate:selfcheck` are all broken because of it.

=== T110 / netcode (feature/netcode/m1) — 2026-10-29 ===
- DONE: validation rule fixed (server/validation.ts y===0 now allows voidstone restoration; selfcheck 46/46 preserved).
- DONE: T39 client slice wired: titleScreen "JOIN SERVER" button + Game.join() creates NetClient; placeBlock sends requestEdit when net present; engine applies onBlockApplied; chunk sync on welcome.
- PROOF: server/selfcheck.ts extended with NetClient join proof (48/48, exit 0): join -> requestChunks -> requestEdit({cx:0,cz:0,x:3,y:70,z:4,block:Timber}) -> blockApplied received -> world.getBlockAt(3,70,4)===Timber.
- CONSTRAINTS: src/core untouched; tests/ untouched; single-player path unchanged (net undefined -> local engine.setBlock).
- BUILD: typecheck 0, lint 0 (pre-existing console warnings only), build green, selfcheck green.
- COMMIT: will commit after board update.
- BLOCKERS: none.
