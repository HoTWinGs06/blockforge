import { describe, expect, it } from "vitest";
import { CraftingRegistry } from "../../src/core/crafting/registry.ts";
import { createStarterRegistry } from "../../src/core/crafting/starter.ts";
import { gridFromStrings } from "./helpers.ts";

const TAGS = { wood: ["oak_log"], planks: ["oak_planks"] };

const LOG_TO_PLANKS = {
  type: "shapeless",
  id: "oak_log_to_planks",
  ingredients: [{ kind: "item", item: "oak_log" }],
  output: { item: "oak_planks", count: 4 },
} as const;

const STICKS = {
  type: "shaped",
  id: "planks_to_sticks",
  pattern: ["P", "P"],
  key: { P: { kind: "tag", tag: "planks" } },
  output: { item: "stick", count: 4 },
} as const;

function smallRegistry(): CraftingRegistry {
  return new CraftingRegistry({ tags: TAGS, recipes: [LOG_TO_PLANKS, STICKS] });
}

describe("craft()", () => {
  it("consumes exactly 1 item per occupied slot and keeps leftovers", () => {
    const grid = gridFromStrings(["#", "#"], { "#": "oak_planks@4" });
    const result = smallRegistry().craft(grid);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.recipe.id).toBe(STICKS.id);
    expect(result.output).toEqual({ item: "stick", count: 4 });
    expect(result.afterSlots).toEqual([
      { item: "oak_planks", count: 3 },
      { item: "oak_planks", count: 3 },
    ]);
  });

  it("empties slots that reach zero items", () => {
    const grid = gridFromStrings(["o"], { o: "oak_log" });
    const result = smallRegistry().craft(grid);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.output).toEqual({ item: "oak_planks", count: 4 });
    expect(result.afterSlots).toEqual([null]);
  });

  it("leaves empty slots untouched", () => {
    // A single log placed at any position satisfies the 1-slot recipe.
    const grid = gridFromStrings(["..", ".o"], { o: "oak_log" });
    const result = smallRegistry().craft(grid);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.recipe.id).toBe(LOG_TO_PLANKS.id);
    expect(result.afterSlots).toEqual([null, null, null, null]);
  });

  it("returns a fresh output stack, never the recipe's own object", () => {
    const grid = gridFromStrings(["o"], { o: "oak_log" });
    const registry = smallRegistry();
    const recipe = registry.getRecipe(LOG_TO_PLANKS.id);
    expect(recipe).toBeDefined();
    const result = registry.craft(grid);
    expect(result.ok).toBe(true);
    if (!result.ok || recipe === undefined) {
      return;
    }
    expect(result.output).toEqual(recipe.output);
    expect(result.output).not.toBe(recipe.output);
  });

  it("returns ok:false for grids that match nothing", () => {
    const grid = gridFromStrings(["X"], { X: "cobblestone" });
    expect(smallRegistry().craft(grid)).toEqual({ ok: false });
  });
});

describe("starter recipes", () => {
  const starter = createStarterRegistry();

  it("craft planks from logs", () => {
    const result = starter.craft(gridFromStrings(["o"], { o: "oak_log" }));
    expect(result.ok && result.output).toEqual({ item: "oak_planks", count: 4 });
    const spruce = starter.craft(gridFromStrings(["s"], { s: "spruce_log" }));
    expect(spruce.ok && spruce.output).toEqual({ item: "spruce_planks", count: 4 });
  });

  it("crafts sticks from a vertical pair of planks (any wood)", () => {
    const result = starter.craft(gridFromStrings(["#", "#"], { "#": "spruce_planks" }));
    expect(result.ok && result.recipe.id).toBe("planks_to_sticks");
  });

  it("crafts a crafting table from a 2x2 of planks", () => {
    const result = starter.craft(gridFromStrings(["##", "##"], { "#": "oak_planks" }));
    expect(result.ok && result.output).toEqual({ item: "crafting_table", count: 1 });
  });

  it("crafts torches from coal above a stick", () => {
    const result = starter.craft(gridFromStrings(["C", "S"], { C: "coal", S: "stick" }));
    expect(result.ok && result.output).toEqual({ item: "torch", count: 4 });
  });

  it("requires torch orientation (stick below coal)", () => {
    const result = starter.craft(gridFromStrings(["S", "C"], { C: "coal", S: "stick" }));
    expect(result.ok).toBe(false);
  });

  it("crafts the wooden pickaxe on a crafting table grid", () => {
    const result = starter.craft(
      gridFromStrings(["PPP", " S ", " S "], { P: "oak_planks", S: "stick" }),
    );
    expect(result.ok && result.recipe.id).toBe("wooden_pickaxe");
  });

  it("cannot fit the pickaxe on the 2x2 player grid", () => {
    const result = starter.craft(gridFromStrings(["##", "##"], { "#": "oak_planks" }));
    expect(result.ok && result.recipe.id).toBe("crafting_table");
  });

  it("finds nothing on empty or unrelated grids", () => {
    expect(starter.craft(gridFromStrings(["..", ".."], {})).ok).toBe(false);
    expect(starter.craft(gridFromStrings(["x"], { x: "diamond" })).ok).toBe(false);
  });
});
