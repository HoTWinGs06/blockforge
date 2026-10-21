/**
 * BlockForge — the attack surface, written down.
 *
 * OWNERSHIP: NETCODE. This file is the RED-TEAM's map.
 *
 * The server is meant to be attacked, so the ways in are documented here
 * rather than left to be discovered. Every entry below is a way to make the
 * server do something it should not: accept an illegal edit, crash, or
 * hang.
 *
 * THE FIVE CATEGORIES, AND WHERE EACH ONE IS REFUSED
 * --------------------------------------------------
 *   1. malformed packets        -> src/net/protocol.ts  (parseClientEnvelope)
 *   2. out-of-bounds edits      -> server/validation.ts  (validateBlockEdit)
 *   3. impossible block states  -> server/validation.ts  (validateBlockEdit)
 *   4. huge chunk requests      -> server/validation.ts  (validateChunkRequest)
 *   5. save-file corruption     -> server/validation.ts  (validateSnapshot)
 *
 * The rules are pure functions, so a test can call them directly instead of
 * going over a socket. `server/selfcheck.ts` does both: it calls the rules
 * AND fires the same attacks at a live server.
 *
 * THE REJECTION REASONS
 * ---------------------
 * Every refusal carries one of these, and the list is closed:
 *
 *   malformed_json             the bytes are not JSON
 *   not_an_object              the JSON is not an object
 *   malformed_envelope         the object is not an envelope
 *   malformed_packet           the frame is not a text frame
 *   protocol_version_mismatch  the protocol version is not 1
 *   missing_type               the envelope has no usable type
 *   unknown_type               the type is not one this server serves
 *   packet_too_large           the frame is over the size limit
 *   malformed_payload          the payload does not have the shape the type needs
 *   out_of_bounds              the coordinates name a place that does not exist
 *   unknown_block              the block is not a real block kind
 *   immutable_bedrock          the edit tries to change the world floor
 *   chunk_request_too_large    the request asks for more chunks than allowed
 *   rate_limited               the client has spent its edit budget
 *   save_corrupt               the save file is damaged
 *   save_schema_mismatch       the save file is from another version
 *   internal_error             a bug in the server (should never happen)
 *
 * WHAT IS NOT AN ATTACK SURFACE
 * -----------------------------
 * The server never trusts a client's word about the world, so a client
 * cannot lie about what a chunk contains, what block is there, or what
 * another client did. The only things a client can say are "give me these
 * chunks" and "please set this block", and both go through the rules above.
 */

import { MESSAGE_TYPES } from "../src/net/protocol.js";
import type { RejectReason } from "../src/net/protocol.js";

/** One documented way in. */
export interface Attack {
  /** A short name for the attack. */
  readonly name: string;
  /** Which of the five categories it belongs to. */
  readonly category: AttackCategory;
  /** The reason the server must answer with. */
  readonly expect: RejectReason;
  /** The frame to send, as a string. */
  readonly frame: string;
}

export type AttackCategory =
  | "malformed packet"
  | "out-of-bounds edit"
  | "impossible block state"
  | "huge chunk request"
  | "save-file corruption";

/** A frame that is a well-formed envelope around the given payload. */
function frame(type: string, payload: unknown, version = 1): string {
  return JSON.stringify({ protocolVersion: version, type, payload });
}

/** The complete list of attacks, as frames to send. */
export const ATTACKS: readonly Attack[] = [
  // ── 1. malformed packets ───────────────────────────────────
  {
    name: "not JSON at all",
    category: "malformed packet",
    expect: "malformed_json",
    frame: "{not json",
  },
  {
    name: "JSON array instead of an object",
    category: "malformed packet",
    expect: "not_an_object",
    frame: "[1,2,3]",
  },
  {
    name: "JSON null",
    category: "malformed packet",
    expect: "not_an_object",
    frame: "null",
  },
  {
    name: "envelope missing the payload",
    category: "malformed packet",
    expect: "malformed_envelope",
    frame: JSON.stringify({ protocolVersion: 1, type: "block_edit" }),
  },
  {
    name: "envelope with an extra field",
    category: "malformed packet",
    expect: "malformed_envelope",
    frame: JSON.stringify({
      protocolVersion: 1,
      type: "block_edit",
      payload: {},
      extra: true,
    }),
  },
  {
    name: "protocol version from the future",
    category: "malformed packet",
    expect: "protocol_version_mismatch",
    frame: frame("block_edit", { cx: 0, cz: 0, x: 0, y: 5, z: 0, block: "slate" }, 2),
  },
  {
    name: "protocol version from the past",
    category: "malformed packet",
    expect: "protocol_version_mismatch",
    frame: frame("block_edit", { cx: 0, cz: 0, x: 0, y: 5, z: 0, block: "slate" }, 0),
  },
  {
    name: "protocol version as a string",
    category: "malformed packet",
    expect: "protocol_version_mismatch",
    frame: JSON.stringify({
      protocolVersion: "1",
      type: "block_edit",
      payload: {},
    }),
  },
  {
    name: "type is a number",
    category: "malformed packet",
    expect: "missing_type",
    frame: JSON.stringify({ protocolVersion: 1, type: 7, payload: {} }),
  },
  {
    name: "type is an empty string",
    category: "malformed packet",
    expect: "missing_type",
    frame: JSON.stringify({ protocolVersion: 1, type: "", payload: {} }),
  },
  {
    name: "type this server does not serve",
    category: "malformed packet",
    expect: "unknown_type",
    frame: frame("delete_everything", {}),
  },
  {
    name: "a client sending a server-only type",
    category: "malformed packet",
    expect: "unknown_type",
    frame: frame(MESSAGE_TYPES.blockApplied, {}),
  },
  {
    name: "a frame over the size limit",
    category: "malformed packet",
    expect: "packet_too_large",
    frame: frame("block_edit", { padding: "x".repeat(20_000) }),
  },

  // ── 2. out-of-bounds edits ─────────────────────────────────
  {
    name: "block x past the end of the chunk",
    category: "out-of-bounds edit",
    expect: "out_of_bounds",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: 16, y: 5, z: 0, block: "slate" }),
  },
  {
    name: "block x before the start of the chunk",
    category: "out-of-bounds edit",
    expect: "out_of_bounds",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: -1, y: 5, z: 0, block: "slate" }),
  },
  {
    name: "block z past the end of the chunk",
    category: "out-of-bounds edit",
    expect: "out_of_bounds",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: 0, y: 5, z: 16, block: "slate" }),
  },
  {
    name: "block below the world",
    category: "out-of-bounds edit",
    expect: "out_of_bounds",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: 0, y: -1, z: 0, block: "slate" }),
  },
  {
    name: "block above the world",
    category: "out-of-bounds edit",
    expect: "out_of_bounds",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: 0, y: 256, z: 0, block: "slate" }),
  },
  {
    name: "a chunk coordinate past the edge of the world",
    category: "out-of-bounds edit",
    expect: "out_of_bounds",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 100_000, cz: 0, x: 0, y: 5, z: 0, block: "slate" }),
  },
  {
    name: "a fractional block coordinate",
    category: "out-of-bounds edit",
    expect: "malformed_payload",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: 1.5, y: 5, z: 0, block: "slate" }),
  },
  {
    name: "a coordinate that is a string",
    category: "out-of-bounds edit",
    expect: "malformed_payload",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: "3", y: 5, z: 0, block: "slate" }),
  },
  {
    name: "a coordinate that is null",
    category: "out-of-bounds edit",
    expect: "malformed_payload",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: null, y: 5, z: 0, block: "slate" }),
  },
  {
    name: "a payload that is not an object",
    category: "out-of-bounds edit",
    expect: "malformed_payload",
    frame: frame(MESSAGE_TYPES.blockEdit, "slate"),
  },
  {
    name: "a payload with a field missing",
    category: "out-of-bounds edit",
    expect: "malformed_payload",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: 0, y: 5, block: "slate" }),
  },
  {
    name: "a payload with an extra field",
    category: "out-of-bounds edit",
    expect: "malformed_payload",
    frame: frame(MESSAGE_TYPES.blockEdit, {
      cx: 0, cz: 0, x: 0, y: 5, z: 0, block: "slate", extra: 1,
    }),
  },

  // ── 3. impossible block states ─────────────────────────────
  {
    name: "a block that is not a block kind",
    category: "impossible block state",
    expect: "unknown_block",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: 0, y: 5, z: 0, block: "unobtainium" }),
  },
  {
    name: "a block kind from another game",
    category: "impossible block state",
    expect: "unknown_block",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: 0, y: 5, z: 0, block: "stone" }),
  },
  {
    name: "a block that is a number",
    category: "impossible block state",
    expect: "unknown_block",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: 0, y: 5, z: 0, block: 7 }),
  },
  {
    name: "a block that is an object",
    category: "impossible block state",
    expect: "unknown_block",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: 0, y: 5, z: 0, block: { id: "slate" } }),
  },
  {
    name: "digging through the world floor",
    category: "impossible block state",
    expect: "immutable_bedrock",
    frame: frame(MESSAGE_TYPES.blockEdit, { cx: 0, cz: 0, x: 0, y: 0, z: 0, block: "air" }),
  },

  // ── 4. huge chunk requests ────────────────────────────────
  {
    name: "a chunk request for a hundred thousand chunks",
    category: "huge chunk request",
    expect: "chunk_request_too_large",
    frame: frame(MESSAGE_TYPES.chunkRequest, { cx: 0, cz: 0, radius: 100_000 }),
  },
  {
    name: "a chunk request for the whole world",
    category: "huge chunk request",
    expect: "chunk_request_too_large",
    frame: frame(MESSAGE_TYPES.chunkRequest, { cx: 0, cz: 0, radius: 1_000_000 }),
  },
  {
    name: "a chunk request with a negative radius",
    category: "huge chunk request",
    expect: "out_of_bounds",
    frame: frame(MESSAGE_TYPES.chunkRequest, { cx: 0, cz: 0, radius: -1 }),
  },
  {
    name: "a chunk request with a fractional radius",
    category: "huge chunk request",
    expect: "malformed_payload",
    frame: frame(MESSAGE_TYPES.chunkRequest, { cx: 0, cz: 0, radius: 0.5 }),
  },
  {
    name: "a chunk request past the edge of the world",
    category: "huge chunk request",
    expect: "out_of_bounds",
    frame: frame(MESSAGE_TYPES.chunkRequest, { cx: 999_999, cz: 0, radius: 1 }),
  },
  {
    name: "a chunk request with a missing radius",
    category: "huge chunk request",
    expect: "malformed_payload",
    frame: frame(MESSAGE_TYPES.chunkRequest, { cx: 0, cz: 0 }),
  },
];
