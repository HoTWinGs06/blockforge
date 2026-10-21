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

import { installConsoleGuard } from "./render/index.js";
import { EngineWorld } from "./render/engineBridge.js";

export function boot(): void {
  // Install the console guard BEFORE the WebGL context is created, so the
  // driver's own performance chatter never reaches the console stream that
  // the G2 gate asserts on. Real errors are never filtered.
  installConsoleGuard();

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (!canvas) {
    throw new Error("canvas #game not found");
  }
  void import("./main.js").then(({ mountGame }) => {
    const game = mountGame(canvas, new EngineWorld());

    // A TESTING SEAM, and only in the dev build.
    //
    // The browser tests need to do two things a player does with the mouse:
    // look DOWN at the ground, and HOLD a button for a fixed time. Neither is
    // reachable in a headless browser - the game looks at the horizon by
    // default, and pointer lock is not available. Rather than let the tests
    // reach into private state, the game exposes the SAME public methods the
    // input handlers call, so a test can perform the player's action rather
    // than poke at the game's internals.
    //
    // GATED BEHIND import.meta.env.DEV, so the published game has no debug
    // backdoor. The e2e job runs against the dev server (Playwright starts
    // Vite itself), so DEV is true there and the handle exists; a production
    // build has DEV false and no handle. That is stated in
    // playwright.config.ts rather than left implicit.
    if (import.meta.env.DEV) {
      (window as unknown as { __blockforge?: unknown }).__blockforge = game.handle;
    }
  });
}

boot();
