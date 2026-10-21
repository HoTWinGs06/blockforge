/**
 * BlockForge — the multiplayer server.
 *
 * OWNERSHIP: NETCODE.
 *
 * A WebSocket server (the `ws` library, pinned at 8.22.0) speaking versioned
 * JSON. Every frame in both directions is a `ProtocolEnvelope`:
 *
 *     { protocolVersion: 1, type: "...", payload: ... }
 *
 * THE SERVER IS AUTHORITATIVE. A client may ASK for a chunk and ASK to change
 * a block. The server decides whether the ask is legal, applies it to the one
 * world that counts, and tells every client what happened. A client that
 * edits its own copy without the server's word is just wrong.
 *
 * THE CONTRACT WITH THE RED TEAM
 * ------------------------------
 * Every rejection is an `error` envelope with a stable `reason`, drawn from
 * the closed list in `src/net/protocol.ts`. The rules that produce them live
 * in `server/validation.ts` and are pure functions, so a test can call them
 * directly as well as over a socket.
 *
 * The server NEVER crashes on a hostile packet. Every message goes through a
 * try/catch, and a failure that slips past the rules comes back as an
 * `internal_error` envelope rather than taking the process down.
 */

import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { World } from "../src/core/index.js";
import type { BlockEditPayload } from "../src/core/types.js";
import {
  MESSAGE_TYPES,
  encodeBlockBytes,
  encodeEnvelope,
  parseClientEnvelope,
  type ChunkRequestPayload,
  type ErrorPayload,
  type MessageType,
  type RejectReason,
} from "../src/net/protocol.js";
import { validateBlockEdit, validateChunkRequest } from "./validation.js";
import { applyEdit, chunkBlocks } from "./world.js";

/** How a client may spend edits. */
export interface EditBudget {
  /** How many edits a client may have in hand at once. */
  readonly capacity: number;
  /** How many edits it gets back per second. */
  readonly refillPerSecond: number;
}

/**
 * The default budget: fast enough to play, slow enough to stop a flood.
 *
 * The numbers are deliberately generous. A rate limit that trips during
 * ordinary play is a bug, not a feature, so the bucket is big enough for a
 * burst of digging and only stops a client that is hammering.
 */
export const DEFAULT_EDIT_BUDGET: EditBudget = {
  capacity: 64,
  refillPerSecond: 32,
};

export interface ServerOptions {
  /** The world this server is the authority for. */
  readonly world: World;
  /** The seed that world was built from; clients are told so they can match. */
  readonly seed: number;
  /** The edit budget. Pass `capacity: 0` to switch the limiter off. */
  readonly editBudget?: EditBudget;
}

export interface RunningServer {
  /** The port the server is listening on. */
  readonly port: number;
  /** Stop listening and drop every client. */
  close(): Promise<void>;
}

/**
 * A token bucket over the edits a client may apply.
 *
 * The bucket is only consulted for an edit that PASSED validation. A packet
 * that breaks a rule is refused on its own merits first, with its own
 * reason, so every rejection of a bad edit is deterministic: a red-team test
 * that fires a hundred invalid edits always gets the same hundred reasons,
 * whatever the timing.
 */
class EditBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly budget: EditBudget,
    private readonly now: () => number,
  ) {
    this.tokens = budget.capacity;
    this.lastRefill = now();
  }

  /** True when an edit may be applied right now. */
  take(): boolean {
    if (this.budget.capacity === 0) return true;

    const now = this.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(
        this.budget.capacity,
        this.tokens + (elapsed / 1000) * this.budget.refillPerSecond,
      );
      this.lastRefill = now;
    }

    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Per-connection state. The edit budget is per client, not per server. */
interface ClientState {
  readonly socket: WebSocket;
  readonly bucket: EditBucket;
}

/**
 * Create a server. It does not listen until `listen` is called.
 *
 * The HTTP server is created here rather than by `ws` so the listening port
 * is ours to report - a test binds port 0 and asks the OS for a free one.
 */
export function createServer(options: ServerOptions): {
  listen(port: number, host?: string): Promise<RunningServer>;
} {
  const budget = options.editBudget ?? DEFAULT_EDIT_BUDGET;
  const clients = new Set<ClientState>();

  const httpServer: HttpServer = createHttpServer();
  const wss = new WebSocketServer({
    server: httpServer,
    // Four times the protocol's own packet limit, so an oversized frame is
    // refused by the protocol (with a reason) rather than by the transport.
    maxPayload: 64 * 1024,
  });

  const send = (socket: WebSocket, type: MessageType, payload: unknown): void => {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(encodeEnvelope(type, payload));
  };

  const sendError = (
    socket: WebSocket,
    reason: RejectReason,
    detail?: string,
  ): void => {
    const payload: ErrorPayload =
      detail === undefined ? { reason } : { reason, detail };
    send(socket, MESSAGE_TYPES.error, payload);
  };

  /** Send a chunk's blocks to one client. */
  const sendChunk = (socket: WebSocket, cx: number, cz: number): void => {
    const blocks = chunkBlocks(options.world, cx, cz);
    send(socket, MESSAGE_TYPES.chunkData, {
      cx,
      cz,
      blocks: encodeBlockBytes(blocks),
    });
  };

  /** Tell every client, including the one that made the edit. */
  const broadcastEdit = (edit: BlockEditPayload): void => {
    for (const client of clients) {
      send(client.socket, MESSAGE_TYPES.blockApplied, edit);
    }
  };

  const handleChunkRequest = (
    client: ClientState,
    payload: ChunkRequestPayload,
  ): void => {
    for (let dz = -payload.radius; dz <= payload.radius; dz++) {
      for (let dx = -payload.radius; dx <= payload.radius; dx++) {
        sendChunk(client.socket, payload.cx + dx, payload.cz + dz);
      }
    }
  };

  const handleBlockEdit = (client: ClientState, payload: unknown): void => {
    const verdict = validateBlockEdit(payload);
    if (!verdict.ok) {
      sendError(client.socket, verdict.reason, verdict.detail);
      return;
    }
    if (!client.bucket.take()) {
      sendError(client.socket, "rate_limited", "too many edits");
      return;
    }

    applyEdit(options.world, verdict.value);
    broadcastEdit(verdict.value);
  };

  wss.on("connection", (socket: WebSocket) => {
    const client: ClientState = {
      socket,
      bucket: new EditBucket(budget, () => Date.now()),
    };
    clients.add(client);

    // The client needs the seed to generate the same terrain we hold.
    send(socket, MESSAGE_TYPES.welcome, { seed: options.seed });

    socket.on("message", (data: unknown, isBinary: boolean) => {
      try {
        if (isBinary) {
          sendError(socket, "malformed_packet", "binary frames are not accepted");
          return;
        }
        const raw = typeof data === "string" ? data : String(data);
        const envelope = parseClientEnvelope(raw);
        if (!envelope.ok) {
          sendError(socket, envelope.reason, envelope.detail);
          // A version mismatch does NOT close the connection. The server
          // refuses the packet and says why, and the client may go on to
          // ask for something the server does understand. Dropping the
          // socket would also mean one bad packet could hide every packet
          // after it, which is exactly what a test suite must not be
          // robbed of.
          return;
        }

        if (envelope.value.type === MESSAGE_TYPES.chunkRequest) {
          const request = validateChunkRequest(envelope.value.payload);
          if (!request.ok) {
            sendError(socket, request.reason, request.detail);
            return;
          }
          handleChunkRequest(client, request.value);
          return;
        }

        if (envelope.value.type === MESSAGE_TYPES.blockEdit) {
          handleBlockEdit(client, envelope.value.payload);
          return;
        }

        sendError(socket, "unknown_type", envelope.value.type);
      } catch (error) {
        // Nothing a client sends may take the server down.
        sendError(
          socket,
          "internal_error",
          error instanceof Error ? error.message : String(error),
        );
      }
    });

    socket.on("close", () => {
      clients.delete(client);
    });
    socket.on("error", () => {
      clients.delete(client);
    });
  });

  return {
    listen(port: number, host?: string): Promise<RunningServer> {
      return new Promise((resolve, reject) => {
        const onError = (error: Error): void => {
          httpServer.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          httpServer.off("error", onError);
          const address = httpServer.address();
          const bound =
            typeof address === "object" && address !== null ? address.port : port;
          resolve({
            port: bound,
            close(): Promise<void> {
              for (const client of clients) {
                client.socket.terminate();
              }
              clients.clear();
              return new Promise((done) => {
                wss.close(() => {
                  httpServer.close(() => done());
                });
              });
            },
          });
        };
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        if (host === undefined) {
          httpServer.listen(port);
        } else {
          httpServer.listen(port, host);
        }
      });
    },
  };
}
