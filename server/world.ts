/**
 * BlockForge — the server's authoritative world.
 *
 * OWNERSHIP: NETCODE.
 *
 * The server owns the only copy of the world that counts. A client's word
 * about the world is a REQUEST; this module holds the truth and changes it
 * only after `server/validation.ts` has said the request is legal.
 *
 * The world itself is `World` from `src/core/` — the same pure, deterministic
 * generator the client uses, so a chunk that was never edited is byte for
 * byte the chunk the client would have generated for itself.
 *
 * The coordinate mapping is the one thing worth stating out loud, because it
 * is where a wire protocol usually goes wrong:
 *
 *     a block edit names a CHUNK (cx, cz) and a position INSIDE that chunk
 *     (x, y, z), where x and z run 0..15 and y runs 0..255.
 *
 *     the world position of that block is therefore
 *         worldX = cx * 16 + x      worldY = y      worldZ = cz * 16 + z
 *
 * Both ends derive world coordinates the same way, and the mapping lives in
 * `src/net/protocol.ts` so it cannot drift apart.
 */

import { World } from "../src/core/index.js";
import { blockFromOrdinal } from "../src/core/world.js";
import type { BlockEditPayload, BlockId, WorldSnapshot } from "../src/core/types.js";
import type { ValidationResult } from "../src/net/protocol.js";
import { validateSnapshot } from "./validation.js";

/** A world built from a seed, with no edits applied yet. */
export function createWorld(seed: number): World {
  return new World(seed);
}

/**
 * Read a world out of save-file text.
 *
 * The text is parsed as JSON and then checked by `validateSnapshot`, so a
 * corrupt save is refused whole: the server never starts on half a world.
 */
export function worldFromSaveText(text: string): ValidationResult<World> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "save_corrupt", detail: "the save file is not valid JSON" };
  }

  const snapshot = validateSnapshot(parsed);
  if (!snapshot.ok) return snapshot;

  return { ok: true, value: World.fromSnapshot(snapshot.value) };
}

/**
 * Write a world out as save-file text.
 *
 * The blocks of a chunk are a plain array of numbers here, because that is
 * what JSON holds; `validateSnapshot` reads exactly this shape back.
 */
export function worldToSaveText(world: World): string {
  const snapshot: WorldSnapshot = world.snapshot();
  return JSON.stringify({
    schemaVersion: snapshot.schemaVersion,
    seed: snapshot.seed,
    season: snapshot.season,
    tick: snapshot.tick,
    chunks: snapshot.chunks.map((chunk) => ({
      key: { cx: chunk.key.cx, cz: chunk.key.cz },
      blocks: Array.from(chunk.blocks),
    })),
  });
}

/**
 * Apply an edit to the world.
 *
 * The caller has already validated the edit. The block is written into the
 * chunk it names, at the position inside that chunk.
 */
export function applyEdit(world: World, edit: BlockEditPayload): void {
  world.setBlockAt(
    edit.cx * 16 + edit.x,
    edit.y,
    edit.cz * 16 + edit.z,
    edit.block,
  );
}

/** The block bytes of one chunk, for sending to a client. */
export function chunkBlocks(world: World, cx: number, cz: number): Uint8Array {
  return world.getChunk({ cx, cz }).blocks;
}

/** The block at a world position, or undefined when the chunk is not loaded. */
export function blockAtWorld(
  world: World,
  worldX: number,
  worldY: number,
  worldZ: number,
): BlockId | undefined {
  const chunk = world.peekChunk({
    cx: Math.floor(worldX / 16),
    cz: Math.floor(worldZ / 16),
  });
  if (!chunk) return undefined;
  const localX = worldX - Math.floor(worldX / 16) * 16;
  const localZ = worldZ - Math.floor(worldZ / 16) * 16;
  const byte = chunk.blocks[localX + 16 * (localZ + 16 * worldY)];
  if (byte === undefined) return undefined;
  return blockFromOrdinal(byte);
}
