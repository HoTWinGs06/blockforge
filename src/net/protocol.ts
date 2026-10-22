/**
 * BlockForge — the wire protocol, version 1.
 *
 * OWNERSHIP: NETCODE. This is the ONLY description of the bytes on the wire.
 * Both ends import it: the browser client (`src/net/client.ts`) and the node
 * server (`server/`). The server is authoritative, so everything here is
 * written from the SERVER's point of view: what a client may say, and what
 * the server says back when it says no.
 *
 * The frozen contract (`src/core/types.ts`) owns the envelope shape
 * (`ProtocolEnvelope`, `BlockEditPayload`) and `PROTOCOL_VERSION`. This module
 * adds the vocabulary around it: message names, the reason codes a rejection
 * carries, and the codec.
 *
 * PURE: no DOM, no node builtins, no network. It has to run in a browser tab
 * and in the server process, so it may not touch either environment.
 *
 * LAYERING: `src/net/` may import `src/core/`, and `server/` may import
 * `src/core/`. This file is imported by BOTH, which puts `src/net/` and
 * `server/` in a peer relationship that the layer table does not spell out.
 * The architect has been asked to rule on it (see docs/handoffs/netcode.md).
 * The mitigation is that this module imports nothing but `src/core/`, so if
 * the ruling is "move it down", the move is a two-line import change.
 */

import { PROTOCOL_VERSION } from "../core/types.js";
import type { ProtocolEnvelope } from "../core/types.js";

// ── limits ────────────────────────────────────────────────────

/**
 * Largest inbound packet the server will look at, in characters.
 *
 * A legitimate packet is a few dozen bytes. Anything larger is rejected
 * with a reason rather than parsed, so a flood of huge packets costs the
 * server a length check, not a JSON parse of a megabyte.
 */
export const MAX_PACKET_BYTES = 16 * 1024;

/** Furthest chunk coordinate the world covers, in chunks from the origin. */
export const MAX_CHUNK_COORD = 1024;

/** Widest chunk-request radius the server honours, in chunks. */
export const MAX_CHUNK_RADIUS = 2;

/** Most chunks one request may ask for. */
export const MAX_CHUNKS_PER_REQUEST = (2 * MAX_CHUNK_RADIUS + 1) ** 2;

// ── message vocabulary ─────────────────────────────────────────

/**
 * The message names, both directions.
 *
 * `chunk_request` and `block_edit` travel client to server. `chunk_data`,
 * `block_applied` and `error` travel server to client. `block_applied` is
 * broadcast to every client, including the one that sent the edit, so that
 * all clients converge on the server's version of the world.
 */
export const MESSAGE_TYPES = {
  welcome: "welcome",
  chunkRequest: "chunk_request",
  chunkData: "chunk_data",
  blockEdit: "block_edit",
  blockApplied: "block_applied",
  error: "error",
} as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

/** Message names a client may send. */
export const CLIENT_MESSAGE_TYPES: readonly MessageType[] = [
  MESSAGE_TYPES.chunkRequest,
  MESSAGE_TYPES.blockEdit,
];

/** Message names a server may send. */
export const SERVER_MESSAGE_TYPES: readonly MessageType[] = [
  MESSAGE_TYPES.welcome,
  MESSAGE_TYPES.chunkData,
  MESSAGE_TYPES.blockApplied,
  MESSAGE_TYPES.error,
];

/**
 * The server's greeting.
 *
 * The client needs the seed so it can generate the same terrain the server
 * holds, byte for byte, before the first chunk arrives.
 */
export interface WelcomePayload {
  readonly seed: number;
}

/** Client asks for the chunks in a square around a point. */
export interface ChunkRequestPayload {
  readonly cx: number;
  readonly cz: number;
  /** Chunk radius: the request covers (2 * radius + 1) squared chunks. */
  readonly radius: number;
}

/**
 * One chunk of blocks.
 *
 * `blocks` is the chunk's block bytes, base64 encoded. JSON has no byte
 * array, and base64 is a third of the size of a JSON number array, so a
 * chunk costs about 87 KB on the wire instead of 250 KB.
 */
export interface ChunkDataPayload {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: string;
}

/** The server says no, and says why. */
export interface ErrorPayload {
  readonly reason: RejectReason;
  /** Optional human-readable detail. Never required, never load-bearing. */
  readonly detail?: string;
}

// ── rejection vocabulary ───────────────────────────────────────

/**
 * Every way the server can refuse a client.
 *
 * The list is closed on purpose: a rejection always carries one of these,
 * so a client (and the red team) can tell "the server refused" from "the
 * server broke". The wire reasons come from parsing; the rest come from the
 * server-authoritative rules in `server/validation.ts`.
 */
export type RejectReason =
  // wire level
  | "malformed_json"
  | "not_an_object"
  | "malformed_envelope"
  | "malformed_packet"
  | "protocol_version_mismatch"
  | "missing_type"
  | "unknown_type"
  | "packet_too_large"
  // payload level
  | "malformed_payload"
  | "out_of_bounds"
  | "unknown_block"
  | "immutable_bedrock"
  | "chunk_request_too_large"
  | "rate_limited"
  // save file level
  | "save_corrupt"
  | "save_schema_mismatch"
  // last resort
  | "internal_error";

/** A check that either produces a value or explains why it refused. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: RejectReason; readonly detail?: string };

export function accept<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

export function refuse(
  reason: RejectReason,
  detail?: string,
): ValidationResult<never> {
  // exactOptionalPropertyTypes: only add `detail` when there is one.
  return detail === undefined
    ? { ok: false, reason }
    : { ok: false, reason, detail };
}

// ── codec ──────────────────────────────────────────────────────

/** Serialise a message into a wire frame. */
export function encodeEnvelope(type: MessageType, payload: unknown): string {
  const envelope: ProtocolEnvelope = {
    protocolVersion: PROTOCOL_VERSION,
    type,
    payload,
  };
  return JSON.stringify(envelope);
}

/**
 * Parse a frame into an envelope.
 *
 * Checks, in this order, and stops at the first failure: the bytes are
 * JSON, the JSON is an object, the object has exactly the three envelope
 * fields, the version matches, and the type is a name we know. The result
 * never throws — every failure is a `refuse`.
 */
function parseEnvelope(
  raw: string,
  allowed: readonly MessageType[],
): ValidationResult<ProtocolEnvelope> {
  if (raw.length > MAX_PACKET_BYTES) {
    return refuse("packet_too_large", `${raw.length} characters`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse("malformed_json");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return refuse("not_an_object");
  }

  const candidate = parsed as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (
    keys.length !== 3 ||
    !("protocolVersion" in candidate) ||
    !("type" in candidate) ||
    !("payload" in candidate)
  ) {
    return refuse("malformed_envelope", `keys: ${keys.sort().join(",")}`);
  }

  if (candidate["protocolVersion"] !== PROTOCOL_VERSION) {
    return refuse(
      "protocol_version_mismatch",
      `expected ${String(PROTOCOL_VERSION)}, got ${String(candidate["protocolVersion"])}`,
    );
  }

  const type = candidate["type"];
  if (typeof type !== "string" || type.length === 0) {
    return refuse("missing_type");
  }
  if (!allowed.includes(type as MessageType)) {
    return refuse("unknown_type", type);
  }

  return accept(candidate as unknown as ProtocolEnvelope);
}

/** Parse a frame that arrived from a client. */
export function parseClientEnvelope(raw: string): ValidationResult<ProtocolEnvelope> {
  return parseEnvelope(raw, CLIENT_MESSAGE_TYPES);
}

/** Parse a frame that arrived from the server. */
export function parseServerEnvelope(raw: string): ValidationResult<ProtocolEnvelope> {
  return parseEnvelope(raw, SERVER_MESSAGE_TYPES);
}

// ── block bytes ────────────────────────────────────────────────

/**
 * Encode block bytes as base64.
 *
 * `btoa` takes a binary string, one character per byte, so the bytes are
 * stringified in slices: `String.fromCharCode(...bytes)` with 65 536
 * arguments blows the call stack.
 */
export function encodeBlockBytes(bytes: Uint8Array): string {
  const SLICE = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  }
  return btoa(binary);
}

/** Decode block bytes from base64. */
export function decodeBlockBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
