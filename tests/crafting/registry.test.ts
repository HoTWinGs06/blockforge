import { describe, expect, it } from "vitest";
import { CraftingRegistry } from "../../src/core/crafting/registry.ts";
import type { CraftingGrid, Recipe, ShapedRecipe, ShapelessRecipe } from "../../src/core/crafting/types.ts";
import { gridFromStrings, stack } from "./helpers.ts";

const ANY_WOOD: ShapelessRecipe = {
  type: "shapeless",
  id: "any_wood",
  ingredients: [{ kind: "tag", tag: "wood" }],
  output: { item: "workpiece", count: 1 },
};

const STICKS: ShapedRecipe = {
  type: "shaped",
  id: "planks_to_sticks",
  pattern: ["P", "P"],
  key: { P: { kind: "item", item: "oak_planks" } },
  output: { item: "stick", count: 4 },
};

const ONE_BY_ONE: ShapedRecipe = {
  type: "shaped",
  id: "single",
  pattern: ["S"],
  key: { S: { kind: "item", item: "oak_log" } },
  output: { item: "sawdust", count: 1 },
};

function validGrid(): CraftingGrid {
  return gridFromStrings(["o"], { o: "oak_log" });
}

function expectRegisterError(recipe: Recipe, message: string, tags?: Record<string, readonly string[]>): void {
  const registry = new CraftingRegistry({ tags });
  expect(() => registry.register(recipe)).toThrow(message);
}

describe("CraftingRegistry recipe validation", () => {
  it("throws on duplicate ids", () => {
    const registry = new CraftingRegistry({
      tags: { wood: ["oak_log"] },
      recipes: [ANY_WOOD],
    });
    expect(() => registry.register(ANY_WOOD)).toThrow('Duplicate crafting recipe id: "any_wood"');
  });

  it("throws on an empty id", () => {
    expectRegisterError({ ...ANY_WOOD, id: "" }, "non-empty string");
  });

  it("throws on unknown pattern characters", () => {
    const bad: ShapedRecipe = { ...STICKS, id: "bad", pattern: ["P", "Q"] };
    expectRegisterError(bad, '"Q" has no entry in the recipe key');
  });

  it("throws on ragged patterns", () => {
    const bad: ShapedRecipe = { ...STICKS, id: "ragged", pattern: ["PP", "P"] };
    expectRegisterError(bad, "row 1 has length 1, expected 2");
  });

  it("throws on empty pattern rows", () => {
    const bad: ShapedRecipe = { ...STICKS, id: "blank_row", pattern: [""] };
    expectRegisterError(bad, "pattern rows must not be empty strings");
  });

  it("throws on all-empty patterns", () => {
    const bad: ShapedRecipe = { ...STICKS, id: "all_blank", pattern: [" . "] };
    expectRegisterError(bad, "at least one occupied cell");
  });

  it("throws on shapeless recipes without ingredients", () => {
    expectRegisterError({ ...ANY_WOOD, ingredients: [] }, "at least one ingredient");
  });

  it("throws on output counts below 1", () => {
    expectRegisterError({ ...ANY_WOOD, output: { item: "x", count: 0 } }, "count must be a whole number >= 1");
  });

  it("throws on empty output item ids", () => {
    expectRegisterError({ ...ANY_WOOD, output: { item: "", count: 1 } }, "output has an empty item id");
  });

  it("throws on unknown tags", () => {
    expectRegisterError(ANY_WOOD, 'unknown tag "wood"', {});
  });

  it("throws on empty ingredient item ids", () => {
    expectRegisterError(
      { ...ANY_WOOD, ingredients: [{ kind: "item", item: "" }] },
      "ingredient 0 has an empty item id",
    );
  });

  it("throws on non-integer counts", () => {
    expectRegisterError(
      { ...ANY_WOOD, output: { item: "x", count: 1.5 } },
      "count must be a whole number >= 1",
    );
  });
});

describe("CraftingRegistry grid validation", () => {
  it("throws when the slot count does not match the dimensions", () => {
    const registry = new CraftingRegistry({ recipes: [ANY_WOOD], tags: { wood: [] } });
    const bad: CraftingGrid = { width: 2, height: 2, slots: [null, null, null] };
    expect(() => registry.findRecipe(bad)).toThrow("expected 4 slots");
  });

  it("throws when dimensions are below 1", () => {
    const registry = new CraftingRegistry();
    const bad: CraftingGrid = { width: 0, height: 1, slots: [] };
    expect(() => registry.findRecipe(bad)).toThrow("dimensions must be >= 1");
  });

  it("throws when a slot count is below 1", () => {
    const registry = new CraftingRegistry();
    const bad: CraftingGrid = { width: 1, height: 1, slots: [{ item: "oak_log", count: 0 }] };
    expect(() => registry.findRecipe(bad)).toThrow("count must be a whole number >= 1");
  });

  it("throws when a slot item id is empty", () => {
    const registry = new CraftingRegistry();
    const bad: CraftingGrid = { width: 1, height: 1, slots: [{ item: "", count: 1 }] };
    expect(() => registry.craft(bad)).toThrow("slot 0 has an empty item id");
  });
});

describe("CraftingRegistry queries", () => {
  it("finds recipes in registration priority order", () => {
    const second: ShapelessRecipe = { ...ANY_WOOD, id: "overwrite_attempt", output: { item: "other", count: 1 } };
    const registry = new CraftingRegistry({ tags: { wood: ["oak_log"] }, recipes: [ANY_WOOD, second] });
    const found = registry.findRecipe(validGrid());
    expect(found?.id).toBe(ANY_WOOD.id);
  });

  it("returns registered recipes and tag data through the accessors", () => {
    const registry = new CraftingRegistry({
      tags: { wood: ["oak_log", "spruce_log"] },
      recipes: [ANY_WOOD],
    });
    expect(registry.getRecipe(ANY_WOOD.id)?.id).toBe(ANY_WOOD.id);
    expect(registry.getRecipe("missing")).toBeUndefined();
    expect(registry.getRecipes().map((entry) => entry.id)).toEqual([ANY_WOOD.id]);
    expect(registry.hasTag("wood")).toBe(true);
    expect(registry.hasTag("stone")).toBe(false);
    expect(registry.getTag("wood")).toEqual(["oak_log", "spruce_log"]);
    expect(registry.getTag("stone")).toBeUndefined();
  });

  it("returns null instead of throwing for a non-matching or empty grid", () => {
    const registry = new CraftingRegistry({ recipes: [ONE_BY_ONE] });
    expect(registry.findRecipe(gridFromStrings(["x"], { x: "cobblestone" }))).toBeNull();
    expect(registry.findRecipe(gridFromStrings(["..."], {}))).toBeNull();
  });

  it("craft returns ok:false without a match", () => {
    const registry = new CraftingRegistry({ recipes: [ONE_BY_ONE] });
    const result = registry.craft(gridFromStrings(["x"], { x: "cobblestone" }));
    expect(result).toEqual({ ok: false });
  });
});

describe("CraftingRegistry", () => {
  it("accepts recipes via the constructor", () => {
    const registry = new CraftingRegistry({ recipes: [ONE_BY_ONE] });
    expect(registry.getRecipe("single")).toBeDefined();
  });

  it("stack helper produces a valid single stack", () => {
    expect(stack("oak_log")).toEqual({ item: "oak_log", count: 1 });
  });
});
