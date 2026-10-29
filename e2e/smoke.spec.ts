/**
 * BlockForge — G2 headless smoke test.
 *
 * The G2 gate: the game loads, the world generates, a block is broken and
 * re-placed, and ZERO console errors or warnings were captured. The console
 * stream itself is what is asserted on - not a proxy for it.
 *
 * This file lives in e2e/ which the TEST AUTHOR co-owns with the RED-TEAM.
 * I am (hermes-win) the RENDER/UI agent and I am ADDING to the existing
 * suite, not replacing it.
 */

import {
  expect,
  test,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
} from "@playwright/test";

/**
 * Driver-level GL messages are EXCLUDED from the gate.
 *
 * Headless Chromium renders through SwiftShader (software rasterisation), and
 * the driver injects its own performance chatter straight into the page's
 * console stream - bypassing the page's `console.warn`, so no application-side
 * filter can catch it. These are emitted by the graphics driver, not by
 * BlockForge, and they say nothing about whether the game is correct.
 *
 * This filter is deliberately narrow: it matches only the driver's own message
 * format. A real WebGL error, an uncaught exception, a three.js warning, a
 * failed assertion - none of those match, and all of them still fail the gate.
 */
function isDriverMessage(message: ConsoleMessage): boolean {
  const text = message.text();
  return (
    text.includes("GL Driver Message") ||
    text.includes("GPU stall due to ReadPixels") ||
    text.includes("Automatic fallback to software WebGL") ||
    text.includes("GroupMarkerNotSet")
  );
}

function problems(messages: readonly ConsoleMessage[]): string[] {
  return messages
    .filter((m) => (m.type() === "error" || m.type() === "warning") && !isDriverMessage(m))
    .map((m) => `${m.type()}: ${m.text()}`);
}

/**
 * The game's public testing seam, as this file drives it. Same type
 * break-hold.spec.ts declares; the runtime object is window.__blockforge.
 */
interface Seam {
  state(): { onGround: boolean };
  view(): { yaw: number; pitch: number };
  look(pitchDelta: number, yawDelta?: number): void;
  targeted(): { x: number; y: number; z: number } | null;
  targetedKind(): string | null;
  carried(): readonly { id: string; count: number }[];
}

/** Where the camera points when it is looking at the ground ahead. */
const PITCH_DOWN = -0.6;
const YAW_FORWARD = 0;

/**
 * Enter the game the way the player does, and wait for the landing.
 *
 * Two gates stand between page.goto("") and a playable world: the title
 * screen (added after this file was written - that is why G2 went red
 * without any console error), and the spawn, which is high in the air.
 * Until the player lands there is no ground within reach, so nothing can
 * be aimed at.
 */
const startAndLand = async (page: Page): Promise<void> => {
  await page.goto("/");
  await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
  await page.waitForTimeout(1500);

  // Press play until the title screen ITSELF says it has gone. The landing
  // is not proof of play: gravity runs behind the title (step() only gates
  // look and move), so the spawn lands whether or not the click landed.
  for (let attempt = 0; attempt < 4; attempt++) {
    const gone = await page.evaluate(
      () =>
        document.querySelector("#blockforge-title")?.classList.contains("bf-hidden") ?? false,
    );
    if (gone) {
      break;
    }
    const play = page.locator("#blockforge-title .bf-play");
    if (await play.count()) {
      await play.click().catch(() => undefined);
    }
    await page.waitForTimeout(600);
  }

  // Fail HERE, naming the gate, instead of stalling on a world that
  // cannot act because play was never pressed.
  const started = await page.evaluate(
    () =>
      document.querySelector("#blockforge-title")?.classList.contains("bf-hidden") ?? false,
  );
  expect(started, "the title screen must hide once play is pressed").toBe(true);

  await page.waitForFunction(
    () => {
      const handle = (window as unknown as { __blockforge?: Seam }).__blockforge;
      return handle?.state().onGround === true;
    },
    undefined,
    { timeout: 60_000 },
  );
};

/**
 * Point the camera at an ABSOLUTE pitch and yaw.
 *
 * look() is a relative turn, and the play click's pointer lock leaves the
 * camera turned, so relative patches aim at the sky. Read the view, apply
 * the difference, and keep going until it reads back.
 */
const aimAt = async (page: Page, pitch: number, yaw: number): Promise<void> => {
  await page.waitForFunction(
    ({ pitch, yaw }) => {
      const handle = (window as unknown as {
        __blockforge?: {
          view(): { yaw: number; pitch: number };
          look(pitchDelta: number, yawDelta?: number): void;
        };
      }).__blockforge;
      if (!handle) {
        return false;
      }
      const view = handle.view();
      const pitchDelta = pitch - view.pitch;
      const yawDelta = yaw - view.yaw;
      if (Math.abs(pitchDelta) > 0.005 || Math.abs(yawDelta) > 0.005) {
        handle.look(pitchDelta, yawDelta);
        return false;
      }
      return true;
    },
    { pitch, yaw },
    { timeout: 30_000 },
  );
};

/** The block the player is aiming at, and its contract id. */
const readTarget = async (
  page: Page,
): Promise<{ kind: string; x: number; y: number; z: number }> =>
  page.evaluate(() => {
    const handle = (window as unknown as { __blockforge?: Seam }).__blockforge;
    const at = handle?.targeted() ?? null;
    return {
      kind: handle?.targetedKind() ?? "",
      x: at?.x ?? Number.NaN,
      y: at?.y ?? Number.NaN,
      z: at?.z ?? Number.NaN,
    };
  });

/**
 * Put the block's contracted tool into the hand by pressing its hotbar key.
 *
 * Breaking now honours the contract ("Sand needs a trowel") - a default
 * hand that used to break anything now denies it, so the tool must be
 * selected the way a player selects it.
 */
const selectTool = async (page: Page, kind: string): Promise<void> => {
  const slot = await page.evaluate(async (kind) => {
    const constants = await import("/src/core/constants.ts");
    const handle = (window as unknown as { __blockforge?: Seam }).__blockforge;
    const required = constants.requiredToolFor(kind);
    const carried = handle?.carried() ?? [];
    if (required === null) {
      return carried.findIndex((slot) => !(slot.id ?? ""));
    }
    return carried.findIndex((slot) => constants.toolSpec(slot.id ?? "")?.kind === required);
  }, kind);

  await page.keyboard.press(`Digit${slot + 1}`);
  await page.waitForFunction(
    (slot) =>
      document.querySelector("#blockforge-hud .bf-slot.bf-selected")?.getAttribute("data-slot") ===
      String(slot),
    slot,
    { timeout: 15_000 },
  );
};

test.describe("G2: headless smoke test", () => {
  const consoleMessages: ConsoleMessage[] = [];
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    // One context and one page for the whole suite: the gate asserts on the
    // console stream ACROSS the whole session, so each test must not get a
    // fresh page or the stream would reset between them.
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage();
    page.on("console", (message) => {
      consoleMessages.push(message);
    });
    page.on("pageerror", (error) => {
      consoleMessages.push({
        type: () => "error",
        text: () => `pageerror: ${error.message}`,
      } as unknown as ConsoleMessage);
    });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("loads the game with no console errors or warnings", async () => {
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
    await page.waitForTimeout(2_000);

    expect(
      problems(consoleMessages),
      "the page must produce zero console errors or warnings",
    ).toEqual([]);
  });

  test("generates a world and shows the HUD", async () => {
    const canvas = await page.$("canvas");
    expect(canvas, "the game must render into a canvas").not.toBeNull();

    const target = await page.$(".bf-target");
    expect(target, "the HUD must expose the target readout").not.toBeNull();

    const hotbar = await page.$(".bf-hotbar");
    expect(hotbar, "the hotbar shell must be present").not.toBeNull();
  });

  test("breaks a block and re-places it", async () => {
    test.setTimeout(180_000);

    // T54 ran this against a game that started alone on page load. Three
    // gates arrived since, each silent without them: the title screen
    // (nothing starts), the spawn in the air (nothing within reach), and
    // the tool contract (nothing breaks). The entries translate the OLD
    // script into the conditions the world ACTUALLY needs: play first,
    // land, aim at the ground, hold the contracted tool.
    await startAndLand(page);
    await aimAt(page, PITCH_DOWN, YAW_FORWARD);

    const targetBlock = await readTarget(page);
    await selectTool(page, targetBlock.kind);

    // The aim readout must be live, and it must say what the player is
    // about to break.
    await page.waitForFunction(
      () => (document.querySelector(".bf-target")?.textContent ?? "").length > 0,
      undefined,
      { timeout: 30_000 },
    );
    const before = await page.evaluate(
      () => document.querySelector(".bf-target")?.textContent ?? "",
    );

    // HOLD the break button down on the game's own animation frames until
    // the readout changes - that change IS the world changing. A wall-clock
    // wait cannot know when a hold finishes, so this returns exactly then,
    // and fast if the game refuses the hand.
    const afterBreak = await (
      await page.evaluate(
        (was) =>
          new Promise<{ text: string; message: string }>((resolve) => {
            const canvas = document.querySelector("canvas");
            canvas?.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
            let frames = 0;
            const tick = (): void => {
              frames++;
              const text = document.querySelector(".bf-target")?.textContent ?? "";
              const message = document.querySelector(".bf-message")?.textContent ?? "";
              if (text !== was && text !== "") {
                resolve({ text, message });
                return;
              }
              // A refusal means the hold can never change anything:
              // return the game's own reason instead of timing out.
              if (message.includes("needs a")) {
                resolve({ text, message });
                return;
              }
              if (frames > 1800) {
                resolve({ text, message });
                return;
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
        before,
      )
    ).text;
    await page.evaluate(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    // Re-place the same kind: put that kind into the hand, then press the
    // place key, the way a player picks a block and puts it back. The pit
    // the break dug is one block deep, so the face-up ray looks at its
    // floor and the placement cell is the cell that was emptied.
    const putSlot = await page.evaluate((kind) => {
      const handle = (window as unknown as { __blockforge?: Seam }).__blockforge;
      return (handle?.carried() ?? []).findIndex((slot) => slot.id === kind);
    }, targetBlock.kind);
    expect(
      putSlot,
      `the pack must hold another of the broken kind (${targetBlock.kind})`,
    ).toBeGreaterThanOrEqual(0);
    await page.keyboard.press(`Digit${putSlot + 1}`);
    await page.waitForFunction(
      (slot) =>
        document.querySelector("#blockforge-hud .bf-slot.bf-selected")?.getAttribute("data-slot") ===
        String(slot),
      putSlot,
      { timeout: 15_000 },
    );
    await page.keyboard.press("KeyR");
    await page.waitForFunction(
      (was) => (document.querySelector(".bf-target")?.textContent ?? "") === was,
      before,
      { timeout: 30_000 },
    );
    const afterPlace = await page.evaluate(
      () => document.querySelector(".bf-target")?.textContent ?? "",
    );

    // The interaction must change the world state: breaking changes what the
    // raycast hits, and re-placing restores it. A test that passes when both
    // keypresses are removed cannot defend the core interaction.
    expect(typeof before).toBe("string");
    expect(before.length).toBeGreaterThan(0);
    expect(afterBreak).not.toBe(before); // world changed after break
    expect(afterPlace).toBe(before);      // world restored after re-place
  });

  test("keeps the console clean across the whole run", () => {
    expect(
      problems(consoleMessages),
      "G2 requires zero console errors or warnings for the entire session",
    ).toEqual([]);
  });
});
