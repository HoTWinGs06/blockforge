/**
 * T96 GUARD: the dropped item must be VISIBLE in the world.
 *
 * e2e/drops.spec.ts (the gameplay layer's guard) asserts the LOGIC: break
 * a block, an item is on the ground, walk over it, the pack gains one.
 * That test passes even when nothing is ever DRAWN - which is exactly
 * the bug this task exists to close. The operator's report was "not able
 * to collect broken blocks no inventory", and the invisible half of it
 * survived the logic half.
 *
 * So this guard reads the RENDERER's own state: how many drop meshes
 * exist, where they are, and how big they are. The session's count and
 * the renderer's count must agree, and the mesh must sit where the
 * session says the item is.
 *
 * It also checks the drop's TEXTURE: a cube wearing the whole atlas (one
 * tile per face) is a different bug from a cube wearing no tile at all,
 * and both look like "the drop is not really there".
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** A drop as the renderer reports it. */
interface DrawnDrop {
  id: number;
  x: number;
  y: number;
  z: number;
  size: number;
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

test.describe("T96 guard: the dropped item is drawn in the world", () => {
  /** Start the game, get the title screen out of the way, wait for landing. */
  const play = async (page: Page): Promise<void> => {
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const button = page.locator("#blockforge-title .bf-play");
    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(600);
    }
    // The player SPAWNS IN THE AIR and falls, so wait for the landing.
    await page.waitForFunction(
      () => {
        const handle = (
          window as unknown as { __blockforge?: { state(): { onGround: boolean } } }
        ).__blockforge;
        return handle?.state().onGround === true;
      },
      { timeout: 30_000 },
    );
  };

  /** Look down at the ground, the way a player does. */
  const lookDown = async (page: Page): Promise<void> => {
    await page.evaluate(() => {
      const handle = (
        window as unknown as { __blockforge?: { look(pitchDelta: number): void } }
      ).__blockforge;
      handle?.look(-1.4);
    });
    await page.waitForTimeout(300);
  };

  /** What the renderer has actually drawn on the ground. */
  const drawn = async (page: Page): Promise<readonly DrawnDrop[]> =>
    page.evaluate(() => {
      const handle = (
        window as unknown as {
          __blockforge?: { drawnDrops(): readonly DrawnDrop[] };
        }
      ).__blockforge;
      return handle?.drawnDrops() ?? [];
    });

  test("breaking a block leaves a drop the renderer actually DRAWS", async ({ page }) => {
    test.setTimeout(180_000);
    await play(page);
    await lookDown(page);

    // Select the tool this block needs, the way a player does.
    const toolSlot = await page.evaluate(async () => {
      const constants = await import("/src/core/constants.ts");
      const handle = (
        window as unknown as {
          __blockforge?: {
            targetedKind(): string | null;
            carried(): readonly { id: string; count: number }[];
          };
        }
      ).__blockforge;
      const kind = handle?.targetedKind();
      if (!kind) {
        return 0;
      }
      const needed = constants.requiredToolFor(kind);
      const slots = handle?.carried() ?? [];
      for (let i = 0; i < slots.length; i++) {
        const item = slots[i];
        if (!item) {
          continue;
        }
        const spec = constants.toolSpec(item.id);
        if (spec !== undefined && spec.kind === needed) {
          return i + 1;
        }
      }
      return 0;
    });
    expect(toolSlot, "the player must own a tool this block needs").toBeGreaterThan(0);
    await page.keyboard.press(`Digit${toolSlot}`);
    await page.waitForTimeout(200);

    // HOLD until the block gives way.
    await page.evaluate(() => {
      const handle = (
        window as unknown as { __blockforge?: { setBreaking(h: boolean): void } }
      ).__blockforge;
      handle?.setBreaking(true);
    });
    await page.waitForFunction(
      () => {
        const handle = (
          window as unknown as { __blockforge?: { dropped(): number } }
        ).__blockforge;
        return (handle?.dropped() ?? 0) > 0;
      },
      { timeout: 90_000 },
    );
    await page.evaluate(() => {
      const handle = (
        window as unknown as { __blockforge?: { setBreaking(h: boolean): void } }
      ).__blockforge;
      handle?.setBreaking(false);
    });

    // THE VISUAL HALF. The session says there is an item on the ground;
    // the renderer must have a MESH for it, or the player is walking over
    // an invisible item - which is the bug this whole task is about.
    const drops = await drawn(page);
    expect(drops.length, "the renderer must DRAW the item the session dropped").toBeGreaterThan(0);

    // It must be a small cube, not a full block: a drop is about a
    // quarter of a block.
    expect(drops[0]?.size, "a drop must be about a quarter of a block").toBeCloseTo(0.25, 3);

    // It must be where the session says the item is. The renderer draws
    // the item's CENTRE, so the mesh's position is that centre.
    //
    // BOTH SIDES ARE READ IN ONE CALL, because the item is still SETTLING:
    // it falls into the hole it was broken out of over the first few
    // ticks, so its height changes between two frames. The x and z are
    // fixed at the column's centre and must match exactly; the height is
    // within the settle motion, which is a tenth of a block of hop plus
    // the fall.
    const both = await page.evaluate(() => {
      const handle = (
        window as unknown as {
          __blockforge?: {
            drawnDrops(): readonly {
              id: number;
              x: number;
              y: number;
              z: number;
              size: number;
              minU: number;
              maxU: number;
              minV: number;
              maxV: number;
            }[];
            droppedItems(): readonly { id: number; x: number; y: number; z: number }[];
          };
        }
      ).__blockforge;
      return {
        drawn: handle?.drawnDrops() ?? [],
        session: handle?.droppedItems() ?? [],
      };
    });
    expect(both.drawn.length, "the renderer must DRAW the item the session dropped").toBeGreaterThan(0);
    expect(
      both.drawn.length,
      "the renderer must draw as many drops as the session has on the ground",
    ).toBe(both.session.length);

    const first = both.drawn[0];
    const source = both.session.find((item) => item.id === first?.id);
    expect(source, "the renderer must be drawing an item the session knows about").toBeDefined();
    expect(first?.x, "the drawn drop must sit at the item's centre").toBeCloseTo(source?.x ?? 0, 5);
    expect(first?.z, "the drawn drop must sit at the item's centre").toBeCloseTo(source?.z ?? 0, 5);
    expect(
      Math.abs((first?.y ?? 0) - (source?.y ?? 0)),
      "the drawn drop must sit at the item's settled height",
    ).toBeLessThan(0.25);
  });

  test("the drop shows ONE block's texture, not the whole atlas", async ({ page }) => {
    test.setTimeout(180_000);
    await play(page);
    await lookDown(page);

    const toolSlot = await page.evaluate(async () => {
      const constants = await import("/src/core/constants.ts");
      const handle = (
        window as unknown as {
          __blockforge?: {
            targetedKind(): string | null;
            carried(): readonly { id: string; count: number }[];
          };
        }
      ).__blockforge;
      const kind = handle?.targetedKind();
      if (!kind) {
        return 0;
      }
      const needed = constants.requiredToolFor(kind);
      const slots = handle?.carried() ?? [];
      for (let i = 0; i < slots.length; i++) {
        const item = slots[i];
        if (!item) {
          continue;
        }
        const spec = constants.toolSpec(item.id);
        if (spec !== undefined && spec.kind === needed) {
          return i + 1;
        }
      }
      return 0;
    });
    expect(toolSlot, "the player must own a tool this block needs").toBeGreaterThan(0);
    await page.keyboard.press(`Digit${toolSlot}`);
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      const handle = (
        window as unknown as { __blockforge?: { setBreaking(h: boolean): void } }
      ).__blockforge;
      handle?.setBreaking(true);
    });
    await page.waitForFunction(
      () => {
        const handle = (
          window as unknown as { __blockforge?: { drawnDrops(): readonly unknown[] } }
        ).__blockforge;
        return (handle?.drawnDrops() ?? []).length > 0;
      },
      { timeout: 90_000 },
    );
    await page.evaluate(() => {
      const handle = (
        window as unknown as { __blockforge?: { setBreaking(h: boolean): void } }
      ).__blockforge;
      handle?.setBreaking(false);
    });

    const drops = await drawn(page);
    const drop = drops[0];
    expect(drop, "the renderer must have drawn a drop").toBeDefined();

    // A block's atlas cell is ONE tile: an eighth of the atlas width (it
    // is eight columns wide) and a third of its height (three rows). A
    // cube wearing the WHOLE atlas spans the whole 0..1 range, which is
    // the classic "BoxGeometry laid its UVs out by vertex group" bug.
    expect(
      (drop?.maxU ?? 0) - (drop?.minU ?? 0),
      `the drop must show ONE block's texture, not the whole atlas (u ${(drop?.minU ?? 0).toFixed(3)}..${(drop?.maxU ?? 0).toFixed(3)})`,
    ).toBeLessThanOrEqual(0.13);
    expect(
      (drop?.maxV ?? 0) - (drop?.minV ?? 0),
      `the drop must show ONE block's texture, not the whole atlas (v ${(drop?.minV ?? 0).toFixed(3)}..${(drop?.maxV ?? 0).toFixed(3)})`,
    ).toBeLessThanOrEqual(0.35);
  });

  test("the drop is VISIBLE ON SCREEN - real pixels, not just a mesh", async ({ page }) => {
    test.setTimeout(180_000);
    await play(page);
    await lookDown(page);

    const toolSlot = await page.evaluate(async () => {
      const constants = await import("/src/core/constants.ts");
      const handle = (
        window as unknown as {
          __blockforge?: {
            targetedKind(): string | null;
            carried(): readonly { id: string; count: number }[];
          };
        }
      ).__blockforge;
      const kind = handle?.targetedKind();
      if (!kind) {
        return 0;
      }
      const needed = constants.requiredToolFor(kind);
      const slots = handle?.carried() ?? [];
      for (let i = 0; i < slots.length; i++) {
        const item = slots[i];
        if (!item) {
          continue;
        }
        const spec = constants.toolSpec(item.id);
        if (spec !== undefined && spec.kind === needed) {
          return i + 1;
        }
      }
      return 0;
    });
    expect(toolSlot, "the player must own a tool this block needs").toBeGreaterThan(0);
    await page.keyboard.press(`Digit${toolSlot}`);
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      const handle = (
        window as unknown as { __blockforge?: { setBreaking(h: boolean): void } }
      ).__blockforge;
      handle?.setBreaking(true);
    });
    await page.waitForFunction(
      () => {
        const handle = (
          window as unknown as { __blockforge?: { drawnDrops(): readonly unknown[] } }
        ).__blockforge;
        return (handle?.drawnDrops() ?? []).length > 0;
      },
      { timeout: 90_000 },
    );
    await page.evaluate(() => {
      const handle = (
        window as unknown as { __blockforge?: { setBreaking(h: boolean): void } }
      ).__blockforge;
      handle?.setBreaking(false);
    });
    // Let the item settle on the ground before the frame is sampled.
    await page.waitForTimeout(800);

    // The drop's screen box, and the frame around it.
    const box = await page.evaluate(() => {
      const handle = (
        window as unknown as {
          __blockforge?: {
            drawnDrops(): readonly {
              screen: { x: number; y: number; width: number; height: number } | null;
            }[];
          };
        }
      ).__blockforge;
      const drop = (handle?.drawnDrops() ?? [])[0];
      return drop?.screen ?? null;
    });
    expect(box, "the drop must be on the screen, in front of the camera").not.toBeNull();

    const frame = await page.screenshot();
    const sample = await page.evaluate(
      async (arg: {
        png: string;
        region: { x: number; y: number; width: number; height: number };
      }): Promise<{ r: number; g: number; b: number; spread: number; pixels: number } | null> => {
        const image = new Image();
        image.src = `data:image/png;base64,${arg.png}`;
        await image.decode();
        const probe = document.createElement("canvas");
        probe.width = image.width;
        probe.height = image.height;
        const ctx = probe.getContext("2d");
        if (!ctx) {
          return null;
        }
        ctx.drawImage(image, 0, 0);
        // The drop's own pixels.
        const px = Math.max(0, Math.floor(arg.region.x));
        const py = Math.max(0, Math.floor(arg.region.y));
        const pw = Math.max(1, Math.floor(arg.region.width));
        const ph = Math.max(1, Math.floor(arg.region.height));
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
          spread: seen.size,
          pixels: n,
        };
      },
      {
        png: frame.toString("base64"),
        region: box as { x: number; y: number; width: number; height: number },
      },
    );

    expect(sample, "the frame must be readable").not.toBeNull();
    expect(sample?.pixels ?? 0, "the drop must cover some pixels").toBeGreaterThan(0);
    // A drop wearing ONE block's texture is a TEXTURED surface: the region
    // must carry more than one colour bucket. A flat, single-colour
    // region is the sky or an untextured face - which is what an
    // undrawn drop looks like.
    expect(
      sample?.spread ?? 0,
      `the drop's pixels must be TEXTURED, not a flat colour (${JSON.stringify(sample)})`,
    ).toBeGreaterThan(1);
  });
});
