/**
 * BlockForge — the crafting session: what the player can make, and making it.
 *
 * OWNERSHIP: GAMEPLAY. Pure: no DOM, no clock, no randomness.
 *
 * This is the layer between the raw matching in src/core/crafting/ and the
 * screen. It answers the two questions the screen asks:
 *
 *   "what can I make from what I am carrying?"   -> recipeBook()
 *   "what does this grid make, and what does making it cost me?" -> craft()
 *
 * and it does the bookkeeping of a craft: the ingredients leave the grid
 * and the result arrives in the inventory. The screen never has to think
 * about which cells were used.
 *
 * DETERMINISM: a craft is a pure function of (grid, recipes). The same grid
 * always gives the same result and consumes the same cells, and no
 * ingredient is ever consumed at random.
 */

import type { ItemStack, Recipe } from "../core/types.js";
import {
  availableRecipes,
  gridWithout,
  matchGrid,
  type CraftingGrid,
  type GridSize,
  type RecipeMatch,
} from "../core/crafting/index.js";
import { RECIPES } from "../core/crafting/index.js";

/** The item id and how many the player is carrying of it. */
export interface StockEntry {
  readonly id: string;
  readonly count: number;
}

/** A craft that has been performed: what came out, and what was left. */
export interface CraftOutcome {
  /** The item the craft produced. */
  readonly result: ItemStack;
  /** The grid with the ingredients taken out of it. */
  readonly grid: CraftingGrid;
}

/** The stock of a list of stacks: what the player is carrying, by item. */
export function stockOf(stacks: readonly (ItemStack | null | undefined)[]): StockEntry[] {
  const counts = new Map<string, number>();
  for (const stack of stacks) {
    if (stack === null || stack === undefined) {
      continue;
    }
    counts.set(stack.id, (counts.get(stack.id) ?? 0) + stack.count);
  }
  return [...counts.entries()].map(([id, count]) => ({ id, count }));
}

/**
 * The recipes the player could make from what they are carrying.
 *
 * This is the recipe book, in the order the table is written, so the
 * screen can page through it and mark off what is affordable.
 */
export function recipeBook(
  stacks: readonly (ItemStack | null | undefined)[],
  recipes: readonly Recipe[] = RECIPES,
): readonly Recipe[] {
  return availableRecipes(stockOf(stacks), recipes);
}

/** What the given grid would make, or null if it makes nothing. */
export function preview(grid: CraftingGrid, recipes: readonly Recipe[] = RECIPES): RecipeMatch | null {
  return matchGrid(grid, recipes);
}

/**
 * Make whatever the grid makes, and take the ingredients out of it.
 *
 * Returns null when the grid makes nothing, so the screen can refuse the
 * craft rather than silently doing nothing.
 */
export function craft(grid: CraftingGrid, recipes: readonly Recipe[] = RECIPES): CraftOutcome | null {
  const match = matchGrid(grid, recipes);
  if (match === null) {
    return null;
  }
  return {
    result: match.recipe.result,
    grid: gridWithout(grid, match.cells),
  };
}

/**
 * The size of the grid a player has open.
 *
 * The inventory grid is 2x2; standing at a craftbench it is 3x3. A recipe
 * that needs 3x3 simply does not match a 2x2 grid, so the size is the
 * whole rule.
 */
export function gridSize(hasCraftbench: boolean): GridSize {
  return hasCraftbench ? 3 : 2;
}
