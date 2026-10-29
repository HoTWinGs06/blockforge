import { describe, expect, it } from "vitest";
import { CraftingRegistry } from "../../src/core/crafting/registry.ts";
import type { ShapelessRecipe } from "../../src/core/crafting/types.ts";
import { gridFromStrings } from "./helpers.ts";

const TAGS = {
  wood: ["oak_log", "spruce_log"],
  planks: ["oak_planks", "spruce_planks"],
};

const ANY_WOOD: ShapelessRecipe = {
  type: "shapeless",
  id: "any_wood",
  ingredients: [{ kind: "tag", tag: "wood" }],
  output: { item: "workpiece", count: 1 },
};

const TWO_OAK_PLANKS: ShapelessRecipe = {
  type: "shapeless",
  id: "two_oak_planks",
  ingredients: [
    { kind: "item", item: "oak_planks" },
    { kind: "item", item: "oak_planks" },
  ],
  output: { item: "oak_board", count: 1 },
};

const MIXED: ShapelessRecipe = {
  type: "shapeless",
  id: "mixed",
  ingredients: [
    { kind: "item", item: "oak_planks" },
    { kind: "item", item: "stick" },
  ],
  output: { item: "plank_handle", count: 1 },
};

const PLANKS_AND_EXACT_OAK: ShapelessRecipe = {
  type: "shapeless",
  id: "planks_and_exact_oak",
  ingredients: [
    { kind: "tag", tag: "planks" },
    { kind: "item", item: "oak_planks" },
  ],
  output: { item: "special_board", count: 1 },
};

function registryWith(...recipes: readonly ShapelessRecipe[]): CraftingRegistry {
  return new CraftingRegistry({ tags: TAGS, recipes });
}

describe("shapeless recipe matching", () => {
  it("is order- and position-independent", () => {
    const registry = registryWith(MIXED);
    expect(registry.findRecipe(gridFromStrings(["PS"], { P: "oak_planks", S: "stick" }))?.id).toBe(
      MIXED.id,
    );
    expect(registry.findRecipe(gridFromStrings(["SP"], { P: "oak_planks", S: "stick" }))?.id).toBe(
      MIXED.id,
    );
  });

  it("splits one cell per ingredient slot (a big stack is not two slots)", () => {
    const registry = registryWith(TWO_OAK_PLANKS);
    expect(
      registry.findRecipe(gridFromStrings(["P."], { P: "oak_planks@2" })),
    ).toBeNull();
    expect(registry.findRecipe(gridFromStrings(["PP"], { P: "oak_planks" }))?.id).toBe(
      TWO_OAK_PLANKS.id,
    );
  });

  it("satisfied by any member of a required tag", () => {
    const registry = registryWith(ANY_WOOD);
    expect(
      registry.findRecipe(gridFromStrings(["o"], { o: "oak_log" }))?.id,
    ).toBe(ANY_WOOD.id);
    expect(
      registry.findRecipe(gridFromStrings(["s"], { s: "spruce_log" }))?.id,
    ).toBe(ANY_WOOD.id);
    expect(registry.findRecipe(gridFromStrings(["x"], { x: "cobblestone" }))).toBeNull();
  });

  it("assigns overlapping candidates via backtracking", () => {
    const registry = registryWith(PLANKS_AND_EXACT_OAK);
    // Greedy matching would waste the tag slot on the oak stack first.
    expect(
      registry.findRecipe(gridFromStrings(["PS"], { P: "oak_planks", S: "spruce_planks" }))?.id,
    ).toBe(PLANKS_AND_EXACT_OAK.id);
    expect(
      registry.findRecipe(gridFromStrings(["SP"], { P: "oak_planks", S: "spruce_planks" }))?.id,
    ).toBe(PLANKS_AND_EXACT_OAK.id);
  });

  it("rejects more occupied slots than ingredients", () => {
    const grid = gridFromStrings(["PPO"], { P: "oak_planks", O: "oak_planks" });
    expect(registryWith(TWO_OAK_PLANKS).findRecipe(grid)).toBeNull();
  });

  it("rejects unmatched items", () => {
    const grid = gridFromStrings(["SX"], { S: "stick", X: "cobblestone" });
    expect(registryWith(MIXED).findRecipe(grid)).toBeNull();
  });

  it("rejects an empty grid", () => {
    const grid = gridFromStrings(["..", ".."], {});
    expect(registryWith(ANY_WOOD).findRecipe(grid)).toBeNull();
  });
});
