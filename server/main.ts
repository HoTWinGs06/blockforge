/**
 * BlockForge — run the server.
 *
 * OWNERSHIP: NETCODE. Run it with:
 *
 *     npx tsc -p server/tsconfig.build.json
 *     node node_modules/.cache/blockforge-server/server/main.js [port] [seed]
 *
 * The port defaults to 8787 and the seed to 1. The same seed always gives
 * the same world, so two servers started with the same seed hold the same
 * terrain.
 */

import { createServer } from "./server.js";
import { createWorld } from "./world.js";

const port = Number(process.argv[2] ?? 8787);
const seed = Number(process.argv[3] ?? 1);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`not a port: ${process.argv[2] ?? ""}`);
  process.exit(2);
}
if (!Number.isInteger(seed)) {
  console.error(`not a seed: ${process.argv[3] ?? ""}`);
  process.exit(2);
}

const world = createWorld(seed);
const server = createServer({ world, seed });

server
  .listen(port)
  .then((running) => {
    console.log(`blockforge server on port ${running.port}, seed ${seed}`);
  })
  .catch((error: unknown) => {
    console.error("could not start the server:", error);
    process.exit(1);
  });
