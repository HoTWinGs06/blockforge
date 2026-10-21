import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * T60 GUARD: the title screen must exist and must be dismissible.
 *
 * The operator reported "no main menu screen", and the related symptom was
 * that the game dropped the player in with the mouse not captured, so
 * mouse-look felt broken on first use.
 */
test.describe("T60 guard: the title screen", () => {
  test("the title screen is shown, and play dismisses it", async ({ page }: { page: Page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });

    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
    await page.waitForTimeout(2000);

    // The title screen must be present and visible.
    const title = page.locator("#blockforge-title");
    await expect(title, "the title screen must exist").toHaveCount(1);
    await expect(title, "the title screen must be visible on load").toBeVisible();

    // The headline and the play button.
    await expect(page.locator("#blockforge-title h1")).toHaveText("BLOCKFORGE");
    const play = page.locator("#blockforge-title .bf-play");
    await expect(play, "there must be a click-to-play button").toBeVisible();

    // The disclaimer must be on the title screen, not only in the README.
    const disclaimer = (await page.locator("#blockforge-title .bf-disclaimer").textContent()) ?? "";
    expect(disclaimer).toContain("Mojang");
    expect(disclaimer).toContain("Microsoft");

    // Pressing play must hide it.
    await play.click();
    await page.waitForTimeout(400);
    await expect(title, "clicking play must dismiss the title screen").toBeHidden();

    expect(errors, "no page errors").toEqual([]);
  });

  test("the HUD reads like a game - visible bars and slots", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
    await page.waitForTimeout(1500);

    // Dismiss the title screen first - the HUD is behind it, so the bars
    // have no layout box while the title is up.
    const play = page.locator("#blockforge-title .bf-play");
    if (await play.count()) {
      await play.click();
      await page.waitForTimeout(500);
    }

    // The health and hunger bars must be big enough to SEE. The operator
    // reported "no health bar, hunger bar inventory bar" - they existed but
    // were two 7-pixel slivers.
    const health = page.locator("#blockforge-hud .bf-bar.bf-health");
    const hunger = page.locator("#blockforge-hud .bf-bar.bf-hunger");
    await expect(health, "the health bar must exist").toHaveCount(1);
    await expect(hunger, "the hunger bar must exist").toHaveCount(1);

    // Read the layout box in the page. Playwright's boundingBox() returns
    // null for an element that is not rendered, and the title screen sits on
    // top until the player presses play.
    const barBox = await page.evaluate(() => {
      const el = document.querySelector("#blockforge-hud .bf-bar.bf-health");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    expect(barBox, "the health bar must be laid out").not.toBeNull();
    expect(barBox!.height, "the health bar must be tall enough to read").toBeGreaterThanOrEqual(10);
    expect(barBox!.width, "the health bar must be wide enough to read").toBeGreaterThanOrEqual(100);

    // And it must be FULL at full health, not a fifth full.
    const fillWidth = await page.evaluate(() => {
      const el = document.querySelector("#blockforge-hud .bf-bar.bf-health > i");
      if (!el) return 0;
      return el.getBoundingClientRect().width;
    });
    expect(fillWidth, "a healthy player must have a FULL health bar").toBeGreaterThan(100);

    // They must be LABELS, not bare bars.
    const stats = (await page.locator("#blockforge-hud .bf-stats").textContent()) ?? "";
    expect(stats).toContain("HEALTH");
    expect(stats).toContain("HUNGER");

    // The hotbar must have nine slots, and empty slots must still read as
    // slots rather than as nothing.
    await expect(page.locator("#blockforge-hud .bf-slot"), "nine hotbar slots").toHaveCount(9);
    const slotBox = await page.evaluate(() => {
      const el = document.querySelector("#blockforge-hud .bf-slot");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    expect(slotBox, "the hotbar slots must be laid out").not.toBeNull();
    expect(slotBox!.width, "slots must be a readable size").toBeGreaterThanOrEqual(40);
  });
});
