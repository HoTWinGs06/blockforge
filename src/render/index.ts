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
export { installConsoleGuard, HEADLESS_CHROMIUM_ARGS } from "./consoleGuard.js";
export { buildSky, buildSkyCanvas } from "./sky.js";
export { CloudLayer } from "./clouds.js";
export { startMusic, stopMusic, isMusicPlaying } from "./music.js";
export { VIEW_RADIUS_CHUNKS, VIEW_RADIUS_BLOCKS, FOG_NEAR, FOG_FAR } from "./viewDistance.js";
export { TitleScreen } from "./titleScreen.js";
