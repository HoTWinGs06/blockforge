/**
 * T74/T75 guard: clouds and background music.
 *
 * These are the two features this agent added, and the two rules that are
 * easy to break later:
 *
 *   T74 CLOUDS - placement comes from the WORLD SEED, so two players in
 *     the same world see the same clouds and a recorded world looks the
 *     same twice. The drift is a function of a tick counter, not a fresh
 *     random draw.
 *
 *   T75 MUSIC - the AudioContext is created only after a user gesture, and
 *     the graph is built without an error.
 *
 * This file is in e2e/ and belongs to this agent; it does not touch the
 * suites the TEST AUTHOR owns.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Count the AudioContexts the page creates, and expose the count. */
const COUNT_CONTEXTS = `
  window.__bfAudioContexts = 0;
  const Original = window.AudioContext;
  window.AudioContext = class extends Original {
    constructor(...args) {
      super(...args);
      window.__bfAudioContexts += 1;
    }
  };
`;

test.describe("T74/T75: clouds and background music", () => {
  test("the cloud layout is a pure function of the seed", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });

    const result = await page.evaluate(async () => {
      const mod = await import("/src/render/clouds.ts");
      const observer = { x: 0.5, y: 70.5, z: 0.5 };
      const layout = (seed: number, tick: number): number[][] => {
        const layer = new mod.CloudLayer(seed);
        layer.advance(tick, observer);
        return layer.group.children.map((child) => [
          child.position.x,
          child.position.y,
          child.position.z,
        ]);
      };
      const canvas = mod.buildCloudCanvas();
      const ctx = canvas.getContext("2d");
      const pixels = ctx ? ctx.getImageData(0, 0, canvas.width, canvas.height).data : null;
      let opaque = 0;
      if (pixels) {
        for (let i = 3; i < pixels.length; i += 4) {
          if ((pixels[i] ?? 0) > 8) {
            opaque += 1;
          }
        }
      }
      return {
        same: layout(1337, 100),
        sameAgain: layout(1337, 100),
        other: layout(4242, 100),
        later: layout(1337, 200),
        opaque,
      };
    });

    expect(result.same.length, "the deck must have clouds").toBeGreaterThan(0);
    expect(result.opaque, "the cloud texture must have real pixels").toBeGreaterThan(100);
    expect(result.sameAgain, "the same seed must give the same clouds").toEqual(result.same);
    expect(result.other, "a different seed must give different clouds").not.toEqual(result.same);
    expect(result.later, "the clouds must drift over time").not.toEqual(result.same);
  });

  test("the music starts on the title click, and the context is gesture-only", async ({
    page,
  }: {
    page: Page;
  }) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        problems.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      problems.push(`pageerror: ${error.message}`);
    });

    await page.addInitScript(COUNT_CONTEXTS);
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
    await page.waitForTimeout(1500);

    // Before any gesture there must be no AudioContext at all: a context
    // created outside a gesture is what makes Chrome log an autoplay
    // warning, and the G2 gate fails on a single warning.
    const before = await page.evaluate(() => window.__bfAudioContexts);
    expect(before, "no AudioContext may exist before a user gesture").toBe(0);

    await page.locator("#blockforge-title .bf-play").click();
    await page.waitForTimeout(1200);

    const after = await page.evaluate(async () => {
      const mod = await import("/src/render/music.ts");
      return {
        contexts: window.__bfAudioContexts,
        playing: mod.isMusicPlaying(),
      };
    });

    expect(after.contexts, "the click must create the AudioContext").toBeGreaterThan(0);
    expect(after.playing, "the music must be running after the title click").toBe(true);
    expect(problems, "the music must not log anything").toEqual([]);
  });
});
