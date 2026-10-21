import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * T71 GUARD: the player must have a visible hand.
 *
 * The operator said "no player hand visible". There was no viewmodel at all.
 *
 * The guard checks the three things that make a viewmodel work, and each one
 * was a real bug while building it:
 *   1. The hand EXISTS and is drawn.
 *   2. It shows ONE block's texture, not the whole atlas.
 *   3. It is NOT washed out by the chunk fog.
 */
test.describe("T71 guard: the player hand", () => {
  const start = async (page: Page): Promise<void> => {
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
    await page.waitForTimeout(2000);
    const play = page.locator("#blockforge-title .bf-play");
    if (await play.count()) {
      await play.click();
      await page.waitForTimeout(800);
    }
  };

  test("the hand is drawn, textured, and not fogged out", async ({ page }: { page: Page }) => {
    await start(page);

    // The hand lives in its own overlay scene, so the honest check is the
    // pixels: sample the lower-right corner of the frame, where the hand is,
    // and confirm it is not the same colour as the sky. A fogged-out hand
    // would be exactly the sky colour.
    //
    // The pixels come from the SCREENSHOT, not from a 2D canvas drawing the
    // WebGL canvas: the renderer does not enable preserveDrawingBuffer, so
    // the drawing buffer is already cleared by the time the page can read
    // it, and drawImage() gives all zeroes. Playwright's screenshot goes
    // through the compositor, so it sees the real frame.
    const frame = await page.screenshot();
    const sample = await page.evaluate(async (png: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const probe = document.createElement("canvas");
      probe.width = image.width;
      probe.height = image.height;
      const ctx = probe.getContext("2d");
      if (!ctx) {
        return { lowerRight: [] as number[], sky: [] as number[], distinct: false };
      }
      ctx.drawImage(image, 0, 0);
      const w = probe.width;
      const h = probe.height;
      // Sample a REGION, not a single pixel. One pixel can land on a
      // shadowed edge or a gap between blocks, and the test would then
      // fail for a reason that has nothing to do with the hand.
      const region = (
        x0: number,
        y0: number,
        x1: number,
        y1: number,
      ): { r: number; g: number; b: number; spread: number } => {
        const px = Math.max(0, Math.floor(x0 * w));
        const py = Math.max(0, Math.floor(y0 * h));
        const pw = Math.max(1, Math.floor((x1 - x0) * w));
        const ph = Math.max(1, Math.floor((y1 - y0) * h));
        const data = ctx.getImageData(px, py, pw, ph).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        const seen = new Set<string>();
        for (let i = 0; i < data.length; i += 4) {
          r += data[i] ?? 0;
          g += data[i + 1] ?? 0;
          b += data[i + 2] ?? 0;
          n++;
          seen.add(`${(data[i] ?? 0) >> 4},${(data[i + 1] ?? 0) >> 4},${(data[i + 2] ?? 0) >> 4}`);
        }
        return {
          r: Math.round(r / Math.max(1, n)),
          g: Math.round(g / Math.max(1, n)),
          b: Math.round(b / Math.max(1, n)),
          // How many distinct colours are in the region. The hand is a
          // textured block, so its region has several; the sky is flat.
          spread: seen.size,
        };
      };

      // The lower-right corner, where the hand is.
      const hand = region(0.6, 0.7, 0.8, 0.95);
      // The top of the screen, which is sky.
      const sky = region(0.35, 0.02, 0.65, 0.12);
      return {
        hand: [hand.r, hand.g, hand.b],
        sky: [sky.r, sky.g, sky.b],
        // The hand must not be the sky's colour, and it must not be flat.
        distinct:
          Math.abs(hand.r - sky.r) > 12 &&
          Math.abs(hand.g - sky.g) > 12 &&
          Math.abs(hand.b - sky.b) > 12,
        textured: hand.spread > 1,
      };
    }, frame.toString("base64"));

    expect(sample.hand?.length ?? 0, "the frame must be readable").toBe(3);
    expect(
      sample.distinct,
      `the hand must be visible and not washed out by the fog (hand ${JSON.stringify(sample.hand ?? [])} against a sky of ${JSON.stringify(sample.sky ?? [])})`,
    ).toBe(true);
    expect(
      sample.textured,
      "the hand must show a TEXTURED block, not a flat shape",
    ).toBe(true);
  });

  test("the hand shows ONE block's texture, not the whole atlas", async ({ page }: { page: Page }) => {
    await start(page);

    // Read the hand's UVs from the live game.
    //
    // The test CANNOT import the viewmodel module directly: a browser-side
    // dynamic import of it fails to resolve three.js's bare specifier, so
    // the game reports its own hand's UVs instead. That is a read-only
    // observation, not another control surface.
    const uvs = await page.evaluate(() => {
      const handle = (
        window as unknown as {
          __blockforge?: {
            viewmodelUvBounds(): {
              minU: number;
              maxU: number;
              minV: number;
              maxV: number;
            };
          };
        }
      ).__blockforge;
      const b = handle?.viewmodelUvBounds();
      return b
        ? { ...b, spansOneCell: b.maxU - b.minU <= 0.126 && b.maxV - b.minV <= 0.34 }
        : null;
    });

    expect(uvs, "the handle must report the hand's UVs").not.toBeNull();
    expect(
      uvs!.spansOneCell,
      `the hand must show ONE block's texture, not the whole atlas (u ${uvs!.minU.toFixed(3)}..${uvs!.maxU.toFixed(3)}, v ${uvs!.minV.toFixed(3)}..${uvs!.maxV.toFixed(3)})`,
    ).toBe(true);
  });

  test("the hand's material has fog disabled", async ({ page }: { page: Page }) => {
    await start(page);

    // The fog flag is the real guarantee: it keeps the chunk fog from
    // tinting the hand, which sits far inside the fog's near plane.
    //
    // It is checked in the game's OWN module context rather than the
    // browser's, because the browser cannot import the viewmodel module -
    // three.js's bare specifier does not resolve outside Vite's transform.
    // The renderer reports the flag, and it is a read-only observation.
    const info = await page.evaluate(() => {
      const handle = (
        window as unknown as {
          __blockforge?: { viewmodelHasFog(): boolean };
        }
      ).__blockforge;
      return { hasFog: handle?.viewmodelHasFog() ?? null };
    });

    expect(info.hasFog, "the viewmodel material must have fog disabled").toBe(false);
  });
});
