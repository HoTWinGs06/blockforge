import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * T74 GUARD: the sky must have CLOUDS in it.
 *
 * The operator said "add clouds". The feature was written, the unit tests
 * passed, the build was green - and the sky was COMPLETELY CLEAR, because
 * three separate things were wrong at once:
 *
 *   1. The deck was never ADVANCED. advance() is what positions the sprites;
 *      a deck that is built and never advanced leaves every cloud at the
 *      origin, inside the ground, invisible.
 *   2. The scene fog was swallowing the deck. The clouds sit at y=88 to 100,
 *      well beyond the fog's far plane of 60, so the fog blended them all
 *      the way to the sky colour - they rendered as nothing at all.
 *   3. The distance fade used the 3D distance, which includes the height
 *      above the player. Every cloud therefore started already half faded,
 *      and the ones directly overhead were past the far plane and fully
 *      invisible.
 *
 * This guard checks the PIXELS, because that is the only honest test of
 * "there are clouds in the sky". The pixels come from the SCREENSHOT, not
 * from drawing the WebGL canvas into a 2D one: the renderer does not enable
 * preserveDrawingBuffer, so the drawing buffer is already cleared by the
 * time the page can read it, and drawImage() gives all zeroes.
 */
test.describe("T74 guard: clouds in the sky", () => {
  test("the sky has clouds, and they are white against the blue", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
    await page.waitForTimeout(2500);

    const play = page.locator("#blockforge-title .bf-play");
    if (await play.count()) {
      await play.click();
      await page.waitForTimeout(1000);
    }

    // Look UP, so the sky and the deck above it are in frame.
    await page.evaluate(() => {
      const handle = (window as unknown as { __blockforge?: { look(p: number): void } })
        .__blockforge;
      handle?.look(0.75);
    });
    await page.waitForTimeout(1000);

    const frame = await page.screenshot();
    await page.evaluate((data) => {
      (window as unknown as { __bfPng?: string }).__bfPng = data;
    }, frame.toString("base64"));
    const sky = await page.evaluate(async () => {
      const data = (window as unknown as { __bfPng?: string }).__bfPng ?? "";
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const probe = document.createElement("canvas");
      probe.width = image.width;
      probe.height = image.height;
      const ctx = probe.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0);

      // Sample the upper band of the frame - the sky.
      const y = Math.floor(image.height * 0.05);
      const band = ctx.getImageData(0, y, image.width, Math.floor(image.height * 0.25)).data;

      let blue = 0;
      let white = 0;
      let other = 0;
      const seen = new Set<string>();
      for (let i = 0; i < band.length; i += 4) {
        const r = band[i] ?? 0;
        const g = band[i + 1] ?? 0;
        const b = band[i + 2] ?? 0;
        seen.add(`${r >> 4},${g >> 4},${b >> 4}`);
        if (b > r + 20 && b > 90) {
          blue++;
        } else if (r > 200 && g > 200 && b > 200) {
          white++;
        } else {
          other++;
        }
      }
      const total = blue + white + other;
      return {
        blue,
        white,
        other,
        total,
        distinct: seen.size,
        whiteFraction: total > 0 ? white / total : 0,
      };
    });

    expect(sky, "the frame must be readable").not.toBeNull();
    // The sky must be mostly blue - the game is a daylight scene.
    expect(sky!.blue, "the sky must be mostly blue").toBeGreaterThan(sky!.total * 0.3);
    // And there must be CLOUDS: a meaningful number of near-white pixels in
    // the sky band, and more than a handful of distinct colours, because a
    // cloudless sky is exactly two colours.
    expect(
      sky!.white,
      `the sky must contain clouds (white pixels); blue=${sky!.blue} white=${sky!.white} other=${sky!.other} distinct=${sky!.distinct}`,
    ).toBeGreaterThan(200);
    expect(
      sky!.distinct,
      `a cloudless sky has two colours; the band had ${sky!.distinct}`,
    ).toBeGreaterThan(4);
  });

  test("the cloud placement is a pure function of the seed", async ({ page }: { page: Page }) => {
    // The clouds must be derived from the WORLD SEED, so two players in the
    // same world see the same sky and a recorded world looks the same twice.
    // The cloud module is a pure function of the seed, so this checks the
    // module rather than the pixels.
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
    await page.waitForTimeout(1500);

    const layout = await page.evaluate(async () => {
      const mod = await import("/src/render/clouds.ts");
      const seeds = [1337, 1337, 4242, 4242];
      const out: string[] = [];
      for (const seed of seeds) {
        const layer = new mod.CloudLayer(seed);
        layer.advance(1, { x: 0, y: 68, z: 0 });
        const group = layer.group;
        const parts: string[] = [];
        group.traverse((obj) => {
          if (obj.name.startsWith("cloud-")) {
            parts.push(`${obj.name}@${obj.position.x.toFixed(3)},${obj.position.y.toFixed(3)},${obj.position.z.toFixed(3)}`);
          }
        });
        out.push(parts.sort().join("|"));
      }
      return out;
    });

    expect(layout).toHaveLength(4);
    // The same seed gives the same layout, and a different seed gives a
    // different one.
    expect(layout[0], "the same seed must give the same clouds").toBe(layout[1]);
    expect(layout[2], "the same seed must give the same clouds").toBe(layout[3]);
    expect(layout[0], "a different seed must give different clouds").not.toBe(layout[2]);
  });
});
