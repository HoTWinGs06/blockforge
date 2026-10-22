/**
 * BlockForge — the crafting module's public surface.
 *
 * OWNERSHIP: GAMEPLAY. Pure: no DOM, no clock, no randomness.
 *
 * The rest of the project imports from here rather than from the files
 * inside, so the internals can move without breaking anyone.
 *
 * NOTE FOR THE ARCHITECT: `src/core/index.ts` is the project's core barrel
 * and is owned by the ARCHITECT, so this module is not re-exported from
 * it yet. One line in that file -
 *
 *   export * from "./crafting/index.js";
 *
 * - would put the crafting surface in the main barrel with the rest of the
 * core API. Until then, import it as `../core/crafting/index.js`.
 */

export * from "./grid.js";
export * from "./match.js";
export * from "./recipes.js";
export * from "./tags.js";
