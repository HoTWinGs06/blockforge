/**
 * BlockForge — client sync.
 *
 * OWNERSHIP: NETCODE.
 *
 * The client half of the wire protocol. `src/core/` is pure and stays pure;
 * this layer is allowed to touch the network, and it does.
 *
 * WHAT IT DOES
 * ------------
 * A `NetClient` connects to a server, asks for the chunks it needs, and
 * keeps its local copy of the world in step with the server's. The server is
 * the authority, so the client's own edits are REQUESTS: it sends them and
 * waits for the server to say they were applied. An edit the server refuses
 * never reaches the local world.
 *
 * WHY THE CLIENT CAN TRUST THE WORLD IT BUILDS
 * ---------------------------------------------
 * The client generates the same terrain the server holds, from the same seed,
 * using the same pure generator in `src/core/`. So a chunk that nobody has
 * edited is already correct on both sides, byte for byte, and needs no
 * transfer at all. Only chunks the server has EDITED are worth asking about.
 * The server still sends whole chunks - simpler to reason about, and it
 * means a client that missed a broadcast can catch up.
 *
 * This module does not touch the DOM directly; it takes a socket-like
 * object, so it can be driven by a browser `WebSocket` or by a test double.
 */

import type { BlockEditPayload, BlockId, ChunkKey } from "../core/types.js";
import {
  ALL_BLOCK_IDS,
  blockIdToByte,
  byteToBlockId,
  isValidBlockByte,
} from "../core/types.js";
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z, chunkKeyToString } from "../core/constants.js";
import {
  MESSAGE_TYPES,
  decodeBlockBytes,
  encodeEnvelope,
  parseServerEnvelope,
  type ChunkRequestPayload,
  type ErrorPayload,
  type MessageType,
  type WelcomePayload,
} from "./protocol.js";

/**
 * The bit of a WebSocket this module needs.
 *
 * Narrowing it to this keeps the module testable without a browser and
 * without a network: a test passes a double that records what was sent.
 */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** What the client tells the caller about. */
export interface NetClientEvents {
  /** The server's greeting arrived; it carries the world seed. */
  onWelcome?(payload: WelcomePayload): void;
  /** A chunk of blocks arrived. */
  onChunk?(payload: { cx: number; cz: number; blocks: Uint8Array }): void;
  /** The server applied an edit - ours or another client's. */
  onBlockApplied?(payload: BlockEditPayload): void;
  /** The server refused something. */
  onError?(payload: ErrorPayload): void;
  /** The connection closed. */
  onClose?(): void;
}

export interface NetClientOptions {
  /** Where to connect. */
  readonly url: string;
  /** The socket to use. Defaults to a global `WebSocket`. */
  readonly socket?: SocketLike;
  readonly events?: NetClientEvents;
}

/**
 * The client's view of the world.
 *
 * A plain map of chunk key to block bytes. Chunks the server has not sent
 * are simply absent, and the caller decides what that means (the client
 * generates its own terrain from the seed; the server does not need to).
 */
export class ClientWorld {
  private readonly chunks = new Map<string, Uint8Array>();

  /** Store a chunk's blocks. */
  setChunk(cx: number, cz: number, blocks: Uint8Array): void {
    this.chunks.set(chunkKeyToString({ cx, cz }), blocks);
  }

  /** True when the chunk is known. */
  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKeyToString({ cx, cz }));
  }

  /**
   * Apply an edit to a chunk this client already holds.
   *
   * Returns false when the chunk is not here: an edit for a chunk we have
   * never received is not lost, it is simply not ours to apply yet. The
   * server still holds it, and the chunk will arrive whole.
   *
   * Returns false for an edit that names no real block, too. The server is
   * trusted, but a client that crashes on a bad frame is a client that
   * takes the page down with it.
   */
  applyEdit(edit: BlockEditPayload): boolean {
    if (!ALL_BLOCK_IDS.includes(edit.block)) return false;
    if (
      !Number.isInteger(edit.x) ||
      !Number.isInteger(edit.y) ||
      !Number.isInteger(edit.z) ||
      edit.x < 0 ||
      edit.x >= CHUNK_SIZE_X ||
      edit.z < 0 ||
      edit.z >= CHUNK_SIZE_Z ||
      edit.y < 0 ||
      edit.y >= CHUNK_SIZE_Y
    ) {
      return false;
    }

    const blocks = this.chunks.get(chunkKeyToString({ cx: edit.cx, cz: edit.cz }));
    if (!blocks) return false;
    const index = edit.x + CHUNK_SIZE_X * (edit.z + CHUNK_SIZE_Z * edit.y);
    blocks[index] = blockIdToByte(edit.block);
    return true;
  }

  /** The block at a chunk-local position, or undefined when unknown. */
  blockAt(cx: number, cz: number, x: number, y: number, z: number): BlockId | undefined {
    const blocks = this.chunks.get(chunkKeyToString({ cx, cz }));
    if (!blocks) return undefined;
    const index = x + CHUNK_SIZE_X * (z + CHUNK_SIZE_Z * y);
    const byte = blocks[index];
    if (byte === undefined || !isValidBlockByte(byte)) return undefined;
    return byteToBlockId(byte);
  }
}

/**
 * The client side of the wire protocol.
 *
 * Send an edit with `requestEdit`; it comes back as `onBlockApplied` if the
 * server accepted it, or as `onError` if the server refused it.
 */
export class NetClient {
  /** The client's copy of the world. */
  readonly world = new ClientWorld();

  private readonly socket: SocketLike;
  private readonly events: NetClientEvents;
  private opened = false;

  constructor(options: NetClientOptions) {
    this.events = options.events ?? {};
    this.socket = options.socket ?? (createBrowserSocket(options.url));
    this.attach();
  }

  /** True once the socket is open. */
  get isOpen(): boolean {
    return this.opened;
  }

  /** Ask the server for the chunks around a point. */
  requestChunks(cx: number, cz: number, radius = 1): void {
    const payload: ChunkRequestPayload = { cx, cz, radius };
    this.send(MESSAGE_TYPES.chunkRequest, payload);
  }

  /**
   * Ask the server to apply an edit.
   *
   * This does NOT change the local world. The world changes when the server
   * says so, in `onBlockApplied`, because the server is the authority.
   */
  requestEdit(edit: BlockEditPayload): void {
    this.send(MESSAGE_TYPES.blockEdit, {
      cx: edit.cx,
      cz: edit.cz,
      x: edit.x,
      y: edit.y,
      z: edit.z,
      block: edit.block,
    });
  }

  /** Close the connection. */
  close(): void {
    this.socket.close(1000, "client closing");
  }

  private send(type: MessageType, payload: unknown): void {
    if (!this.opened) return;
    this.socket.send(encodeEnvelope(type, payload));
  }

  private attach(): void {
    this.socket.onopen = () => {
      this.opened = true;
    };
    this.socket.onmessage = (event: { data: unknown }) => {
      this.handleMessage(event.data);
    };
    this.socket.onclose = () => {
      this.opened = false;
      this.events.onClose?.();
    };
    this.socket.onerror = () => {
      this.opened = false;
    };
  }

  private handleMessage(data: unknown): void {
    const raw = typeof data === "string" ? data : String(data);
    const envelope = parseServerEnvelope(raw);
    if (!envelope.ok) {
      this.events.onError?.(
        envelope.detail === undefined
          ? { reason: envelope.reason }
          : { reason: envelope.reason, detail: envelope.detail },
      );
      return;
    }

    const { type, payload } = envelope.value;

    if (type === MESSAGE_TYPES.welcome) {
      this.events.onWelcome?.(payload as WelcomePayload);
      return;
    }

    if (type === MESSAGE_TYPES.chunkData) {
      const chunk = payload as { cx?: unknown; cz?: unknown; blocks?: unknown };
      if (
        typeof chunk.blocks !== "string" ||
        typeof chunk.cx !== "number" ||
        typeof chunk.cz !== "number"
      ) {
        this.events.onError?.({
          reason: "malformed_payload",
          detail: "chunk_data payload is not a chunk",
        });
        return;
      }
      let blocks: Uint8Array;
      try {
        blocks = decodeBlockBytes(chunk.blocks);
      } catch {
        this.events.onError?.({
          reason: "malformed_payload",
          detail: "chunk_data payload is not valid base64",
        });
        return;
      }
      this.world.setChunk(chunk.cx, chunk.cz, blocks);
      this.events.onChunk?.({ cx: chunk.cx, cz: chunk.cz, blocks });
      return;
    }

    if (type === MESSAGE_TYPES.blockApplied) {
      const edit = payload as BlockEditPayload;
      this.world.applyEdit(edit);
      this.events.onBlockApplied?.(edit);
      return;
    }

    if (type === MESSAGE_TYPES.error) {
      this.events.onError?.(payload as ErrorPayload);
    }
  }
}

/**
 * Open a socket to the server using the environment's `WebSocket`.
 *
 * Browser: the global one. Node: the global one too, since Node 22. A
 * missing `WebSocket` is a clear error rather than a silent no-op.
 */
function createBrowserSocket(url: string): SocketLike {
  const ctor = (globalThis as { WebSocket?: new (url: string) => SocketLike })
    .WebSocket;
  if (!ctor) {
    throw new Error("no WebSocket in this environment");
  }
  return new ctor(url);
}

/** The chunk a world position falls in. */
export function chunkKeyFor(worldX: number, worldZ: number): ChunkKey {
  return {
    cx: Math.floor(worldX / CHUNK_SIZE_X),
    cz: Math.floor(worldZ / CHUNK_SIZE_Z),
  };
}
