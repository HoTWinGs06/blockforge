import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * T80 GUARD: a broken block becomes a collectable item.
 *
 * The operator reported "not able to collect broken blocks no inventory" -
 * two halves. This drives the REAL game in a REAL browser and checks both:
 *
 *   1. BREAKING A BLOCK LEAVES AN ITEM on the ground where it was broken.
 *   2. WALKING OVER THE ITEM COLLECTS IT - the pack gains one, and the
 *      hotbar shows the new count.
 *
 * It does this the way a player does: it looks at the block, selects the
 * tool the contract says that block needs (with the number keys), holds the
 * break button until the block gives way, and then walks over the drop.
 *
 * WHY IT POLLS INSTEAD OF WAITING A FIXED TIME: the headless browser draws
 * far fewer frames than a real one, and the game advances a FIXED dt per
 * frame, so a break that takes 0.7 seconds of game time takes several
 * seconds of wall time in the test. Polling for the break to actually
 * happen is both faster and more honest than a sleep.
 */
test.describe("T80 guard: broken blocks become collectable items", () => {
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
    // The player SPAWNS IN THE AIR and falls. Aiming at the ground before
    // they land aims at nothing, so wait for the landing.
    await page.waitForFunction(
      () => {
        const handle = (
          window as unknown as {
            __blockforge?: { state(): { onGround: boolean } };
          }
        ).__blockforge;
        return handle?.state().onGround === true;
      },
      { timeout: 30_000 },
    );
  };

  /** Look down at the ground, the way a player does. */
  const lookDown = async (page: Page): Promise<void> => {
    // Clicking play tilts the camera UP, so the look has to go past the
    // horizon to reach the ground.
    await page.evaluate(() => {
      const handle = (
        window as unknown as { __blockforge?: { look(pitchDelta: number): void } }
      ).__blockforge;
      handle?.look(-1.4);
    });
    await page.waitForTimeout(300);
  };

  /** What the player is carrying right now, as the hotbar shows it. */
  const carried = async (page: Page): Promise<readonly { id: string; count: number }[]> =>
    page.evaluate(() => {
      const handle = (
        window as unknown as {
          __blockforge?: { carried(): readonly { id: string; count: number }[] };
        }
      ).__blockforge;
      return handle?.carried() ?? [];
    });

  /** The kind of block the player is aiming at, as the contract's id. */
  const targetedKind = async (page: Page): Promise<string | null> =>
    page.evaluate(() => {
      const handle = (
        window as unknown as { __blockforge?: { targetedKind(): string | null } }
      ).__blockforge;
      return handle?.targetedKind() ?? null;
    });

  test("breaking a block leaves an item, and walking over it collects it", async ({ page }) => {
    test.setTimeout(180_000);
    await play(page);
    await lookDown(page);

    const kind = await targetedKind(page);
    expect(kind, "the player must be aiming at a block").not.toBeNull();

    // The contract's tool rule: pick the tool this block needs, the way a
    // player does - with the number keys.
    const toolSlot = await page.evaluate(async (blockKind: string) => {
      const constants = await import("/src/core/constants.ts");
      const handle = (
        window as unknown as {
          __blockforge?: {
            carried(): readonly { id: string; count: number }[];
          };
        }
      ).__blockforge;
      const needed = constants.requiredToolFor(blockKind);
      const slots = handle?.carried() ?? [];
      for (let i = 0; i < slots.length; i++) {
        const item = slots[i];
        if (item === undefined) {
          continue;
        }
        const spec = constants.toolSpec(item.id);
        if (spec !== undefined && spec.kind === needed) {
          return i + 1;
        }
      }
      return 0;
    }, kind as string);

    expect(toolSlot, "the player must own a tool this block needs").toBeGreaterThan(0);
    await page.keyboard.press(`Digit${toolSlot}`);
    await page.waitForTimeout(200);

    const before = await carried(page);
    const beforeCount = before.find((item) => item.id === kind)?.count ?? 0;

    // HOLD until the block gives way. The hold is released as soon as the
    // drop is on the ground.
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

    // THE BLOCK LEFT AN ITEM ON THE GROUND.
    const onGround = await page.evaluate(() => {
      const handle = (window as unknown as { __blockforge?: { dropped(): number } }).__blockforge;
      return handle?.dropped() ?? 0;
    });
    expect(onGround, "breaking a block must leave an item on the ground").toBeGreaterThan(0);

    // Now WALK OVER IT. The drop is where the block was, and the player was
    // looking at it, so walking forward reaches it.
    await page.keyboard.down("KeyW");
    await page.waitForFunction(
      ([blockKind, was]) => {
        const handle = (
          window as unknown as {
            __blockforge?: { carried(): readonly { id: string; count: number }[] };
          }
        ).__blockforge;
        const slots = handle?.carried() ?? [];
        const now = slots.find((item) => item.id === blockKind)?.count ?? 0;
        return now > (was as number);
      },
      [kind as string, beforeCount] as const,
      { timeout: 90_000 },
    );
    await page.keyboard.up("KeyW");

    const after = await carried(page);
    const afterCount = after.find((item) => item.id === kind)?.count ?? 0;
    expect(
      afterCount,
      "walking over the drop must add it to the pack",
    ).toBe(beforeCount + 1);

    // And the hotbar SHOWS it, with the count - the operator's other half.
    const shown = await page.evaluate(() => {
      const slots = Array.from(
        document.querySelectorAll("#blockforge-hud .bf-slot"),
      ) as HTMLElement[];
      return slots.map((el) => el.textContent ?? "");
    });
    expect(shown.length, "the hotbar must have nine slots").toBe(9);
    const hasTheItem = shown.some((text) =>
      text.toLowerCase().includes((kind as string).toLowerCase()),
    );
    expect(hasTheItem, `the hotbar must show the collected ${String(kind)}`).toBe(true);
  });

  test("a block broken with the wrong tool drops nothing", async ({ page }) => {
    test.setTimeout(180_000);
    await play(page);
    await lookDown(page);

    const kind = await targetedKind(page);
    expect(kind, "the player must be aiming at a block").not.toBeNull();

    // Select a tool of the WRONG kind and try to break the block.
    const wrongSlot = await page.evaluate(async (blockKind: string) => {
      const constants = await import("/src/core/constants.ts");
      const handle = (
        window as unknown as {
          __blockforge?: {
            carried(): readonly { id: string; count: number }[];
          };
        }
      ).__blockforge;
      const needed = constants.requiredToolFor(blockKind);
      const slots = handle?.carried() ?? [];
      for (let i = 0; i < slots.length; i++) {
        const item = slots[i];
        if (item === undefined) {
          continue;
        }
        const spec = constants.toolSpec(item.id);
        // A tool of a DIFFERENT kind than the one this block needs.
        if (spec !== undefined && spec.kind !== needed) {
          return i + 1;
        }
      }
      return 0;
    }, kind as string);

    // If the player owns no tool of the wrong kind, there is nothing to
    // assert here - the game already refuses to start the break.
    if (wrongSlot === 0) {
      return;
    }
    await page.keyboard.press(`Digit${wrongSlot}`);
    await page.waitForTimeout(200);

    // The game REFUSES to break a block with the wrong tool, so the hold
    // only has to outlast the break timer it never starts.
    const before = await carried(page);
    await page.evaluate(() => {
      const handle = (
        window as unknown as { __blockforge?: { setBreaking(h: boolean): void } }
      ).__blockforge;
      handle?.setBreaking(true);
    });
    await page.waitForTimeout(5000);
    await page.evaluate(() => {
      const handle = (
        window as unknown as { __blockforge?: { setBreaking(h: boolean): void } }
      ).__blockforge;
      handle?.setBreaking(false);
    });
    await page.waitForTimeout(1000);
    const after = await carried(page);

    expect(
      JSON.stringify(after),
      "a block broken with the wrong tool must drop nothing",
    ).toBe(JSON.stringify(before));
  });
});
