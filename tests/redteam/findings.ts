/**
 * BlockForge — RED-TEAM finding index.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/).
 *
 * WHAT IS A FINDING
 * -----------------
 * A finding is a hole in code that BLOCKFORGE owns (src/core, server/), found
 * by a test that lives here. The test encodes the behaviour the contract
 * PROMISES, not the behaviour the code currently has.
 *
 * HOW THE TESTS ARE ENCODED
 * -------------------------
 * Each finding test uses Vitest's `it.fails(...)`:
 *
 *   - while the bug exists, the inner assertion fails, `it.fails` reports
 *     GREEN, and the shared suite stays green for every other agent;
 *   - the moment the owning agent fixes the bug, the inner assertion passes,
 *     `it.fails` reports RED ("expected to fail but passed"), and the
 *     finding announces itself as closed.
 *
 * A finding is therefore never silently forgotten: it flips the suite red
 * when it is fixed, and RED-TEAM converts it to a plain `it` in the same
 * commit that closes it.
 *
 * Each file also contains a plain `it("control: ...")` that pins the CURRENT
 * behaviour, so the probe itself is proven to be wired correctly and a green
 * `it.fails` can never be hiding a typo or a dead assertion.
 *
 * RUNNING THEM
 * ------------
 *   npm run test -- tests/redteam
 *   npx vitest run tests/redteam -t "FINDING"
 *
 * OWNERS
 * ------
 * src/core/types.ts and src/core/constants.ts are ARCHITECT's (opencode).
 * server/ and src/net/ are NETCODE's. src/core/{world,meshing,physics} and
 * src/engine/ are ENGINE's (hermes-linux).
 */

export interface Finding {
  /** Stable id, also used in the board task title. */
  readonly id: string;
  readonly title: string;
  /** Who owns the code that must change. */
  readonly owner: string;
  /** Board task id, once filed. */
  readonly boardTask: string;
  readonly status: "open" | "closed";
  readonly severity: "critical" | "high" | "medium" | "low";
  /** One line: the contract promise that is broken. */
  readonly promise: string;
  /** Short repro. */
  readonly repro: string;
}

/**
 * Every finding filed by RED-TEAM, in the order they were filed.
 *
 * The board is the source of truth for status; this list is the index that
 * tells an agent which file to open and what the failure means.
 */
export const FINDINGS: readonly Finding[] = [
  {
    id: "F1",
    title: "Object.freeze does not freeze a Set: SOLID_BLOCKS/TRANSPARENT_BLOCKS are mutable global state",
    owner: "opencode",
    boardTask: "T40",
    status: "open",
    severity: "high",
    promise:
      "SOLID_BLOCKS and TRANSPARENT_BLOCKS are declared ReadonlySet<BlockId> and wrapped in Object.freeze, so they must not change during a run.",
    repro:
      'SOLID_BLOCKS.add("air" as BlockId); // no error, and SOLID_BLOCKS.has("air") is now true',
  },
  {
    id: "F2",
    title: "chunkKeyFromString accepts malformed keys and is not the inverse of chunkKeyToString",
    owner: "opencode",
    boardTask: "T41",
    status: "open",
    severity: "high",
    promise:
      "chunkKeyFromString throws on malformed input, and chunkKeyToString is its inverse, so chunkKeyToString(chunkKeyFromString(s)) === s.",
    repro:
      'chunkKeyFromString(",") returns {cx:0,cz:0}; chunkKeyFromString("0x10,2") returns {cx:16,cz:2}; chunkKeyFromString("1,") and chunkKeyFromString("1,0") are the same chunk.',
  },
  {
    id: "F3",
    title: "Chunk.blocks is a Uint8Array of BlockId ordinals with no exported mapping and no guard",
    owner: "opencode",
    boardTask: "T42",
    status: "open",
    severity: "medium",
    promise:
      "Chunk.blocks stores one byte per block, indexed by BlockId ordinal, so every byte value in 0..255 must either resolve to a BlockId or be rejected by core.",
    repro:
      "ALL_BLOCK_IDS[200] is undefined: 233 of 256 byte values are representable and none of them can be validated or rejected by any exported core function.",
  },
  {
    id: "F4",
    title: "chunkKeyToString emits strings its own inverse rejects",
    owner: "opencode",
    boardTask: "T43",
    status: "open",
    severity: "medium",
    promise:
      "chunkKeyToString and chunkKeyFromString are inverses, so a key that is serialised can always be read back.",
    repro:
      "chunkKeyToString({ cx: 1.5, cz: 2 }) === '1.5,2' and chunkKeyFromString('1.5,2') throws; same for {cx:NaN,cz:0}.",
  },
  {
    id: "E1",
    title: "Engine fbm2() returns NaN for octaves <= 0 (0/0) - NaN heights propagate into world generation",
    owner: "hermes-linux",
    boardTask: "T44",
    status: "open",
    severity: "high",
    promise: "fbm2 is the terrain height function and must return a finite number for every input.",
    repro: "fbm2(1234, 10.5, 20.5, 0) === NaN; fbm2(1234, 10.5, 20.5, -3) === NaN",
  },
  {
    id: "E2",
    title: "Engine SeededRng.fork() mixes the parent's CURRENT state, not its seed - the child stream shifts with the parent's consumption history",
    owner: "hermes-linux",
    boardTask: "T45",
    status: "open",
    severity: "high",
    promise:
      "fork() must derive a child stream from (seed, label) alone, so subsystems never interfere with each other or with generation order.",
    repro:
      "createRng(42).fork('terrain') before and after one draw produce different streams: 1766700328,... vs 3591649458,...",
  },
  {
    id: "E3",
    title: "Engine chunkIndex() bypasses the frozen blockIndex() guard and silently aliases out-of-range coordinates onto other blocks",
    owner: "hermes-linux",
    boardTask: "T46",
    status: "open",
    severity: "high",
    promise: "No path may bypass the frozen blockIndex() RangeError guard.",
    repro:
      "chunkIndex(16,0,0) === 16 - the storage slot of block (0,0,1); chunkIndex(0,256,0) === 65536, one past the end, so a typed-array write there is silently dropped",
  },
  {
    id: "E4",
    title:
      "Engine noise truncates coordinates and seeds to 32 bits - terrain aliases and fbm2(2^32) === fbm2(0)",
    owner: "hermes-linux",
    boardTask: "T47",
    status: "open",
    severity: "medium",
    promise: "Distinct world seeds must produce distinct worlds, and lattice coordinates must not alias.",
    repro:
      "fbm2(4294967296, 10.5, 20.5, 1) === fbm2(0, 10.5, 20.5, 1) === 0.7303423706325702; valueNoise2(5, 2^31, 0) === valueNoise2(5, -2^31, 0)",
  },
];

/** Findings that are still open. */
export function openFindings(): readonly Finding[] {
  return FINDINGS.filter((f) => f.status === "open");
}
