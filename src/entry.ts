/**
 * BlockForge — application entry point.
 *
 * Boots the game against the ENGINE's real world. The temporary development
 * stand-in (src/dev/world.ts) is gone: this file replaces it.
 *
 * The renderer consumes the engine through src/render/engineBridge.ts, which
 * adapts the engine's ChunkStore to the render layer's own seam. Nothing in
 * src/core/ or src/engine/ is modified by the render side.
 */

import { installConsoleGuard } from "../render/index.js";
import { EngineWorld } from "../render/engineBridge.js";

export function boot(): void {
  // Install the console guard BEFORE the WebGL context is created, so the
  // driver's own performance chatter never reaches the console stream that
  // the G2 gate asserts on. Real errors are never filtered.
  installConsoleGuard();

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (!canvas) {
    throw new Error("canvas #game not found");
  }
  void import("../main.js").then(({ mountGame }) => {
    mountGame(canvas, new EngineWorld());
  });
}

boot();
