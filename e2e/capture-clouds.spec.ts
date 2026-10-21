import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * A capture of the sky with the clouds in it, looking at the HORIZON.
 *
 * The main capture looks DOWN at the ground (so the hand is in frame), which
 * means the sky is not visible. This one looks level, so the clouds can be
 * seen and judged.
 */
test("capture the sky with clouds", async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
  await page.waitForTimeout(3000);

  const play = page.locator("#blockforge-title .bf-play");
  if (await play.count()) {
    await play.click();
    await page.waitForTimeout(1500);
  }

  // Look slightly UP, so the horizon and the clouds above it are in frame.
  await page.evaluate(() => {
    const handle = (window as unknown as { __blockforge?: { look(p: number): void } })
      .__blockforge;
    handle?.look(0.75);
  });
  await page.waitForTimeout(1200);

  await page.screenshot({ path: "test-results/capture-clouds.png" });
  process.stdout.write("  wrote test-results/capture-clouds.png\n");
  expect(true).toBe(true);
});
