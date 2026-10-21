/**
 * T61 DIAGNOSTIC: "the blocks all look the same".
 *
 * The architect's point was that this is a ten-minute diagnostic between two
 * very different bugs:
 *   - the ATLAS is wrong (distinct cells do not appear in the atlas), or
 *   - the LIGHTING is wrong (the atlas is fine but the rendered image is too
 *     dark for the differences to show).
 *
 * This runs in a REAL browser because the atlas is drawn on a real canvas.
 * That matters: a canvas mock would not prove that the drawing code produces
 * the pixels we think it does.
 *
 * It renders the atlas to a canvas and asserts that the cells are actually
 * DIFFERENT from each other. If they are, the bug is downstream in the
 * lighting or the UV mapping, not in the palette.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.describe("T61: the procedural atlas", () => {
  test("every block kind has a DIFFERENT colour in the atlas", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });

    const result = await page.evaluate(async () => {
      const mod = await import("/src/render/textures.ts");
      const types = await import("/src/core/types.ts");
      const canvas = mod.buildAtlasCanvas();
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return { error: "no 2d context" };
      }
      const kinds = [
        types.BlockId.Slate,
        types.BlockId.Regolith,
        types.BlockId.Loam,
        types.BlockId.Sand,
        types.BlockId.Timber,
        types.BlockId.Foliage,
        types.BlockId.Tidewater,
        types.BlockId.Lumencrystal,
      ];
      const colours: string[] = [];
      for (let i = 0; i < kinds.length; i++) {
        const col = i % mod.ATLAS_COLUMNS;
        const row = Math.floor(i / mod.ATLAS_COLUMNS);
        const d = ctx.getImageData(col * mod.TILE_PX + 8, row * mod.TILE_PX + 8, 1, 1).data;
        colours.push(`${d[0]},${d[1]},${d[2]}`);
      }
      // And the UVs: two block kinds must never map to the same atlas region.
      const uvSets = new Set<string>();
      for (const id of Object.values(types.BlockId)) {
        if (id === types.BlockId.Air) continue;
        uvSets.add(mod.faceUv(id).map((c) => c.join(",")).join("|"));
      }
      return { colours, distinct: new Set(colours).size, uvCount: uvSets.size, kindCount: kinds.length };
    });

    expect(result.error).toBeUndefined();
    expect(
      result.distinct,
      "every sampled block kind must have a DIFFERENT colour in the atlas",
    ).toBe(result.kindCount);
    process.stdout.write(`  atlas colours: ${(result.colours ?? []).join("  ")}\n`);
  });

  test("each block kind maps to a DISTINCT atlas region", async ({ page }: { page: Page }) => {
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });

    const uvCount = await page.evaluate(async () => {
      const mod = await import("/src/render/textures.ts");
      const types = await import("/src/core/types.ts");
      const uvSets = new Set<string>();
      for (const id of Object.values(types.BlockId)) {
        if (id === types.BlockId.Air) continue;
        uvSets.add(mod.faceUv(id).map((c) => c.join(",")).join("|"));
      }
      return uvSets.size;
    });

    expect(uvCount, "22 non-air block kinds must produce 22 distinct UV sets").toBe(22);
  });
});
