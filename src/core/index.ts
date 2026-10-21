/**
 * BlockForge — public core surface.
 *
 * OWNERSHIP: ARCHITECT. Agents import from `src/core/index.ts` rather than
 * reaching into individual core files, so the internal file layout can move
 * without breaking downstream imports. The exported NAMES are frozen.
 *
 * Import rules (enforced by the RED-TEAM agent's purity checks):
 *   - src/core/ may NOT import from src/engine, src/render, src/net,
 *     src/gameplay or server/
 *   - src/core/ may NOT import three, react, or any browser/DOM API
 *   - src/core/ may NOT use Math.random, Date.now or performance.now
 */
export * from "./types.js";
export * from "./constants.js";
export * from "./rng.js";
export * from "./noise.js";
export * from "./world.js";
export * from "./meshing.js";
export * from "./physics.js";
export * from "./raycast.js";
