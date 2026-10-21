/**
 * BlockForge — server-authoritative validation.
 *
 * OWNERSHIP: NETCODE. This is the surface the RED-TEAM attacks, so it is
 * written to be read, not to be clever.
 *
 * EVERY rule lives here, and every rule is a pure function: same input, same
 * verdict, forever. Nothing in this file touches the clock, the network, the
 * filesystem, or any random source. The server (`server/server.ts`) does the
 * I/O and calls these functions; these functions only decide.
 *
 * THE RULE TABLE, in the order the rules are applied. The order matters: a
 * packet that breaks several rules always gets the SAME reason, so a client
 * (and a test) can rely on it.
 *
 *   block_edit
 *     1. the payload has exactly the fields cx, cz, x, y, z, block   -> malformed_payload
 *     2. cx, cz are whole numbers inside the world radius            -> out_of_bounds
 *     3. x, z are inside the chunk; y is inside the world height      -> out_of_bounds
 *     4. block names a real block kind                                -> unknown_block
 *     5. y === 0 is the voidstone foundation and is never editable    -> immutable_bedrock
 *
 *   chunk_request
 *     1. the payload has exactly the fields cx, cz, radius            -> malformed_payload
 *     2. cx, cz are whole numbers inside the world radius             -> out_of_bounds
 *     3. radius is a whole number of chunks                           -> malformed_payload
 *     4. radius is not negative                                       -> out_of_bounds
 *     5. radius is not larger than the server will serve              -> chunk_request_too_large
 *
 *   snapshot (a save file)
 *     1. the version is the one this build writes                     -> save_schema_mismatch
 *     2. the shape is right and every block byte is a real block      -> save_corrupt
 *
 * `out_of_bounds` and `malformed_payload` are separate on purpose: one
 * says "you asked for a place that does not exist", the other says "you did
 * not send a question this server can answer".
 */

import {
  ALL_BLOCK_IDS,
  isValidBlockByte,
  type BlockEditPayload,
  type BlockId,
  type ChunkSnapshot,
  type Season,
  type WorldSnapshot,
} from "../src/core/types.js";
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  CHUNK_VOLUME,
  SAVE_SCHEMA_VERSION,
  SEASONS,
} from "../src/core/constants.js";
import {
  MAX_CHUNK_COORD,
  MAX_CHUNK_RADIUS,
  MAX_CHUNKS_PER_REQUEST,
  type ChunkRequestPayload,
  type ValidationResult,
} from "../src/net/protocol.js";

/** The block kinds a client may name. Membership test, not a cast. */
const KNOWN_BLOCKS: ReadonlySet<string> = new Set<string>(ALL_BLOCK_IDS);

/** True when `value` is a whole number with no fractional part. */
function isWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** True when `value` is a plain object (not an array, not null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `object` has exactly these keys, no more and no fewer. */
function hasExactlyKeys(object: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(object);
  if (actual.length !== keys.length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(object, key)) return false;
  }
  return true;
}

/** The exact key set of a block edit payload. */
const BLOCK_EDIT_KEYS = ["cx", "cz", "x", "y", "z", "block"] as const;

/** The exact key set of a chunk request payload. */
const CHUNK_REQUEST_KEYS = ["cx", "cz", "radius"] as const;

/**
 * Validate a block edit against the server's rules.
 *
 * The server is the only authority on what may change: this function never
 * mutates anything, it only says whether the edit is allowed.
 */
export function validateBlockEdit(
  payload: unknown,
): ValidationResult<BlockEditPayload> {
  if (!isPlainObject(payload)) {
    return { ok: false, reason: "malformed_payload", detail: "not an object" };
  }
  if (!hasExactlyKeys(payload, BLOCK_EDIT_KEYS)) {
    return {
      ok: false,
      reason: "malformed_payload",
      detail: `keys: ${Object.keys(payload).sort().join(",")}`,
    };
  }

  const cx = payload["cx"];
  const cz = payload["cz"];
  const x = payload["x"];
  const y = payload["y"];
  const z = payload["z"];
  const block = payload["block"];

  if (
    !isWholeNumber(cx) ||
    !isWholeNumber(cz) ||
    !isWholeNumber(x) ||
    !isWholeNumber(y) ||
    !isWholeNumber(z)
  ) {
    return {
      ok: false,
      reason: "malformed_payload",
      detail: "coordinates must be whole numbers",
    };
  }

  if (Math.abs(cx) > MAX_CHUNK_COORD || Math.abs(cz) > MAX_CHUNK_COORD) {
    return {
      ok: false,
      reason: "out_of_bounds",
      detail: `chunk ${cx},${cz} is outside the world`,
    };
  }

  if (x < 0 || x >= CHUNK_SIZE_X || z < 0 || z >= CHUNK_SIZE_Z) {
    return {
      ok: false,
      reason: "out_of_bounds",
      detail: `block ${x},${z} is outside the chunk`,
    };
  }

  if (y < 0 || y >= CHUNK_SIZE_Y) {
    return {
      ok: false,
      reason: "out_of_bounds",
      detail: `height ${y} is outside the world`,
    };
  }

  if (typeof block !== "string" || !KNOWN_BLOCKS.has(block)) {
    return {
      ok: false,
      reason: "unknown_block",
      detail: `unknown block: ${String(block)}`,
    };
  }

  // The y === 0 layer is the voidstone foundation in every generated column.
  // It is the bottom of the world; nothing may dig through it.
  if (y === 0) {
    return {
      ok: false,
      reason: "immutable_bedrock",
      detail: "the voidstone foundation cannot be edited",
    };
  }

  return {
    ok: true,
    value: { cx, cz, x, y, z, block: block as BlockId },
  };
}

/**
 * Validate a chunk request against the server's rules.
 *
 * The chunk count is checked as well as the radius, so a rule change to
 * `MAX_CHUNK_RADIUS` can never quietly widen the amount of world a single
 * packet can pull.
 */
export function validateChunkRequest(
  payload: unknown,
): ValidationResult<ChunkRequestPayload> {
  if (!isPlainObject(payload)) {
    return { ok: false, reason: "malformed_payload", detail: "not an object" };
  }
  if (!hasExactlyKeys(payload, CHUNK_REQUEST_KEYS)) {
    return {
      ok: false,
      reason: "malformed_payload",
      detail: `keys: ${Object.keys(payload).sort().join(",")}`,
    };
  }

  const cx = payload["cx"];
  const cz = payload["cz"];
  const radius = payload["radius"];

  if (!isWholeNumber(cx) || !isWholeNumber(cz)) {
    return {
      ok: false,
      reason: "malformed_payload",
      detail: "chunk coordinates must be whole numbers",
    };
  }
  if (Math.abs(cx) > MAX_CHUNK_COORD || Math.abs(cz) > MAX_CHUNK_COORD) {
    return {
      ok: false,
      reason: "out_of_bounds",
      detail: `chunk ${cx},${cz} is outside the world`,
    };
  }
  if (!isWholeNumber(radius)) {
    return {
      ok: false,
      reason: "malformed_payload",
      detail: "radius must be a whole number",
    };
  }
  if (radius < 0) {
    return {
      ok: false,
      reason: "out_of_bounds",
      detail: `radius ${radius} is negative`,
    };
  }
  if (radius > MAX_CHUNK_RADIUS) {
    return {
      ok: false,
      reason: "chunk_request_too_large",
      detail: `radius ${radius} exceeds the maximum of ${MAX_CHUNK_RADIUS}`,
    };
  }

  const chunkCount = (2 * radius + 1) * (2 * radius + 1);
  if (chunkCount > MAX_CHUNKS_PER_REQUEST) {
    return {
      ok: false,
      reason: "chunk_request_too_large",
      detail: `${chunkCount} chunks exceeds the maximum of ${MAX_CHUNKS_PER_REQUEST}`,
    };
  }

  return { ok: true, value: { cx, cz, radius } };
}

/**
 * Validate a loaded save file before the server trusts a single block of it.
 *
 * A save file is the one input to the server that arrives from outside, so
 * it gets the same treatment as a packet: check the shape, then check every
 * value, and refuse the whole file rather than loading half of it.
 *
 * The input is RAW JSON - the parsed form of a save file, where a chunk's
 * blocks are a plain array of numbers because that is what JSON holds. The
 * output is a real `WorldSnapshot` whose blocks are `Uint8Array`s, so
 * nothing downstream has to guess which it is holding.
 *
 * The checks, in order:
 *   1. the schema version is the one this build writes -> save_schema_mismatch
 *   2. the shape is right                            -> save_corrupt
 *   3. the season is a real season                   -> save_corrupt
 *   4. every chunk key is inside the world            -> save_corrupt
 *   5. every chunk holds exactly CHUNK_VOLUME blocks -> save_corrupt
 *   6. every block byte is a real block kind          -> save_corrupt
 */
export function validateSnapshot(
  raw: unknown,
): ValidationResult<WorldSnapshot> {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: "save_corrupt", detail: "not an object" };
  }

  if (raw["schemaVersion"] !== SAVE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "save_schema_mismatch",
      detail: `expected schema ${SAVE_SCHEMA_VERSION}, got ${String(raw["schemaVersion"])}`,
    };
  }

  if (!isWholeNumber(raw["seed"])) {
    return { ok: false, reason: "save_corrupt", detail: "seed must be a whole number" };
  }
  if (!isWholeNumber(raw["tick"])) {
    return { ok: false, reason: "save_corrupt", detail: "tick must be a whole number" };
  }

  const season = raw["season"];
  if (typeof season !== "string" || !SEASONS.includes(season as Season)) {
    return {
      ok: false,
      reason: "save_corrupt",
      detail: `unknown season: ${String(season)}`,
    };
  }

  const chunks = raw["chunks"];
  if (!Array.isArray(chunks)) {
    return { ok: false, reason: "save_corrupt", detail: "chunks must be an array" };
  }

  const validated: ChunkSnapshot[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!isPlainObject(chunk)) {
      return { ok: false, reason: "save_corrupt", detail: `chunk ${i} is not an object` };
    }

    const key = chunk["key"];
    if (!isPlainObject(key)) {
      return { ok: false, reason: "save_corrupt", detail: `chunk ${i} has no key` };
    }
    const cx = key["cx"];
    const cz = key["cz"];
    if (!isWholeNumber(cx) || !isWholeNumber(cz)) {
      return {
        ok: false,
        reason: "save_corrupt",
        detail: `chunk ${i} has a malformed key`,
      };
    }
    if (Math.abs(cx) > MAX_CHUNK_COORD || Math.abs(cz) > MAX_CHUNK_COORD) {
      return {
        ok: false,
        reason: "save_corrupt",
        detail: `chunk ${i} is outside the world`,
      };
    }

    const blocks = chunk["blocks"];
    if (!Array.isArray(blocks) || blocks.length !== CHUNK_VOLUME) {
      return {
        ok: false,
        reason: "save_corrupt",
        detail: `chunk ${i} does not hold ${CHUNK_VOLUME} blocks`,
      };
    }
    const bytes = new Uint8Array(CHUNK_VOLUME);
    for (let b = 0; b < blocks.length; b++) {
      const byte = blocks[b];
      if (!isWholeNumber(byte) || !isValidBlockByte(byte)) {
        return {
          ok: false,
          reason: "save_corrupt",
          detail: `chunk ${i} block ${b} is not a real block`,
        };
      }
      bytes[b] = byte;
    }

    validated.push({ key: { cx, cz }, blocks: bytes });
  }

  return {
    ok: true,
    value: {
      schemaVersion: SAVE_SCHEMA_VERSION,
      seed: raw["seed"],
      season: season as Season,
      tick: raw["tick"],
      chunks: validated,
    },
  };
}
