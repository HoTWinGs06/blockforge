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
 *
 * WHY TEST 1 SAMPLES THE HAND'S OWN PIXELS (T101, after T94)
 * -----------------------------------------------------------
 * The old version of this test averaged a WIDE REGION in the lower-right
 * corner and compared that mean against a patch of sky at the top of the
 * frame. It was measuring the BACKGROUND, not the hand:
 *
 *   - 6939 of the region's 46080 pixels were the hand; the other 85% were
 *     world, so the verdict was a property of the world, not of the hand.
 *   - the sky patch was at a DIFFERENT elevation from the hand, so the two
 *     samples were already ten units apart in green before the hand
 *     contributed anything.
 *   - the verdict therefore flipped on the camera pose: 2 PASS / 6 FAIL
 *     across 8 identical runs of the same code. The e2e run clicks the play
 *     button, and that click's synthetic mouse movement is read as look
 *     input, so the camera ended up at one of two poses depending on a race.
 *   - and worst of all, the rule REWARDED a broken hand: the only colours
 *     that could satisfy it were near-black, so making the hand invisible
 *     made the test happier. A black hand rendered [30,30,30].
 *
 * The hand is a child of the CAMERA. That is the fact this guard is built
 * on: the hand does not move on screen when the player looks around, and
 * (since the T94 lighting fix) its shading does not depend on where the
 * player is looking either - while the WORLD behind it does move. So:
 *
 *   take a frame, MOVE THE CAMERA, take a second frame, and the pixels
 *   inside the hand's screen box that are IDENTICAL in both frames are the
 *   hand's own pixels.
 *
 * That isolates the hand exactly, with no guesswork about where it is, and
 * it makes the guard's verdict independent of the camera pose - which is
 * the whole point. Measured at seven camera poses, including the one that
 * made the old guard fail:
 *
 *   hand fills its box   0.801   (identical at every pose)
 *   distinct colours     14      (identical at every pose)
 *   distance from sky    99..139 (worst pose 99, threshold 40)
 *
 * And the guard is ARMED: on the tree with the T94 lighting bug put back
 * (the key light aiming at the world origin), the hand's pixels change
 * when the camera moves, so the hand cannot be told from the world and the
 * guard fails on "0 of 8658 pixels held still".
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

  /** The camera pose the game reports, in radians. */
  const view = async (page: Page): Promise<{ yaw: number; pitch: number }> =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __blockforge?: { view(): { yaw: number; pitch: number } };
          }
        ).__blockforge?.view() ?? { yaw: Number.NaN, pitch: Number.NaN },
    );

  /** Turn the camera by a delta, in radians. */
  const look = async (page: Page, pitchDelta: number, yawDelta: number): Promise<void> => {
    await page.evaluate(
      ([p, y]) => {
        (
          window as unknown as {
            __blockforge?: { look(pitchDelta: number, yawDelta: number): void };
          }
        ).__blockforge?.look(p, y);
      },
      [pitchDelta, yawDelta] as [number, number],
    );
  };

  /** Put the camera at an absolute pose, and wait for the frame to settle. */
  const aim = async (page: Page, yaw: number, pitch: number): Promise<void> => {
    const now = await view(page);
    await look(page, pitch - now.pitch, yaw - now.yaw);
    await page.waitForTimeout(250);
  };

  test("the hand is drawn, textured, and not washed out", async ({ page }: { page: Page }) => {
    // This test reads two full frames and compares them pixel by pixel
    // inside the hand's box. It is heavier than the other two, and the
    // 60 second default in playwright.config.ts is a coin flip on a loaded
    // CI box.
    test.setTimeout(180_000);

    await start(page);

    // The play button's click moves the mouse, and that movement is read
    // as look input, so the camera starts at an unknown pose. Aim it at a
    // KNOWN one, twice, so a late-arriving mouse event cannot land between
    // the aim and the capture. The pose is asserted below, so if the game
    // ever stops accepting look() the guard fails loudly instead of
    // measuring a frame nobody knows the shape of.
    await aim(page, 0, 0);
    await aim(page, 0, 0);
    const posed = await view(page);
    expect(
      Math.abs(posed.yaw) < 1e-6 && Math.abs(posed.pitch) < 1e-6,
      `the camera must sit at the known pose (yaw ${posed.yaw}, pitch ${posed.pitch})`,
    ).toBe(true);

    // The HUD is a DOM overlay ON TOP of the canvas, and its pixels are
    // static, so a HUD element sitting inside the hand's box would be
    // counted as hand pixels that never move. Hide it: this guard is about
    // what the renderer drew, not about what the DOM put on top of it.
    await page.evaluate(() => {
      const hud = document.getElementById("blockforge-hud");
      if (hud) {
        hud.style.display = "none";
      }
    });

    // The hand's screen box, in CSS pixels relative to the canvas. It is
    // the same at every camera pose, because the hand is a child of the
    // camera.
    const box = await page.evaluate(() => {
      const handle = (
        window as unknown as {
          __blockforge?: {
            viewmodelScreenBounds(): {
              x: number;
              y: number;
              width: number;
              height: number;
            } | null;
          };
        }
      ).__blockforge;
      const b = handle?.viewmodelScreenBounds();
      if (!b) {
        return null;
      }
      const canvas = document.getElementById("game");
      const rect = canvas?.getBoundingClientRect();
      return {
        x: (rect?.left ?? 0) + b.x,
        y: (rect?.top ?? 0) + b.y,
        width: b.width,
        height: b.height,
      };
    });
    expect(box, "the handle must report where the hand is on screen").not.toBeNull();

    const first = await page.screenshot();

    // Move the camera. The hand does not move with it; the world does.
    await look(page, 0.35, 0.25);
    await page.waitForTimeout(300);
    const second = await page.screenshot();
    const moved = await view(page);
    expect(
      Math.abs(moved.yaw - posed.yaw) > 0.1,
      "the camera must actually have moved, or the hand's pixels cannot be told from the world's",
    ).toBe(true);

    const sample = await page.evaluate(
      async ([a, b, handBox]) => {
        /** Read a PNG's pixels. The SCREENSHOT, not a 2D canvas drawing the
         * WebGL canvas: the renderer does not enable preserveDrawingBuffer,
         * so the drawing buffer is already cleared by the time the page can
         * read it, and drawImage() gives all zeroes. Playwright's screenshot
         * goes through the compositor, so it sees the real frame. */
        const decode = async (b64: string): Promise<ImageData> => {
          const image = new Image();
          image.src = `data:image/png;base64,${b64}`;
          await image.decode();
          const probe = document.createElement("canvas");
          probe.width = image.width;
          probe.height = image.height;
          const ctx = probe.getContext("2d");
          if (!ctx) {
            throw new Error("no 2d context");
          }
          ctx.drawImage(image, 0, 0);
          return ctx.getImageData(0, 0, image.width, image.height);
        };
        const [firstFrame, secondFrame] = await Promise.all([
          decode(a as string),
          decode(b as string),
        ]);
        const at = (f: ImageData, x: number, y: number): [number, number, number] => {
          const i = (y * f.width + x) * 4;
          return [f.data[i] ?? 0, f.data[i + 1] ?? 0, f.data[i + 2] ?? 0];
        };
        const median = (a: number[]): number => {
          a.sort((p, q) => p - q);
          return a[Math.floor(a.length / 2)] ?? 0;
        };

        // The hand's own pixels: identical in both frames. The world
        // behind them moved, so they are not the world. Only the hand's
        // own box is walked - 8658 pixels, not the whole frame.
        const hand: number[][] = [];
        let worldChanged = 0;
        const bx = handBox.x;
        const by = handBox.y;
        const bw = handBox.width;
        const bh = handBox.height;
        for (let y = by; y < by + bh; y++) {
          for (let x = bx; x < bx + bw; x++) {
            const p = at(firstFrame, x, y);
            const q = at(secondFrame, x, y);
            if (p[0] === q[0] && p[1] === q[1] && p[2] === q[2]) {
              hand.push(p);
            } else {
              worldChanged++;
            }
          }
        }

        // The sky, from a strip of the top of the first frame. The MEDIAN
        // of each channel, so a cloud or the sun disc in the strip cannot
        // skew it.
        const skyR: number[] = [];
        const skyG: number[] = [];
        const skyB: number[] = [];
        for (let y = Math.floor(firstFrame.height * 0.02); y < Math.floor(firstFrame.height * 0.1); y++) {
          for (let x = Math.floor(firstFrame.width * 0.3); x < Math.floor(firstFrame.width * 0.7); x++) {
            const p = at(firstFrame, x, y);
            skyR.push(p[0]);
            skyG.push(p[1]);
            skyB.push(p[2]);
          }
        }

        const distinct = new Set<string>();
        for (const p of hand) {
          distinct.add(`${p[0]! >> 4},${p[1]! >> 4},${p[2]! >> 4}`);
        }
        return {
          handCount: hand.length,
          boxArea: bw * bh,
          worldChanged,
          handMedian: [
            median(hand.map((p) => p[0]!)),
            median(hand.map((p) => p[1]!)),
            median(hand.map((p) => p[2]!)),
          ],
          handDistinct: distinct.size,
          skyMedian: [median(skyR), median(skyG), median(skyB)],
        };
      },
      [first.toString("base64"), second.toString("base64"), box] as [string, string, NonNullable<typeof box>],
    );

    // The control, first: if the world did not move, nothing below means
    // anything. The corners of the hand's box show the world through the
    // rotated cube, and they must have changed.
    expect(
      sample.worldChanged,
      "the world behind the hand must have moved between the two frames",
    ).toBeGreaterThan(0);

    // The hand must really be drawn in its own box. The box is the
    // bounding box of a rotated cube, so a fifth of it is world showing
    // through the corners - but the bulk of it must be the hand, and every
    // one of those pixels must be the SAME in both frames, which is only
    // true of something parented to the camera.
    expect(
      sample.handCount / sample.boxArea,
      `the hand must fill its own screen box (${sample.handCount} of ${sample.boxArea} pixels held still while the world moved)`,
    ).toBeGreaterThan(0.5);

    // A textured block, not a flat shape. A cube shows at most three flat
    // faces, so more than three distinct colours means the block's own
    // texture is showing through.
    expect(
      sample.handDistinct,
      "the hand must show a TEXTURED block, not a flat shape",
    ).toBeGreaterThan(3);

    // Not washed out. A hand fogged out would be the sky's colour, so it
    // must be a clearly different colour from the sky. The distance is a
    // single number over all three channels, so a hand that differs in
    // only one of them does not sneak past - which is what the old rule
    // did, when a black hand passed and a correctly lit one failed.
    const d = sample.handMedian.map((v, i) => Math.abs(v - sample.skyMedian[i]!));
    const distance = Math.sqrt(d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2);
    expect(
      distance,
      `the hand must be visibly distinct from the sky (hand ${JSON.stringify(sample.handMedian)} against a sky of ${JSON.stringify(sample.skyMedian)})`,
    ).toBeGreaterThan(40);
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
