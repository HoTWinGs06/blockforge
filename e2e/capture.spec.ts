import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Take a screenshot of the running game so the rendering can be LOOKED at.
 *
 * The operator reported "no different colour textures for the blocks" and
 * "no proper sky". The atlas diagnostic proved the atlas itself is correct,
 * so the question is what the SCREEN shows. A screenshot answers that in a way
 * no assertion does.
 *
 * The images are written to test-results/ and are meant to be looked at.
 */
test.describe("visual capture", () => {
  test("capture the game view", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: "test-results/capture-game.png" });
    process.stdout.write("  wrote test-results/capture-game.png\n");

    // Also capture the atlas itself, so the two can be compared side by side.
    const atlasPng = await page.evaluate(async () => {
      const mod = await import("/src/render/textures.ts");
      const canvas = mod.buildAtlasCanvas();
      return canvas.toDataURL("image/png");
    });
    const buffer = Buffer.from(atlasPng.split(",")[1] ?? "", "base64");
    const fs = await import("node:fs");
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync("test-results/capture-atlas.png", buffer);
    process.stdout.write("  wrote test-results/capture-atlas.png\n");

    expect(true).toBe(true);
  });

  test("capture the sky on its own", async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
    await page.waitForTimeout(2000);

    // Point the camera up at the sky and take a shot.
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return;
      canvas.dispatchEvent(
        new MouseEvent("mousedown", { button: 0, bubbles: true }),
      );
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/capture-sky.png" });
    process.stdout.write("  wrote test-results/capture-sky.png\n");
    expect(true).toBe(true);
  });
});
