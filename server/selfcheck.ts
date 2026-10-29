/**
 * BlockForge — the server self-check.
 *
 * OWNERSHIP: NETCODE. Run it with:
 *
 *     npx tsc -p server/tsconfig.build.json
 *     node node_modules/.cache/blockforge-server/server/selfcheck.js
 *
 * It is the evidence that the server does what the brief says it does. It
 * fires every attack in `server/attacks.ts` at a LIVE server over a real
 * WebSocket and checks that:
 *
 *   1. the server answers with the reason the attack expects,
 *   2. the server does not answer with anything else, and
 *   3. the server is still alive and still serving afterwards.
 *
 * It also checks that a LEGAL edit is applied, that every client hears
 * about it, and that a damaged save file is refused whole.
 *
 * ALL THE ATTACKS SHARE ONE CONNECTION. The server must survive a whole
 * attack run on a single socket: a bad packet is refused, the connection
 * stays up, and the next packet is judged on its own merits. A server that
 * dropped the connection on the first bad packet would look fine to a
 * test that only sent one attack, and would hide every attack after it.
 *
 * Exit code 0 means every check passed. Non-zero means the server has a
 * hole, and the failing check is named on stdout.
 */

import { WebSocket } from "ws";
import { createServer } from "./server.js";
import { createWorld, worldFromSaveText, worldToSaveText } from "./world.js";
import { ATTACKS } from "./attacks.js";
import { MESSAGE_TYPES, encodeEnvelope } from "../src/net/protocol.js";
import { BlockId, type BlockEditPayload } from "../src/core/types.js";
import { NetClient } from "../src/net/client.js";

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

/** A client that collects the frames the server sends it. */
class TestClient {
  readonly received: { type: string; payload: unknown }[] = [];
  readonly socket: WebSocket;
  closed = false;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    // The handler goes on BEFORE the socket opens: the server greets a
    // client the moment it connects, and that frame must not be missed.
    this.socket.on("message", (data: unknown) => {
      const text = typeof data === "string" ? data : String(data);
      try {
        this.received.push(JSON.parse(text) as { type: string; payload: unknown });
      } catch {
        this.received.push({ type: "<unparseable>", payload: text });
      }
    });
    this.socket.on("close", () => {
      this.closed = true;
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once("open", () => resolve());
      this.socket.once("error", reject);
    });
  }

  /** Send a raw frame. */
  send(raw: string): void {
    this.socket.send(raw);
  }

  /** Wait until a frame matching `predicate` arrives, or time out. */
  async waitFor(
    predicate: (frame: { type: string; payload: unknown }) => boolean,
    timeoutMs = 3000,
  ): Promise<{ type: string; payload: unknown } | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (const frame of this.received) {
        if (predicate(frame)) return frame;
      }
      if (Date.now() > deadline) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  close(): void {
    this.socket.close();
  }
}

async function main(): Promise<void> {
  const world = createWorld(20261021);
  const server = createServer({ world, seed: 20261021 });
  const running = await server.listen(0, "127.0.0.1");
  const url = `ws://127.0.0.1:${running.port}`;
  console.log(`server listening on ${url}\n`);

  // ── the greeting ───────────────────────────────────────────
  const client = new TestClient(url);
  await client.open();
  const welcome = await client.waitFor((f) => f.type === MESSAGE_TYPES.welcome);
  check(
    "the server greets a new client with the seed",
    welcome !== undefined &&
      (welcome.payload as { seed?: number }).seed === 20261021,
    welcome === undefined ? "no welcome frame" : JSON.stringify(welcome.payload),
  );

  // ── every attack, all on the SAME connection ───────────────
  console.log(`\nattacking the server with ${ATTACKS.length} frames:\n`);
  for (const attack of ATTACKS) {
    const before = client.received.length;
    client.send(attack.frame);

    // Wait for the error frame that answers THIS attack, not one left over.
    const error = await client.waitFor(
      (f) =>
        f.type === MESSAGE_TYPES.error && client.received.indexOf(f) >= before,
    );

    const reason =
      error === undefined
        ? undefined
        : (error.payload as { reason?: string }).reason;

    check(
      `${attack.category}: ${attack.name}`,
      reason === attack.expect,
      reason === undefined
        ? "no error frame arrived"
        : `expected ${attack.expect}, got ${reason}`,
    );
  }

  // ── the server is still alive ──────────────────────────────
  console.log("\nchecking the server survived:\n");

  const alive = new TestClient(url);
  await alive.open();
  const secondWelcome = await alive.waitFor((f) => f.type === MESSAGE_TYPES.welcome);
  check(
    "the server still accepts new clients after the attacks",
    secondWelcome !== undefined,
  );

  // A legal edit is applied, and the client that made it hears about it.
  const listener = new TestClient(url);
  await listener.open();

  alive.send(
    encodeEnvelope(MESSAGE_TYPES.blockEdit, {
      cx: 0,
      cz: 0,
      x: 3,
      y: 70,
      z: 4,
      block: BlockId.Slate,
    }),
  );
  const applied = await alive.waitFor((f) => f.type === MESSAGE_TYPES.blockApplied);
  check(
    "a legal edit is applied and broadcast",
    applied !== undefined &&
      (applied.payload as { x?: number }).x === 3 &&
      (applied.payload as { block?: string }).block === BlockId.Slate,
    applied === undefined ? "no block_applied frame" : JSON.stringify(applied.payload),
  );

  // The other client hears about it too: the server broadcasts, not replies.
  const broadcast = await listener.waitFor((f) => f.type === MESSAGE_TYPES.blockApplied);
  check(
    "the edit is broadcast to the other client as well",
    broadcast !== undefined,
  );

  // The edit really landed in the server's world.
  const afterEdit = world.getBlockAt(3, 70, 4);
  check(
    "the legal edit really changed the server's world",
    afterEdit === BlockId.Slate,
    `world holds ${String(afterEdit)} at 3,70,4`,
  );

  // A legal chunk request is served.
  alive.send(
    encodeEnvelope(MESSAGE_TYPES.chunkRequest, { cx: 0, cz: 0, radius: 0 }),
  );
  const chunk = await alive.waitFor((f) => f.type === MESSAGE_TYPES.chunkData);
  check(
    "a legal chunk request is served",
    chunk !== undefined &&
      typeof (chunk.payload as { blocks?: string }).blocks === "string",
  );

  // A client that floods with legal edits is slowed down, not obeyed
  // forever. The budget is 64 in hand, so a burst has to exceed it.
  const flooder = new TestClient(url);
  await flooder.open();
  for (let i = 0; i < 200; i++) {
    flooder.send(
      encodeEnvelope(MESSAGE_TYPES.blockEdit, {
        cx: 0,
        cz: 0,
        x: i % 16,
        y: 70,
        z: 4,
        block: BlockId.Slate,
      }),
    );
  }
  const limited = await flooder.waitFor(
    (f) =>
      f.type === MESSAGE_TYPES.error &&
      (f.payload as { reason?: string }).reason === "rate_limited",
    5000,
  );
  check(
    "a client that floods with edits is rate limited",
    limited !== undefined,
  );
  flooder.close();

  // A damaged save file is refused whole.
  const goodSave = worldToSaveText(world);
  const corrupt = JSON.parse(goodSave) as {
    chunks: { key: { cx: number; cz: number }; blocks: number[] }[];
  };
  corrupt.chunks[0]!.blocks[0] = 200; // a byte that is not a block
  const refused = worldFromSaveText(JSON.stringify(corrupt));
  check(
    "a save file with a corrupt block byte is refused",
    !refused.ok && refused.reason === "save_corrupt",
    refused.ok ? "the corrupt save was accepted" : refused.reason,
  );

  const truncated = worldFromSaveText("{ not json");
  check(
    "a save file that is not JSON is refused",
    !truncated.ok && truncated.reason === "save_corrupt",
  );

  const wrongVersion = worldFromSaveText(
    JSON.stringify({ schemaVersion: 99, seed: 1, season: "green", tick: 0, chunks: [] }),
  );
  check(
    "a save file from another schema version is refused",
    !wrongVersion.ok && wrongVersion.reason === "save_schema_mismatch",
    wrongVersion.ok ? "the wrong-version save was accepted" : wrongVersion.reason,
  );

  // ── join proof: wire the T39 client slice (join -> edit -> sync back) ──
  (globalThis as unknown as { WebSocket?: typeof WebSocket }).WebSocket = WebSocket;
  let appliedEdit: BlockEditPayload | null = null;
  const joinClient = new NetClient({
    url,
    events: {
      onWelcome: () => { joinClient.requestChunks(0, 0, 1); },
      onChunk: () => {},
      onBlockApplied: (e) => { appliedEdit = e as BlockEditPayload; },
      onError: () => {},
      onClose: () => {},
    },
  });
  await new Promise<void>((res) => {
    const iv = setInterval(() => {
      if (joinClient.isOpen) { clearInterval(iv); res(); }
    }, 20);
  });
  joinClient.requestEdit({ cx: 0, cz: 0, x: 3, y: 70, z: 4, block: BlockId.Timber });
  const joinStart = Date.now();
  while (!appliedEdit && Date.now() - joinStart < 3000) {
    await new Promise((r) => setTimeout(r, 20));
  }
  check(
    "join flow: client receives block_applied after edit",
    appliedEdit !== null && (appliedEdit as BlockEditPayload).block === BlockId.Timber,
    appliedEdit === null ? "no block_applied" : `got block=${(appliedEdit as BlockEditPayload).block}`,
  );
  const afterJoin = world.getBlockAt(3, 70, 4);
  check(
    "join flow: server world reflects the client edit",
    afterJoin === BlockId.Timber,
    `world holds ${String(afterJoin)} at 3,70,4`,
  );
  joinClient.close();

  alive.close();
  listener.close();
  await running.close();

  console.log(
    `\n${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED` : ""}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("self-check crashed:", error);
  process.exit(1);
});
