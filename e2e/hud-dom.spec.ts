import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test("inspect the HUD DOM", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const play = page.locator("#blockforge-title .bf-play");
  if (await play.count()) {
    await play.click();
    await page.waitForTimeout(600);
  }

  const info = await page.evaluate(() => {
    const hud = document.querySelector("#blockforge-hud");
    const stats = document.querySelector("#blockforge-hud .bf-stats");
    const bar = document.querySelector("#blockforge-hud .bf-bar.bf-health");
    const slot = document.querySelector("#blockforge-hud .bf-slot");
    const rect = (el: Element | null) => {
      if (!el) return "MISSING";
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return `${r.width.toFixed(0)}x${r.height.toFixed(0)} display=${cs.display} vis=${cs.visibility} opacity=${cs.opacity}`;
    };
    return {
      hudExists: !!hud,
      statsChildren: stats ? stats.children.length : -1,
      statsHTML: stats ? stats.innerHTML.slice(0, 300) : "MISSING",
      statsRect: rect(stats),
      barRect: rect(bar),
      slotRect: rect(slot),
      slotCount: document.querySelectorAll("#blockforge-hud .bf-slot").length,
      styleTagPresent: !!document.getElementById("blockforge-hud-style"),
      styleTagLen: document.getElementById("blockforge-hud-style")?.textContent?.length ?? 0,
      hasBarRule: (document.getElementById("blockforge-hud-style")?.textContent ?? "").includes("bf-bar"),
    };
  });

  process.stdout.write(`  HUD DOM: ${JSON.stringify(info, null, 1)}\n`);
  expect(info).toBeDefined();
});
