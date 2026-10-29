import { describe, expect, it } from "vitest";
import { CraftingRegistry } from "../../src/core/crafting/registry.ts";
import type { ShapedRecipe } from "../../src/core/crafting/types.ts";
import { gridFromStrings } from "./helpers.ts";

const WOOD_TAGS = { planks: ["oak_planks", "spruce_planks"] };

const PLANKS_KEY = { P: { kind: "tag", tag: "planks" } } as const;

const STICKS: ShapedRecipe = {
  type: "shaped",
  id: "planks_to_sticks",
  pattern: ["P", "P"],
  key: PLANKS_KEY,
  output: { item: "stick", count: 4 },
};

const AB: ShapedRecipe = {
  type: "shaped",
  id: "ab",
  pattern: ["AB"],
  key: { A: { kind: "item", item: "coal" }, B: { kind: "item", item: "stick" } },
  output: { item: "ab_product", count: 1 },
};

const AB_NO_MIRROR: ShapedRecipe = { ...AB, id: "ab_no_mirror", allowMirrored: false };

const PICKAXE: ShapedRecipe = {
  type: "shaped",
  id: "wooden_pickaxe",
  pattern: ["PPP", " S ", " S "],
  key: { P: PLANKS_KEY.P, S: { kind: "item", item: "stick" } },
  output: { item: "wooden_pickaxe", count: 1 },
};

const TORCH: ShapedRecipe = {
  type: "shaped",
  id: "torch",
  pattern: ["C", "S"],
  key: { C: { kind: "item", item: "coal" }, S: { kind: "item", item: "stick" } },
  output: { item: "torch", count: 4 },
};

function registryWith(...recipes: readonly ShapedRecipe[]): CraftingRegistry {
  return new CraftingRegistry({ tags: WOOD_TAGS, recipes });
}

describe("shaped recipe matching", () => {
  it("matches a pattern at the grid origin", () => {
    const grid = gridFromStrings(["#.", "#.", ".."], { "#": "oak_planks" });
    expect(registryWith(STICKS).findRecipe(grid)?.id).toBe(STICKS.id);
  });

  it("matches a translated pattern anywhere in the grid", () => {
    const grid = gridFromStrings(["...", ".#.", ".#."], { "#": "spruce_planks" });
    expect(registryWith(STICKS).findRecipe(grid)?.id).toBe(STICKS.id);
  });

  it("matches mirrored patterns by default", () => {
    const registry = registryWith(AB);
    expect(registry.findRecipe(gridFromStrings(["AB"], { A: "coal", B: "stick" }))?.id).toBe(AB.id);
    expect(registry.findRecipe(gridFromStrings(["BA"], { A: "coal", B: "stick" }))?.id).toBe(AB.id);
  });

  it("rejects mirrors when the recipe opts out", () => {
    const registry = registryWith(AB_NO_MIRROR);
    expect(registry.findRecipe(gridFromStrings(["AB"], { A: "coal", B: "stick" }))?.id).toBe(
      AB_NO_MIRROR.id,
    );
    expect(registry.findRecipe(gridFromStrings(["BA"], { A: "coal", B: "stick" }))).toBeNull();
  });

  it("rejects wrong ingredients inside the box", () => {
    // Same 1x2 shape as the sticks recipe, but stone instead of planks.
    const grid = gridFromStrings(["x", "x"], { x: "cobblestone" });
    expect(registryWith(STICKS).findRecipe(grid)).toBeNull();
  });

  it("rejects stacks whose occupied box is larger than the pattern", () => {
    const grid = gridFromStrings(["#", "#", "#"], { "#": "oak_planks" });
    expect(registryWith(STICKS).findRecipe(grid)).toBeNull();
  });

  it("requires pattern holes to stay empty", () => {
    const registry = registryWith(PICKAXE);
    const good = gridFromStrings(["PPP", " S ", " S "], {
      P: "oak_planks",
      S: "stick",
    });
    expect(registry.findRecipe(good)?.id).toBe(PICKAXE.id);
    const holeFilled = gridFromStrings(["PPP", " SS", " S "], {
      P: "oak_planks",
      S: "stick",
    });
    expect(registry.findRecipe(holeFilled)).toBeNull();
  });

  it("returns null for an empty grid", () => {
    const grid = gridFromStrings(["...", "...", "..."], {});
    expect(registryWith(STICKS).findRecipe(grid)).toBeNull();
  });

  it("ignores stack counts", () => {
    const grid = gridFromStrings(["C", "S"], { C: "coal@5", S: "stick@9" });
    expect(registryWith(TORCH).findRecipe(grid)?.id).toBe(TORCH.id);
  });

  it("cannot satisfy a pattern taller than the grid", () => {
    const grid = gridFromStrings(["##", "##"], { "#": "oak_planks" });
    expect(registryWith(PICKAXE).findRecipe(grid)).toBeNull();
  });
});
