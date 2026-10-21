/**
 * BlockForge — render layer barrel.
 *
 * Everything that touches Three.js, the DOM, canvas or WebAudio lives under
 * src/render/. src/core must never import from here.
 */

export { WorldRenderer, buildChunkMesh, chunkKeyOf, withinWorld, REACH_DISTANCE } from "./renderer.js";
export type { ChunkMesh } from "./renderer.js";
export { Hud, blockLabel } from "./hud.js";
export type { HudState, HudHotbarSlot } from "./hud.js";
export { SoundBoard } from "./audio.js";
export type { SoundName } from "./audio.js";
export { buildAtlasCanvas, getAtlasTexture, faceUv, tileIndex, atlasSize, TILE_PX } from "./textures.js";
