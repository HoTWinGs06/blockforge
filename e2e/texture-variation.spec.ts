import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * T61 REGRESSION GUARD: the world must not render as one flat texture.
 *
 * This is the bug the operator reported as "no different colour textures for
 * the blocks". It took four wrong hypotheses to find, so the guard is written
 * to catch the CLASS of defect, not just the one instance:
 *
 *   1. The atlas is wrong                - ruled out: 8 distinct colours.
 *   2. The lighting is wrong             - ruled out: the terrain was pure
 *                                          black (0,0,0), which a lit textured
 *                                          surface can never be.
 *   3. The UV rewrite used BlockIds      - ruled out: MeshOutput.blocks holds
 *                                          ORDINALS, and every lookup missed
 *                                          so every face fell back to tile 0.
 *   4. The uv ATTRIBUTE was mis-sized    - SUSPECTED, then shown not to be
 *                                          the cause. The mesher pushes eight
 *                                          UV floats per quad (four corners,
 *                                          two floats each) for four
 *                                          vertices, so output.uvs is already
 *                                          exactly two floats per vertex and
 *                                          sizing the attribute by it is
 *                                          correct. The guard below asserts
 *                                          that property so it stays that
 *                                          way.
 *
 * THE ACTUAL CAUSE was hypothesis 3: MeshOutput.blocks holds ORDINALS, and
 * the renderer treated them as BlockIds. Every lookup missed, every face fell
 * back to tile 0, and the whole world was one flat texture.
 *
 * The guard: build a real chunk mesh with the engine's mesher, run the
 * renderer's UV rewrite, and assert that the resulting vertex-indexed uv
 * attribute covers the whole atlas and samples many distinct colours.
 */
test.describe("T61 guard: the world must not be one flat texture", () => {
  test("the uv attribute is sized by the vertex count and spans the atlas", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto("/");
    await page.waitForSelector("#blockforge-hud", { timeout: 30_000 });

    const result = await page.evaluate(async () => {
      const engine = await import("/src/engine/index.ts");
      const world = await import("/src/core/world.ts");
      const tex = await import("/src/render/textures.ts");
      const renderer = await import("/src/render/renderer.ts");

      const store = new engine.ChunkStore(1337);
      const output = store.meshChunk({ cx: 0, cz: 0 });
      const chunk = renderer.buildChunkMesh({ cx: 0, cz: 0 }, output);

      const uv = chunk.mesh.geometry.getAttribute("uv");
      const vertexCount = chunk.mesh.geometry.getAttribute("position").count;

      let uMin = Infinity;
      let uMax = -Infinity;
      let vMin = Infinity;
      let vMax = -Infinity;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        const v = uv.getY(i);
        if (u < uMin) uMin = u;
        if (u > uMax) uMax = u;
        if (v < vMin) vMin = v;
        if (v > vMax) vMax = v;
      }

      // How many distinct colours do the faces actually sample?
      const canvas = tex.buildAtlasCanvas();
      const ctx = canvas.getContext("2d");
      const colours = new Set<string>();
      if (ctx) {
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i);
          const v = uv.getY(i);
          const px = Math.min(canvas.width - 1, Math.max(0, Math.floor(u * canvas.width)));
          const py = Math.min(canvas.height - 1, Math.max(0, Math.floor((1 - v) * canvas.height)));
          const d = ctx.getImageData(px, py, 1, 1).data;
          colours.add(`${d[0] >> 4},${d[1] >> 4},${d[2] >> 4}`);
        }
      }

      return {
        // three.js's BufferAttribute.count is the number of VECTORS, and
        // itemSize is the floats per vector. So a correct uv attribute has
        // count === vertexCount and itemSize === 2.
        uvCount: uv.count,
        uvItemSize: uv.itemSize,
        vertexCount,
        uvVectorsPerVertex: uv.count / vertexCount,
        uRange: [uMin, uMax],
        vRange: [vMin, vMax],
        distinctColours: colours.size,
        distinctBlockIds: new Set(Array.from(output.blocks)).size,
        blockFromOrdinalWorks: (() => {
          try {
            world.blockFromOrdinal(output.blocks[0] ?? 0);
            return true;
          } catch {
            return false;
          }
        })(),
      };
    });

    process.stdout.write(`  T61 GUARD: ${JSON.stringify(result)}\n`);

    // One uv VECTOR per vertex, two floats per vector.
    expect(result.uvVectorsPerVertex).toBe(1);
    expect(result.uvItemSize).toBe(2);
    expect(result.uvCount).toBe(result.vertexCount);

    // The UVs must span the whole atlas, not one tile column.
    expect(result.uRange[0]).toBeLessThanOrEqual(0.001);
    expect(result.uRange[1]).toBeGreaterThan(0.9);
    expect(result.vRange[0]).toBeLessThanOrEqual(0.001);
    expect(result.vRange[1]).toBeGreaterThan(0.9);

    // And the faces must sample MANY different colours, not one.
    expect(result.distinctColours).toBeGreaterThan(3);
    expect(result.distinctBlockIds).toBeGreaterThan(1);
    expect(result.blockFromOrdinalWorks).toBe(true);
  });
});
