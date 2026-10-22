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
 *
 * T92 - THE HARNESS WAS RACING, THE GAME WAS FINE. These two tests used to
 * fail for a reason that had nothing to do with breaking: the player was
 * not aiming at anything. Three separate harness problems, all of them
 * here, none of them in the game:
 *
 *   a) THE PLAY CLICK TURNS THE CAMERA UP 45 DEGREES. Pressing play grabs
 *      the pointer, and the browser's pointer lock hands the game one huge
 *      mousemove, which the game turns into camera motion. The old helper
 *      then asked for "look down 0.6 radians" - a RELATIVE turn - which
 *      from 45 degrees up still points at the SKY. The seam publishes the
 *      current view, so this file asks for an ABSOLUTE angle and keeps
 *      asking until the view reads back, which also survives a mousemove
 *      that arrives late.
 *
 *   b) THE PLAYER MAY NOT HAVE LANDED. They spawn high in the air and
 *      fall. Until they land there is no ground within reach, so a ray
 *      aimed down hits nothing at all. The old helper slept a fixed 600ms
 *      and hoped; this one WAITS for the landing, which is the actual
 *      precondition.
 *
 *   c) WALL-CLOCK SLEEPS SAY NOTHING ABOUT THE BREAK TIMER. The game
 *      advances its simulation one 1/60s tick per RENDERED FRAME, and a
 *      headless software renderer runs at a handful of frames a second. So
 *      "sleep 100ms" is not "100ms of game time" - it is two or three
 *      frames. Every wait in this file is now a wait for the CONDITION, and
 *      every count of game progress is counted in FRAMES, the way the
 *      game counts them.
 *
 * One more thing changed, and it is the point of the whole file. The old
 * version asked whether BARE HANDS could break the block, while the game
 * breaks with the tool in the player's hand. Those are different questions
 * and the old one made the "holding breaks it" half of the test
 * unreachable - the block could not be broken at all, so the test proved
 * nothing about holding. This file puts the RIGHT tool in the player's
 * hand first, so the hold really does break something.
 */

/**
 * The game's public testing seam, as this file drives it.
 *
 * The same shape src/main.ts publishes on window.__blockforge in the dev
 * build. This is a TYPE only - the runtime object comes out of the page.
 */
interface Seam {
  state(): { onGround: boolean };
  view(): { yaw: number; pitch: number };
  look(pitchDelta: number, yawDelta?: number): void;
  targeted(): { x: number; y: number; z: number } | null;
  targetedKind(): string | null;
  carried(): readonly { id: string; count: number }[];
  setBreaking(holding: boolean): void;
  breakProgress(): number | null;
}

/** Where the camera points when it is looking at the ground ahead. */
const PITCH_DOWN = -0.6;
const YAW_FORWARD = 0;

/**
 * Load the game, press play, and wait until the player is on the ground.
 *
 * The landing is a PRECONDITION, not a delay: the player falls from the top
 * of the world, and until they land the ground is out of reach, so there
 * is nothing to aim at.
 */
const startAndLand = async (page: Page): Promise<void> => {
  await page.goto("/");
  await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
  await page.waitForTimeout(1500);

  const play = page.locator("#blockforge-title .bf-play");
  if (await play.count()) {
    await play.click();
    await page.waitForTimeout(600);
  }

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
 * The seam's look() is a relative turn, the way the mouse handler works.
 * The play click's pointer lock leaves the camera turned, so a relative
 * turn from there lands somewhere else entirely. This reads the current
 * view, applies the turn that reaches the target, and keeps doing so until
 * the view reads back - which also copes with a mousemove that arrives
 * late.
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
 * Put a tool into the player's hand, the way a player does: by pressing its
 * hotbar key.
 *
 * "needed" selects the tool the contract says the block requires, so the
 * block can actually be broken - or the empty slot, when the block needs no
 * tool at all, which is bare hands. "other" selects a tool of a DIFFERENT
 * kind, so the game's refusal can be observed.
 *
 * The game publishes the hotbar in the HUD and marks the selected slot
 * there, so the test can read back what the game actually did.
 */
const selectTool = async (
  page: Page,
  kind: string,
  mode: "needed" | "other",
): Promise<{ slot: number; required: string | null }> => {
  const info = await page.evaluate(
    async ({ kind, mode }) => {
      const constants = await import("/src/core/constants.ts");
      const handle = (window as unknown as { __blockforge?: Seam }).__blockforge;
      const required = constants.requiredToolFor(kind);
      const carried = handle?.carried() ?? [];
      let slot = -1;
      if (mode === "other") {
        for (let i = 0; i < carried.length; i++) {
          const spec = constants.toolSpec(carried[i]?.id ?? "");
          if (spec && spec.kind !== required) {
            slot = i;
            break;
          }
        }
      } else if (required === null) {
        // No tool is needed, so bare hands will do: pick the empty slot.
        for (let i = 0; i < carried.length; i++) {
          if (!carried[i]?.id) {
            slot = i;
            break;
          }
        }
      } else {
        for (let i = 0; i < carried.length; i++) {
          const spec = constants.toolSpec(carried[i]?.id ?? "");
          if (spec && spec.kind === required) {
            slot = i;
            break;
          }
        }
      }
      return { slot, required };
    },
    { kind, mode },
  );

  if (info.slot >= 0) {
    await page.keyboard.press(`Digit${info.slot + 1}`);
    await page.waitForFunction(
      (slot) => {
        const el = document.querySelector("#blockforge-hud .bf-slot.bf-selected");
        return el?.getAttribute("data-slot") === String(slot);
      },
      info.slot,
      { timeout: 15_000 },
    );
  }
  return info;
};

/**
 * How many seconds the block needs, per the frozen contract, using the tool
 * the game really has selected.
 *
 * Read from the HUD's selected slot and the pack, so the test's model of
 * the game and the game's model of itself agree.
 */
const breakSeconds = async (page: Page, kind: string): Promise<number> =>
  page.evaluate(async (kind) => {
    const constants = await import("/src/core/constants.ts");
    const handle = (window as unknown as { __blockforge?: Seam }).__blockforge;
    const carried = handle?.carried() ?? [];
    const selected = document.querySelector("#blockforge-hud .bf-slot.bf-selected");
    const index = Number(selected?.getAttribute("data-slot") ?? "-1");
    const spec = index >= 0 ? constants.toolSpec(carried[index]?.id ?? "") ?? null : null;
    return spec ? constants.breakSecondsWith(kind, spec) : constants.breakSeconds(kind);
  }, kind);

/**
 * Hold the break button for a number of RENDERED FRAMES and report how far
 * the break timer got.
 *
 * The watcher runs INSIDE the page, on the game's own animation frames, so
 * it counts what the game did rather than how long the wall clock said.
 * The break timer advances one 1/60s tick per frame, so a frame count is
 * the only unit of game progress that means anything here.
 */
const clickForFrames = async (page: Page, frames: number): Promise<number> =>
  page.evaluate(async (frames) => {
    const handle = (window as unknown as { __blockforge?: Seam }).__blockforge;
    if (!handle) {
      return 0;
    }
    let furthest = 0;
    let seen = 0;
    handle.setBreaking(true);
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        seen++;
        const progress = handle.breakProgress();
        if (progress !== null && progress > furthest) {
          furthest = progress;
        }
        if (seen < frames) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
    handle.setBreaking(false);
    return furthest;
  }, frames);

/**
 * Watch the break bar while a hold is in progress, and report what the
 * game actually drew.
 *
 * The watcher lives in the page and samples the bar on the game's own
 * frames, so it cannot miss the frame where the bar was up - which a
 * read-after-the-fact can, because by the time the test looks the block
 * may be broken and the bar back down.
 */
const watchBreakBar = async (
  page: Page,
): Promise<{ seen: boolean; fillWidth: number; label: string }> =>
  page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    canvas?.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    let seen = false;
    let fillWidth = 0;
    let label = "";
    let frames = 0;
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        frames++;
        const bar = document.querySelector("#blockforge-hud .bf-break");
        if (bar?.classList.contains("bf-active")) {
          seen = true;
          const fill = document.querySelector("#blockforge-hud .bf-break > i");
          const width = fill?.getBoundingClientRect().width ?? 0;
          if (width > fillWidth) {
            fillWidth = width;
          }
          if (!label) {
            label = document.querySelector("#blockforge-hud .bf-break-label")?.textContent ?? "";
          }
        }
        // Stop once the bar has been seen and the hold has finished, or
        // after a generous number of frames.
        if ((seen && !bar?.classList.contains("bf-active")) || frames > 600) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return { seen, fillWidth, label };
  });

test.describe("T70 guard: hold-to-break", () => {
  test("a quick click does not break a block, holding does", async ({ page }: { page: Page }) => {
    test.setTimeout(180_000);
    await startAndLand(page);
    await aimAt(page, PITCH_DOWN, YAW_FORWARD);

    const target = await readTarget(page);
    expect(target.kind, "the player must be aiming at a block").not.toBe("");

    // The contract froze a TOOL rule alongside the break times: some blocks
    // cannot be broken by bare hands at all. So this test has to know what
    // it is looking at, and it has to hold the RIGHT tool - because
    // getting this wrong is how a test ends up asserting the WRONG thing,
    // and it is how the "holding breaks it" half of this test became
    // unreachable.
    const chosen = await selectTool(page, target.kind, "needed");
    expect(
      chosen.slot,
      "the player's kit must have a tool for the block they are aiming at",
    ).toBeGreaterThanOrEqual(0);

    const seconds = await breakSeconds(page, target.kind);
    expect(seconds, "the tool in hand must be able to break the block at all").toBeGreaterThan(0);

    // 1. A QUICK CLICK must not break it. A "quick click" is a handful of
    //    frames - a sixth of the frames the block needs - so it cannot
    //    finish the break, whatever the renderer is doing.
    const framesForBreak = Math.ceil(seconds * 60);
    const clickFrames = Math.max(1, Math.min(5, Math.floor(framesForBreak / 6)));
    const progress = await clickForFrames(page, clickFrames);
    expect(progress, "a quick click must start the break timer").toBeGreaterThan(0);
    expect(progress, "a quick click must not break the block").toBeLessThan(1);

    const afterClick = await readTarget(page);
    expect(
      { x: afterClick.x, y: afterClick.y, z: afterClick.z },
      "a quick click must not break the block",
    ).toEqual({ x: target.x, y: target.y, z: target.z });

    // 2. HOLDING. The wait is for the CONDITION - the block going - and
    //    not for a number of milliseconds, because the break timer runs on
    //    rendered frames and a headless renderer is slow.
    await page.evaluate(() => {
      const handle = (window as unknown as { __blockforge?: Seam }).__blockforge;
      handle?.setBreaking(true);
    });
    try {
      await page.waitForFunction(
        (before) => {
          const handle = (window as unknown as { __blockforge?: Seam }).__blockforge;
          const at = handle?.targeted() ?? null;
          return at === null || at.x !== before.x || at.y !== before.y || at.z !== before.z;
        },
        { x: target.x, y: target.y, z: target.z },
        { timeout: 120_000, polling: 100 },
      );
    } finally {
      await page.evaluate(() => {
        const handle = (window as unknown as { __blockforge?: Seam }).__blockforge;
        handle?.setBreaking(false);
      });
    }

    const afterHold = await readTarget(page);
    expect(
      { x: afterHold.x, y: afterHold.y, z: afterHold.z },
      "holding must break a block the tool in hand can break",
    ).not.toEqual({ x: target.x, y: target.y, z: target.z });
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
    test.setTimeout(180_000);
    await startAndLand(page);
    await aimAt(page, PITCH_DOWN, YAW_FORWARD);

    const target = await readTarget(page);
    expect(target.kind, "the player must be aiming at a block").not.toBe("");

    // The contract's tool rule means some blocks cannot be broken at all
    // with what the player holds, and the game says which tool is needed
    // instead of starting a timer that can never finish.
    const wrong = await selectTool(page, target.kind, "other");
    if (wrong.required !== null && wrong.slot >= 0) {
      await page.evaluate(() => {
        const handle = (window as unknown as { __blockforge?: Seam }).__blockforge;
        handle?.setBreaking(true);
      });
      await page.waitForFunction(
        () => {
          const message = document.querySelector("#blockforge-hud .bf-message");
          return /needs a/.test(message?.textContent ?? "");
        },
        undefined,
        { timeout: 30_000 },
      );
      const refused = await page.evaluate(() => ({
        message: document.querySelector("#blockforge-hud .bf-message")?.textContent ?? "",
        barActive:
          document.querySelector("#blockforge-hud .bf-break")?.classList.contains("bf-active") ??
          false,
      }));
      await page.evaluate(() => {
        const handle = (window as unknown as { __blockforge?: Seam }).__blockforge;
        handle?.setBreaking(false);
      });
      expect(refused.message, "the game must say which tool is needed").toMatch(/needs a/);
      expect(refused.message, "the game must name the tool the block needs").toContain(
        wrong.required ?? "",
      );
      expect(refused.barActive, "a block the player cannot break must show no progress bar").toBe(
        false,
      );
    }

    // Now the RIGHT tool: the hold starts a timer and the bar shows it.
    await selectTool(page, target.kind, "needed");
    const bar = await watchBreakBar(page);
    expect(bar.seen, "the break bar must show while a hold is in progress").toBe(true);
    expect(bar.fillWidth, "the break bar must show partial progress").toBeGreaterThan(0);
    expect(bar.label, "the break label must name what is being broken").toContain("Breaking");
  });
});
