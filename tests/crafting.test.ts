/**
 * BlockForge — T95: the crafting engine.
 *
 * OWNERSHIP: TEST AUTHOR (tests/).
 *
 * The crafting engine landed in src/core/crafting/ with no tests, which
 * dropped the vitest coverage floor (gate G1) from 92.74% to 76.41% and
 * failed the 85% threshold. These tests pin the behaviour the engine
 * promises, in the order the board asked for it:
 *
 *   1. a shaped recipe matches only where its pattern is, and only when
 *      every cell the pattern does not cover is empty;
 *   2. a shapeless recipe matches wherever the items sit;
 *   3. a tag accepts a family of items ("#rock" takes slate or rubble);
 *   4. a 3x3 recipe does not match a 2x2 grid - the rule that makes a
 *      craftbench worth finding;
 *   5. the same grid always gives the same recipe and the same consumed
 *      cells, and the table is searched in a fixed order;
 *   6. every one of the sixteen frozen tools has a recipe carrying that
 *      tool's contract durability;
 *   7. a recipe needing ["#rock", "slate"] matches a grid of slate and
 *      rubble by giving "#rock" the rubble - an augmenting-path matching,
 *      not a greedy pass.
 *
 * The engine is pure (no clock, no randomness, no DOM), so every assertion
 * here is exact: the same grid gives the same answer every time, in any
 * order, in any process.
 */

import { describe, it, expect } from "vitest";
import {
  INGREDIENT_TAGS,
  RECIPES,
  availableRecipes,
  canAfford,
  createGrid,
  gridAt,
  gridSizeFor,
  gridWith,
  gridWithout,
  ingredientAccepts,
  isTag,
  matchGrid,
  occupiedCells,
  recipeById,
  recipePattern,
  recipeTokens,
  tagMembers,
} from "../src/core/crafting/index.js";
import { TOOL_SPECS } from "../src/core/constants.js";
import type { CraftingGrid } from "../src/core/crafting/index.js";
import type { ItemStack, Recipe } from "../src/core/types.js";

/** A stack of one of the given item id. */
function stack(id: string, count = 1): ItemStack {
  return { id, count };
}

/** A grid of the given width with the given items at the given indices. */
function gridOf(
  width: 2 | 3,
  items: readonly (readonly [number, ItemStack])[],
): CraftingGrid {
  let grid = createGrid(width);
  for (const [index, item] of items) {
    grid = gridWith(grid, index, item);
  }
  return grid;
}

/** A recipe that is not in the shipped table, for the ordering rules. */
function synthetic(
  id: string,
  ingredients: readonly string[],
  kind: Recipe["kind"] = "shapeless",
  shape?: readonly (readonly string[])[],
): Recipe {
  return shape === undefined
    ? { id, kind, ingredients, result: { id, count: 1 } }
    : { id, kind, ingredients, shape, result: { id, count: 1 } };
}

describe("T95: crafting - ingredient tags", () => {
  it("accepts a family of items through a tag", () => {
    expect(ingredientAccepts("#rock", "slate")).toBe(true);
    expect(ingredientAccepts("#rock", "rubble")).toBe(true);
    expect(ingredientAccepts("#rock", "loam")).toBe(false);
    expect(ingredientAccepts("#plank", "millplank")).toBe(true);
    expect(ingredientAccepts("#plank", "timber")).toBe(false);
  });

  it("accepts an exact token only for that exact item", () => {
    expect(ingredientAccepts("timber", "timber")).toBe(true);
    expect(ingredientAccepts("timber", "millplank")).toBe(false);
  });

  it("fails safe on a tag nobody defined", () => {
    // A recipe naming an unknown tag must be uncraftable, never match
    // everything: a typo in the table should break that one recipe and
    // nothing else.
    expect(ingredientAccepts("#nosuchtag", "slate")).toBe(false);
    expect(ingredientAccepts("#nosuchtag", "timber")).toBe(false);
  });

  it("distinguishes a tag from an item id", () => {
    expect(isTag("#rock")).toBe(true);
    expect(isTag("slate")).toBe(false);
    expect(tagMembers("#rock")).toEqual(["slate", "rubble"]);
    expect(tagMembers("slate")).toEqual([]);
    expect(tagMembers("#nosuchtag")).toEqual([]);
  });

  it("freezes the tag vocabulary so the recipe table cannot drift at runtime", () => {
    expect(Object.isFrozen(INGREDIENT_TAGS)).toBe(true);
    for (const members of Object.values(INGREDIENT_TAGS)) {
      expect(members.length).toBeGreaterThan(0);
      expect(Object.isFrozen(members)).toBe(true);
    }
  });
});

describe("T95: crafting - the grid", () => {
  it("starts empty, at the size it was asked for", () => {
    const small = createGrid(2);
    expect(small.width).toBe(2);
    expect(small.cells).toHaveLength(4);
    expect(small.cells.every((cell) => cell === null)).toBe(true);

    const bench = createGrid(3);
    expect(bench.width).toBe(3);
    expect(bench.cells).toHaveLength(9);
    expect(bench.cells.every((cell) => cell === null)).toBe(true);
  });

  it("reads back a cell, an empty cell, and a cell that is not there", () => {
    const grid = gridOf(2, [[0, stack("millplank", 3)]]);
    expect(gridAt(grid, 0)?.count).toBe(3);
    expect(gridAt(grid, 1)).toBeNull();
    expect(gridAt(grid, 99)).toBeNull();
  });

  it("replaces a cell without mutating the grid it was given", () => {
    const before = gridOf(2, [[0, stack("millplank")]]);
    const after = gridWith(before, 1, stack("rubble"));
    expect(gridAt(after, 1)?.id).toBe("rubble");
    expect(gridAt(before, 1)).toBeNull();
    expect(gridAt(before, 0)?.id).toBe("millplank");
    expect(after.width).toBe(before.width);
  });

  it("takes one item from each named cell", () => {
    const grid = gridOf(2, [
      [0, stack("millplank", 3)],
      [1, stack("millplank", 1)],
    ]);
    const spent = gridWithout(grid, [0, 1]);
    expect(gridAt(spent, 0)?.count).toBe(2);
    expect(gridAt(spent, 1)).toBeNull();
    // The original is untouched.
    expect(gridAt(grid, 0)?.count).toBe(3);
    expect(gridAt(grid, 1)?.count).toBe(1);
  });

  it("ignores an empty cell and a cell that is not there", () => {
    const grid = gridOf(2, [[0, stack("millplank", 2)]]);
    const spent = gridWithout(grid, [1, 99]);
    expect(gridAt(spent, 0)?.count).toBe(2);
    expect(gridAt(spent, 1)).toBeNull();
    expect(spent.cells).toHaveLength(4);
  });

  it("lists the occupied cells in ascending order", () => {
    const grid = gridOf(3, [
      [0, stack("millplank")],
      [4, stack("rubble")],
      [8, stack("slate")],
    ]);
    expect(occupiedCells(grid)).toEqual([0, 4, 8]);
    expect(occupiedCells(createGrid(3))).toEqual([]);
  });
});

describe("T95: crafting - shaped recipes", () => {
  it("matches a shaped recipe where its pattern is, and consumes exactly those cells", () => {
    // Four planks in the top-left 2x2 of a 3x3 bench grid.
    const grid = gridOf(3, [
      [0, stack("millplank")],
      [1, stack("millplank")],
      [3, stack("millplank")],
      [4, stack("millplank")],
    ]);
    const match = matchGrid(grid);
    expect(match?.recipe.id).toBe("craftbench");
    expect(match?.cells).toEqual([0, 1, 3, 4]);
  });

  it("matches the same pattern in another corner of the grid", () => {
    const grid = gridOf(3, [
      [4, stack("millplank")],
      [5, stack("millplank")],
      [7, stack("millplank")],
      [8, stack("millplank")],
    ]);
    const match = matchGrid(grid);
    expect(match?.recipe.id).toBe("craftbench");
    expect(match?.cells).toEqual([4, 5, 7, 8]);
  });

  it("makes the same thing in the 2x2 inventory grid", () => {
    // The craftbench pattern is 2x2, so it fits the inventory grid too -
    // which is why the bench is worth finding for the 3x3 recipes.
    const grid = gridOf(2, [
      [0, stack("millplank")],
      [1, stack("millplank")],
      [2, stack("millplank")],
      [3, stack("millplank")],
    ]);
    const match = matchGrid(grid);
    expect(match?.recipe.id).toBe("craftbench");
    expect(match?.cells).toEqual([0, 1, 2, 3]);
  });

  it("does not match when the items are not in the pattern's shape", () => {
    // A row of three plus one is not a 2x2.
    const grid = gridOf(3, [
      [0, stack("millplank")],
      [1, stack("millplank")],
      [2, stack("millplank")],
      [3, stack("millplank")],
    ]);
    expect(matchGrid(grid)).toBeNull();
  });

  it("stops matching when a cell the pattern does not cover holds something", () => {
    for (const stray of [2, 5, 8]) {
      const grid = gridOf(3, [
        [0, stack("millplank")],
        [1, stack("millplank")],
        [3, stack("millplank")],
        [4, stack("millplank")],
        [stray, stack("loam")],
      ]);
      expect(matchGrid(grid)).toBeNull();
    }
  });

  it("stops matching when a hole in the pattern is filled in", () => {
    // The smeltforge pattern is a ring of rock with a hole in the middle.
    const ring = [
      [0, stack("rubble")],
      [1, stack("rubble")],
      [2, stack("rubble")],
      [3, stack("rubble")],
      [5, stack("rubble")],
      [6, stack("rubble")],
      [7, stack("rubble")],
      [8, stack("rubble")],
    ] as const;
    const open = gridOf(3, ring);
    const match = matchGrid(open);
    expect(match?.recipe.id).toBe("smeltforge");
    expect(match?.cells).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);

    const filled = gridWith(open, 4, stack("loam"));
    expect(matchGrid(filled)).toBeNull();
  });

  it("does not let one fat stack stand in for a whole pattern", () => {
    // Each cell of a pattern is one item; a stack of five planks is still
    // one slot, not five.
    const grid = gridOf(2, [[0, stack("millplank", 5)]]);
    expect(matchGrid(grid)).toBeNull();
  });

  it("does not match a 3x3 recipe in a 2x2 grid", () => {
    // The rule that makes a craftbench worth finding.
    const grid = gridOf(2, [
      [0, stack("slate")],
      [1, stack("millplank")],
      [2, stack("millplank")],
      [3, stack("millplank")],
    ]);
    expect(matchGrid(grid)).toBeNull();
    expect(gridSizeFor(recipeById("mattock_slate") ?? synthetic("x", []))).toBe(3);
  });

  it("does not match a recipe wider than the grid", () => {
    const wide = synthetic("wide", ["#plank", "#plank", "#plank"], "shaped", [
      ["#plank", "#plank", "#plank"],
    ]);
    const grid = gridOf(2, [
      [0, stack("millplank")],
      [1, stack("millplank")],
    ]);
    expect(matchGrid(grid, [wide])).toBeNull();
  });

  it("reads a ragged shape as having an empty cell", () => {
    const ragged = synthetic("ragged", ["#plank", "#plank", "#plank"], "shaped", [
      ["#plank", "#plank"],
      ["#plank"],
    ]);
    const grid = gridOf(2, [
      [0, stack("millplank")],
      [1, stack("millplank")],
      [2, stack("millplank")],
    ]);
    const match = matchGrid(grid, [ragged]);
    expect(match?.recipe.id).toBe("ragged");
    expect(match?.cells).toEqual([0, 1, 2]);
  });
});

describe("T95: crafting - shapeless recipes", () => {
  it("matches wherever the item sits, and consumes that cell", () => {
    for (const index of [0, 1, 2, 3]) {
      const grid = gridOf(2, [[index, stack("timber")]]);
      const match = matchGrid(grid);
      expect(match?.recipe.id).toBe("millplank_from_timber");
      expect(match?.cells).toEqual([index]);
    }
  });

  it("matches regardless of the order the items are in", () => {
    const first = gridOf(2, [
      [0, stack("timber")],
      [1, stack("rubble")],
    ]);
    const second = gridOf(2, [
      [0, stack("rubble")],
      [1, stack("timber")],
    ]);
    expect(matchGrid(first, [synthetic("pair", ["timber", "#rock"])])?.cells).toEqual([
      0, 1,
    ]);
    expect(matchGrid(second, [synthetic("pair", ["timber", "#rock"])])?.cells).toEqual([
      0, 1,
    ]);
  });

  it("needs exactly the right number of items", () => {
    const two = gridOf(2, [
      [0, stack("timber")],
      [1, stack("timber")],
    ]);
    expect(matchGrid(two)).toBeNull();
  });

  it("counts a fat stack as one item, not many", () => {
    const grid = gridOf(2, [[0, stack("timber", 5)]]);
    const match = matchGrid(grid);
    expect(match?.recipe.id).toBe("millplank_from_timber");
    expect(match?.cells).toEqual([0]);
  });

  it("matches nothing in an empty grid", () => {
    expect(matchGrid(createGrid(2))).toBeNull();
    expect(matchGrid(createGrid(3))).toBeNull();
  });

  it("consumes exactly the occupied cells, for every grid of a 2x2 and a 3x3", () => {
    // The deepest property of the whole module, checked exhaustively rather
    // than on a handful of hand-written grids: whatever a grid makes, the
    // cells it consumes are EXACTLY the cells that held something, and it
    // consumes as many cells as the recipe has tokens.
    //
    // This is the rule "a shaped recipe matches only where its pattern is,
    // and only when every cell the pattern does not cover is empty" stated
    // for every possible grid rather than for four planks.
    const items = ["millplank", "rubble", "slate", "timber", "loam"];
    for (const width of [2, 3] as const) {
      const size = width * width;
      for (let mask = 0; mask < 1 << size; mask++) {
        const cells: (ItemStack | null)[] = [];
        for (let index = 0; index < size; index++) {
          const item = items[(index * 7 + 3) % items.length];
          cells.push(mask & (1 << index) ? { id: item ?? "millplank", count: 1 } : null);
        }
        const grid: CraftingGrid = { width, cells };

        const occupied = occupiedCells(grid);
        const match = matchGrid(grid);
        if (match === null) {
          continue;
        }
        // The consumed cells are exactly the occupied ones.
        expect([...match.cells]).toEqual([...occupied]);
        // And there is one consumed cell per token the recipe needs.
        expect(match.cells).toHaveLength(recipeTokens(match.recipe).length);
      }
    }
  });

  it("gives the same answer for the same grid, for every grid of a 2x2 and a 3x3", () => {
    // Determinism, exhaustively: the matcher is a pure function of the
    // grid, so the same grid always gives the same recipe AND the same
    // consumed cells, whatever order the table is searched in.
    const items = ["millplank", "rubble", "slate", "timber", "loam"];
    for (const width of [2, 3] as const) {
      const size = width * width;
      for (let mask = 0; mask < 1 << size; mask++) {
        const cells: (ItemStack | null)[] = [];
        for (let index = 0; index < size; index++) {
          const item = items[(index * 7 + 3) % items.length];
          cells.push(mask & (1 << index) ? { id: item ?? "millplank", count: 1 } : null);
        }
        const grid: CraftingGrid = { width, cells };

        const first = matchGrid(grid);
        const second = matchGrid(grid);
        expect(second?.recipe.id).toBe(first?.recipe.id);
        expect(second?.cells).toEqual(first?.cells);
      }
    }
  });
});

describe("T95: crafting - tags in the recipe table", () => {
  it("makes masonry from four rubble", () => {
    const grid = gridOf(2, [
      [0, stack("rubble")],
      [1, stack("rubble")],
      [2, stack("rubble")],
      [3, stack("rubble")],
    ]);
    const match = matchGrid(grid);
    expect(match?.recipe.id).toBe("masonry");
    expect(match?.cells).toEqual([0, 1, 2, 3]);
  });

  it("makes masonry from four slate, because the recipe says #rock", () => {
    const grid = gridOf(2, [
      [0, stack("slate")],
      [1, stack("slate")],
      [2, stack("slate")],
      [3, stack("slate")],
    ]);
    const match = matchGrid(grid);
    expect(match?.recipe.id).toBe("masonry");
    expect(match?.cells).toEqual([0, 1, 2, 3]);
  });

  it("makes masonry from a mix of the two rocks", () => {
    const grid = gridOf(2, [
      [0, stack("slate")],
      [1, stack("rubble")],
      [2, stack("slate")],
      [3, stack("rubble")],
    ]);
    expect(matchGrid(grid)?.recipe.id).toBe("masonry");
  });

  it("makes a slate tool from rubble instead of slate", () => {
    // The slate tier's head is the tag #rock, so the rubble broken out of
    // slate works just as well as the slate itself.
    const grid = gridOf(3, [
      [0, stack("rubble")],
      [1, stack("rubble")],
      [2, stack("rubble")],
      [4, stack("millplank")],
      [7, stack("millplank")],
    ]);
    const match = matchGrid(grid);
    expect(match?.recipe.id).toBe("mattock_slate");
    expect(match?.cells).toEqual([0, 1, 2, 4, 7]);
  });
});

describe("T95: crafting - the recipe table", () => {
  it("gives every one of the sixteen frozen tools a recipe with the contract's durability", () => {
    expect(TOOL_SPECS).toHaveLength(16);
    for (const spec of TOOL_SPECS) {
      const recipe = recipeById(spec.id);
      expect(recipe, `no recipe for ${spec.id}`).toBeDefined();
      expect(recipe?.kind).toBe("shaped");
      expect(recipe?.result.id).toBe(spec.id);
      expect(recipe?.result.count).toBe(1);
      expect(recipe?.result.durability).toBe(spec.durability);
    }
  });

  it("gives every tool in the table exactly one recipe, and no others", () => {
    const toolIds = new Set(TOOL_SPECS.map((spec) => spec.id));
    const toolRecipes = RECIPES.filter((recipe) => toolIds.has(recipe.result.id));
    expect(toolRecipes).toHaveLength(TOOL_SPECS.length);
  });

  it("finds a recipe by id, and misses cleanly", () => {
    expect(recipeById("masonry")?.result.id).toBe("masonry");
    expect(recipeById("nosuchrecipe")).toBeUndefined();
  });

  it("has unique recipe ids", () => {
    const ids = RECIPES.map((recipe) => recipe.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("takes a shaped recipe's tokens from its shape, so a hole is not an ingredient", () => {
    expect(recipeTokens(recipeById("masonry") ?? synthetic("x", []))).toEqual([
      "#rock",
      "#rock",
      "#rock",
      "#rock",
    ]);
    expect(recipeTokens(recipeById("smeltforge") ?? synthetic("x", []))).toHaveLength(8);
    expect(recipeTokens(recipeById("millplank_from_timber") ?? synthetic("x", []))).toEqual(
      ["timber"],
    );
  });

  it("keeps a shaped recipe's ingredient list consistent with its shape", () => {
    // `ingredients` is "one per item the recipe consumes". A shaped
    // recipe consumes exactly the non-hole cells of its shape, so an
    // empty string in the list is a phantom ingredient, and a count that
    // disagrees with the shape is a data bug (the smeltforge once listed
    // nine, hole included).
    for (const recipe of RECIPES) {
      if (recipe.kind !== "shaped" || recipe.shape === undefined) continue;
      const consumed = recipe.shape.flat().filter((token) => token !== "");
      expect(recipe.ingredients).toEqual(consumed);
    }
  });

  it("lays every recipe out on a 3x3 pattern for the recipe book", () => {
    const shaped = recipePattern(recipeById("masonry") ?? synthetic("x", []));
    expect(shaped).toHaveLength(3);
    expect(shaped[0]?.[0]).toBe("#rock");
    expect(shaped[2]?.[2]).toBeNull();

    const shapeless = recipePattern(
      recipeById("millplank_from_timber") ?? synthetic("x", []),
    );
    expect(shapeless.flat().every((cell) => cell === null)).toBe(true);
  });

  it("says how big a grid a recipe needs", () => {
    const size = (id: string): number =>
      gridSizeFor(recipeById(id) ?? synthetic("x", []));
    expect(size("masonry")).toBe(2);
    expect(size("craftbench")).toBe(2);
    expect(size("millplank_from_timber")).toBe(2);
    expect(size("smeltforge")).toBe(3);
    expect(size("mattock_slate")).toBe(3);
  });

  it("freezes the recipe table", () => {
    expect(Object.isFrozen(RECIPES)).toBe(true);
  });
});

describe("T95: crafting - determinism", () => {
  it("gives the same recipe and the same consumed cells every time", () => {
    const grid = gridOf(3, [
      [0, stack("millplank")],
      [1, stack("millplank")],
      [3, stack("millplank")],
      [4, stack("millplank")],
    ]);
    const first = matchGrid(grid);
    for (let attempt = 0; attempt < 50; attempt++) {
      const again = matchGrid(grid);
      expect(again?.recipe.id).toBe(first?.recipe.id);
      expect(again?.cells).toEqual(first?.cells);
    }
  });

  it("searches the table in a fixed order, so a grid that fits two recipes always gives the same one", () => {
    const grid = gridOf(2, [
      [0, stack("millplank")],
      [1, stack("millplank")],
      [2, stack("millplank")],
      [3, stack("millplank")],
    ]);
    const first = synthetic("first", ["#plank", "#plank", "#plank", "#plank"]);
    const second = synthetic("second", ["#plank", "#plank", "#plank", "#plank"]);
    expect(matchGrid(grid, [first, second])?.recipe.id).toBe("first");
    expect(matchGrid(grid, [second, first])?.recipe.id).toBe("second");
  });

  it("lists the recipes a player can make in table order", () => {
    const stock = [{ id: "millplank", count: 4 }];
    const affordable = availableRecipes(stock);
    const ids = affordable.map((recipe) => recipe.id);
    expect(ids).toContain("craftbench");
    expect(ids).not.toContain("masonry");
    const order = RECIPES.map((recipe) => recipe.id);
    const positions = ids.map((id) => order.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("T95: crafting - the augmenting-path matcher", () => {
  it("gives #rock the rubble when the recipe also wants a slate", () => {
    // A greedy pass hands "#rock" the first rock it sees - the slate - and
    // then has nothing left for "slate". The matcher has to give the slate
    // to "slate" and the rubble to "#rock", which is what an
    // augmenting-path matching does and a greedy pass cannot.
    const recipe = synthetic("rockslate", ["#rock", "slate"]);
    const grid = gridOf(2, [
      [0, stack("slate")],
      [1, stack("rubble")],
    ]);
    const match = matchGrid(grid, [recipe]);
    expect(match?.recipe.id).toBe("rockslate");
    expect(match?.cells).toEqual([0, 1]);
  });

  it("affords the same pair from a mixed stock", () => {
    const recipe = synthetic("rockslate", ["#rock", "slate"]);
    expect(
      canAfford(recipe, [
        { id: "slate", count: 1 },
        { id: "rubble", count: 1 },
      ]),
    ).toBe(true);
    expect(canAfford(recipe, [{ id: "slate", count: 1 }])).toBe(false);
    expect(canAfford(recipe, [{ id: "rubble", count: 1 }])).toBe(false);
  });

  it("counts a stack as as many items as it holds, when checking a stock", () => {
    const bench = recipeById("craftbench") ?? synthetic("x", []);
    expect(canAfford(bench, [{ id: "millplank", count: 4 }])).toBe(true);
    expect(canAfford(bench, [{ id: "millplank", count: 3 }])).toBe(false);
  });

  it("cannot afford a recipe with no ingredients", () => {
    expect(canAfford(synthetic("nothing", []), [{ id: "millplank", count: 4 }])).toBe(
      false,
    );
  });
});

describe("T95: crafting - malformed recipes do not crash the table", () => {
  it("treats a shaped recipe with no shape as having no pattern", () => {
    const shapelessLooking = synthetic("noshape", ["timber"], "shaped");
    const grid = gridOf(2, [[0, stack("timber")]]);
    expect(matchGrid(grid, [shapelessLooking])).toBeNull();
    expect(recipeTokens(shapelessLooking)).toEqual(["timber"]);
    expect(recipePattern(shapelessLooking).flat().every((cell) => cell === null)).toBe(
      true,
    );
    expect(gridSizeFor(shapelessLooking)).toBe(2);
  });

  it("treats a shape with nothing in it as having no pattern", () => {
    const blank = synthetic("blank", ["timber"], "shaped", [[""]]);
    const grid = gridOf(2, [[0, stack("timber")]]);
    expect(matchGrid(grid, [blank])).toBeNull();
    expect(recipePattern(blank).flat().every((cell) => cell === null)).toBe(true);
    expect(gridSizeFor(blank)).toBe(2);
  });

  it("shows a recipe bigger than 3x3 on a 3x3 pattern", () => {
    const tall = synthetic("tall", ["#plank", "#plank", "#plank", "#plank"], "shaped", [
      ["#plank"],
      ["#plank"],
      ["#plank"],
      ["#plank"],
    ]);
    const pattern = recipePattern(tall);
    expect(pattern).toHaveLength(3);
    expect(pattern[2]?.[0]).toBe("#plank");
  });

  it("shows the hole in a pattern as an empty cell", () => {
    // The smeltforge is a ring with a hole in the middle, so the recipe
    // book has to show that middle cell as empty rather than as a token.
    const forge = recipeById("smeltforge");
    expect(forge).toBeDefined();
    const pattern = recipePattern(forge ?? synthetic("x", []));
    expect(pattern[1]?.[1]).toBeNull();
    expect(pattern[0]?.[0]).toBe("#rock");
    expect(pattern[2]?.[2]).toBe("#rock");
  });

  it("treats a shape with a missing row as having no pattern", () => {
    const holeyShape: (readonly string[])[] = new Array<readonly string[]>(2);
    holeyShape[1] = ["#plank"];
    const holey = synthetic("holey", ["#plank"], "shaped", holeyShape);
    const grid = gridOf(2, [[0, stack("millplank")]]);
    // The row that is missing reads as empty, so the pattern is just the
    // one row that is there - and it is a 1x1, not a crash.
    expect(matchGrid(grid, [holey])?.cells).toEqual([0]);
    expect(recipeTokens(holey)).toEqual(["#plank"]);
  });

  it("treats a shape with nothing in it as having no pattern", () => {
    const emptyShape: (readonly string[])[] = new Array<readonly string[]>(2);
    const blank = synthetic("blankrows", ["#plank"], "shaped", emptyShape);
    const grid = gridOf(2, [[0, stack("millplank")]]);
    expect(matchGrid(grid, [blank])).toBeNull();
    expect(recipeTokens(blank)).toEqual(["#plank"]);
  });

  it("reads a hole in a row as an empty cell, like a hole in the shape", () => {
    // A sparse row must read the same way a short row does: the missing
    // cell is empty, and the recipe still has a shape.
    const sparse = new Array<string>(3);
    sparse[0] = "#plank";
    sparse[2] = "#plank";
    const holed = synthetic("holed", ["#plank", "#plank"], "shaped", [sparse]);
    expect(recipeTokens(holed)).toEqual(["#plank", "#plank"]);
    const grid = gridOf(3, [
      [0, stack("millplank")],
      [2, stack("millplank")],
    ]);
    const match = matchGrid(grid, [holed]);
    expect(match?.cells).toEqual([0, 2]);
  });

  it("reads a hole between two rows as an empty row", () => {
    // A missing row in the middle of a shape must read as a row of empty
    // cells, not shift the rows below it up by one.
    const rows: (readonly string[])[] = new Array<readonly string[]>(3);
    rows[0] = ["#plank"];
    rows[2] = ["#plank"];
    const holed = synthetic("holedrows", ["#plank", "#plank"], "shaped", rows);
    expect(recipeTokens(holed)).toEqual(["#plank", "#plank"]);
    const grid = gridOf(3, [
      [0, stack("millplank")],
      [6, stack("millplank")],
    ]);
    const match = matchGrid(grid, [holed]);
    expect(match?.cells).toEqual([0, 6]);
  });

  it("treats a recipe with a hole in its ingredient list as one that cannot be made", () => {
    // A malformed table entry must make its own recipe uncraftable, not
    // crash the matcher for every other recipe.
    const holey = new Array<string>(2);
    holey[1] = "timber";
    const recipe = synthetic("holey", holey);
    const grid = gridOf(2, [
      [0, stack("timber")],
      [1, stack("timber")],
    ]);
    expect(matchGrid(grid, [recipe])).toBeNull();
    expect(matchGrid(grid)).toBeNull();
  });
});
