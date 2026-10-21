/**
 * BlockForge — view distance.
 *
 * The fog distances and the chunk radius live together in one place because
 * they MUST agree: the fog has to fade out before the edge of the loaded
 * region, or the player sees the boundary of the world instead of sky.
 *
 * They live in their own module rather than in renderer.ts because both the
 * renderer and the sky need them, and a shared constant that creates a
 * circular import between two modules is a runtime "cannot access before
 * initialisation" error rather than a compile error.
 */

/** How many chunks are kept meshed, in each direction, around the player. */
export const VIEW_RADIUS_CHUNKS = 4;

/** How many blocks wide a chunk is. Mirrors CHUNK_SIZE_X / CHUNK_SIZE_Z. */
export const CHUNK_BLOCKS = 16;

/** How far the player can see before the fog starts. */
export const FOG_NEAR = 28;

/** Where the fog fully hides the world. */
export const FOG_FAR = 60;

/**
 * The furthest the loaded region reaches, in blocks.
 *
 * Used to sanity-check that the fog is pulled in behind the boundary.
 */
export const VIEW_RADIUS_BLOCKS = VIEW_RADIUS_CHUNKS * CHUNK_BLOCKS;
