import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * T70 GUARD: breaking is a HOLD, and it takes the block's own time.
 *
 * The operator said "make every block have different breaking speeds". The
 * interaction is the renderer's: the player holds the button, a timer runs,
 * and the block breaks only when the timer completes.
 *
 * This drives the real game in a real browser and checks the things that
 * matter:
 *   1. A quick click does NOT break a hard block.
 *   2. Holding long enough DOES break it.
 *   3. The progress readout exists and is hidden when nothing is breaking.
 */
test.describe("T70 guard: hold-to-break", () => {
  const hold = async (page: Page, ms: number): Promise<void> => {
    await page.evaluate(() => {
      const handle = (
        window as unknown as { __blockforge?: { setBreaking(h: boolean): void } }
      ).__blockforge;
      handle?.setBreaking(true);
    });
    await page.waitForTimeout(ms);
    await page.evaluate(() => {
      const handle = (
        window as unknown as { __blockforge?: { setBreaking(h: boolean): void } }
      ).__blockforge;
      handle?.setBreaking(false);
    });
    await page.waitForTimeout(300);
  };

  /**
   * Look down at the ground.
   *
   * The game looks at the HORIZON by default, so a ray from the eye hits
   * nothing - which is correct, because a player would look down. A headless
   * browser cannot get pointer lock easily, so the test drives the same
   * public look() the mouse handler uses.
   */
  const lookDown = async (page: Page): Promise<void> => {
    await page.evaluate(() => {
      const handle = (
        window as unknown as {
          __blockforge?: { look(pitch: number): void };
        }
      ).__blockforge;
      handle?.look(-0.6);
    });
    await page.waitForTimeout(200);
  };

  test("a quick click does not break a block, holding does", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
    await page.waitForTimeout(1500);

    // Start the game so the title screen is out of the way.
    const play = page.locator("#blockforge-title .bf-play");
    if (await play.count()) {
      await play.click();
      await page.waitForTimeout(600);
    }

    // Aim at the ground so the ray hits a solid block.
    await lookDown(page);
    await hold(page, 60);

    const targeted = await page.evaluate(
      () => document.querySelector(".bf-target")?.textContent ?? "",
    );
    expect(targeted, "the player must be aiming at a block").not.toBe("");

    // 1. A QUICK CLICK must not break it.
    await hold(page, 100);
    const afterClick = await page.evaluate(
      () => document.querySelector(".bf-target")?.textContent ?? "",
    );
    expect(afterClick, "a quick click must not break the block").not.toBe("");

    // 2. HOLDING must break it. 11 seconds covers every block in the table
    //    (the slowest, voidstone, is 9s).
    await hold(page, 11_000);

    // The block is gone, so the player is now aiming at whatever is behind
    // it, or at nothing. Either way the readout is no longer the same.
    const afterHold = await page.evaluate(
      () => document.querySelector(".bf-target")?.textContent ?? "",
    );
    expect(afterHold, "holding must break the block").not.toBe(targeted);
  });

  test("the break progress readout exists and is hidden when idle", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
    await page.waitForTimeout(1200);

    const present = await page.evaluate(() => ({
      bar: !!document.querySelector("#blockforge-hud .bf-break"),
      label: !!document.querySelector("#blockforge-hud .bf-break-label"),
      barActive:
        document.querySelector("#blockforge-hud .bf-break")?.classList.contains("bf-active") ?? false,
    }));
    expect(present.bar, "the break bar must exist").toBe(true);
    expect(present.label, "the break label must exist").toBe(true);
    expect(present.barActive, "the break bar must be hidden when nothing is breaking").toBe(false);
  });

  test("the break bar appears while a hold is in progress", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
    await page.waitForTimeout(1500);

    const play = page.locator("#blockforge-title .bf-play");
    if (await play.count()) {
      await play.click();
      await page.waitForTimeout(600);
    }

    // Start a hold on a hard block so the timer is running long enough to
    // observe.
    await lookDown(page);
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      canvas?.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    });
    await page.waitForTimeout(900);

    const active = await page.evaluate(() => ({
      barActive:
        document.querySelector("#blockforge-hud .bf-break")?.classList.contains("bf-active") ?? false,
      fillWidth:
        document.querySelector("#blockforge-hud .bf-break > i")?.getBoundingClientRect().width ?? 0,
      label:
        document.querySelector("#blockforge-hud .bf-break-label")?.textContent ?? "",
    }));

    await page.evaluate(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    expect(active.barActive, "the break bar must show while a hold is in progress").toBe(true);
    expect(active.fillWidth, "the break bar must show partial progress").toBeGreaterThan(0);
    expect(active.label, "the break label must name what is being broken").toContain("Breaking");
  });
});
