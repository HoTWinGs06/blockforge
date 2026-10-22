/**
 * BlockForge — the network layer's public surface.
 *
 * OWNERSHIP: NETCODE.
 *
 * The protocol is shared between the client and the server, so it lives in
 * one file that both import. See `protocol.ts` for the wire format and
 * `client.ts` for the client half.
 *
 * The server imports `protocol.ts` directly rather than this barrel: the
 * server is node code and must not drag the browser client in with it.
 */

export * from "./protocol.js";
export * from "./client.js";
