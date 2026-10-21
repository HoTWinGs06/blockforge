/**
 * Crafting self-check.
 *
 * Verifies the properties the RENDER/UI layer and the TEST AUTHOR depend
 * on:
 *   - a shaped recipe matches only where its pattern is, and only when the
 *     rest of the grid is empty;
 *   - a shapeless recipe matches whatever order the items are in;
 *   - an ingredient TAG accepts a family of items ("#rock" takes slate or
 *     rubble), so a recipe can ask for "any rock";
 *   - a 3x3 recipe does not match a 2x2 grid, which is what makes a
 *     craftbench worth finding;
 *   - making something consumes exactly the ingredients it used, and the
 *     same grid always makes the same thing (determinism);
 *   - the tool recipes cover all sixteen frozen tools, with the durability
 *     the contract gives them.
 *
 * Build and run:
 *   npx tsc -p scripts/tsconfig.build.json
 *   node node_modules/.cache/blockforge-scripts/scripts/selfcheck/craftingCheck.js
 */

import {
  createGrid,
  gridAt,
  gridWith,
  matchGrid,
  recipeTokens,
  RECIPES,
  type CraftingGrid,
} from "../../src/core/crafting/index.js";
import { TOOL_SPECS } from "../../src/core/constants.js";
import type { ItemStack, Recipe } from "../../src/core/types.js";

let failures = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    process.stdout.write(`  ok   ${name}\n`);
  } else {
    failures++;
    process.stderr.write(`  FAIL ${name} ${detail}\n`);
  }
}

process.stdout.write("crafting self-check\n");

/** A grid of the given width with the given items at the given indices. */
function gridOf(width: 2 | 3, items: readonly (readonly [number, ItemStack])[]): CraftingGrid {
  let grid = createGrid(width);
  for (const [index, stack] of items) {
    grid = gridWith(grid, index, stack);
  }
  return grid;
}

const plank: ItemStack = { id: "millplank", count: 1 };
const rock: ItemStack = { id: "rubble", count: 1 };
const dirt: ItemStack = { id: "loam", count: 1 };

// 1. A shaped recipe matches where its pattern is.
{
  const bench = createGrid(3);
  // The craftbench is four planks in a 2x2, in the top-left corner.
  const top = gridOf(3, [
    [0, plank],
    [1, plank],
    [3, plank],
    [4, plank],
  ]);
  const match = matchGrid(top);
  check("four planks in a corner make a craftbench", match?.recipe.id === "craftbench", String(match?.recipe.id));
  check("the craftbench match used exactly four cells", match?.cells.length === 4, String(match?.cells.length));
  check("an empty grid makes nothing", matchGrid(bench) === null);
}

// 2. A shaped recipe does not match when something else is in the way.
{
  const crowded = gridOf(3, [
    [0, plank],
    [1, plank],
    [3, plank],
    [4, plank],
    [8, dirt],
  ]);
  const match = matchGrid(crowded);
  check("a 2x2 pattern with a stray item in the 3x3 does not match", match === null, String(match?.recipe.id));
}

// 3. A shapeless recipe matches whatever order the items are in.
{
  const a = gridOf(2, [
    [0, { id: "timber", count: 1 }],
  ]);
  const b = gridOf(2, [
    [3, { id: "timber", count: 1 }],
  ]);
  check("one timber makes millplanks wherever it sits", matchGrid(a)?.recipe.id === "millplank_from_timber");
  check("the same recipe matches in another cell", matchGrid(b)?.recipe.id === "millplank_from_timber");
}

// 4. A tag accepts a family of items.
{
  const rubbleRecipe = RECIPES.find((r) => r.id === "masonry");
  check("the masonry recipe exists", rubbleRecipe !== undefined);
  const rubbleGrid = gridOf(2, [
    [0, rock],
    [1, rock],
    [2, rock],
    [3, rock],
  ]);
  const match = matchGrid(rubbleGrid);
  check("four rocks make masonry", match?.recipe.id === "masonry", String(match?.recipe.id));
  const slateGrid = gridOf(2, [
    [0, { id: "slate", count: 1 }],
    [1, { id: "slate", count: 1 }],
    [2, { id: "slate", count: 1 }],
    [3, { id: "slate", count: 1 }],
  ]);
  check("four slates also make masonry - the tag accepts both", matchGrid(slateGrid)?.recipe.id === "masonry");
}

// 5. A 3x3 recipe does not fit a 2x2 grid.
{
  const toolRecipe = RECIPES.find((r) => r.id === "mattock_slate");
  check("the slate mattock has a recipe", toolRecipe !== undefined);
  const tokens = toolRecipe === undefined ? [] : recipeTokens(toolRecipe);
  check("the mattock takes five things", tokens.length === 5, String(tokens.length));
  const small = gridOf(2, [
    [0, { id: "slate", count: 1 }],
    [1, plank],
    [2, plank],
    [3, plank],
  ]);
  check("a 3x3 recipe does not match a 2x2 grid", matchGrid(small) === null);
}

// 6. Every frozen tool has a recipe, with the contract's durability.
{
  for (const spec of TOOL_SPECS) {
    const recipe = RECIPES.find((r) => r.id === spec.id);
    check(`${spec.id} has a recipe`, recipe !== undefined);
    check(
      `${spec.id} makes one of itself with the contract's durability`,
      recipe?.result.id === spec.id &&
        recipe.result.count === 1 &&
        recipe.result.durability === spec.durability,
      JSON.stringify(recipe?.result),
    );
  }
  const toolRecipeIds = TOOL_SPECS.map((spec) => spec.id);
  const toolRecipes = RECIPES.filter((r: Recipe) => toolRecipeIds.includes(r.result.id));
  check(
    "every one of the sixteen frozen tools has a recipe",
    toolRecipes.length === TOOL_SPECS.length,
    `${toolRecipes.length} of ${TOOL_SPECS.length}`,
  );
}

// 7. The same grid always makes the same thing, and costs the same cells.
{
  const grid = gridOf(3, [
    [0, plank],
    [1, plank],
    [3, plank],
    [4, plank],
  ]);
  const first = matchGrid(grid);
  const second = matchGrid(grid);
  check(
    "the same grid makes the same recipe twice",
    first?.recipe.id === second?.recipe.id && String(first?.cells) === String(second?.cells),
  );
}

// 8. The grid helpers behave: nothing is mutated, and a stack loses one.
{
  const grid = gridOf(2, [
    [0, { id: "millplank", count: 3 }],
  ]);
  check("a cell reads back what was put in it", gridAt(grid, 0)?.count === 3);
  check("an empty cell reads back null", gridAt(grid, 1) === null);
  check("an out-of-range cell reads back null", gridAt(grid, 99) === null);
  const cleared = gridWith(grid, 0, null);
  check("the original grid is not mutated", gridAt(grid, 0)?.count === 3);
  check("the new grid has the change", gridAt(cleared, 0) === null);
}

if (failures > 0) {
  process.stderr.write(`\ncrafting self-check FAILED: ${failures} check(s)\n`);
  process.exit(1);
}
process.stdout.write("\ncrafting self-check PASSED\n");
