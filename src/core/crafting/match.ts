/**
 * BlockForge — matching a crafting grid against the recipe table.
 *
 * OWNERSHIP: GAMEPLAY. Pure: no DOM, no clock, no randomness.
 *
 * Two kinds of recipe, two kinds of match:
 *
 *   SHAPED     the recipe carries a `shape` - rows of cells, row-major. The
 *              pattern may sit anywhere in the grid, but every cell of the
 *              grid the pattern does NOT cover must be empty, so a 2x2
 *              recipe in a 3x3 grid has to be in a corner.
 *
 *   SHAPELESS  the recipe carries only `ingredients` - the multiset of
 *              tokens it consumes. The items may sit anywhere.
 *
 * A token is an item id or a tag, and a tag accepts a family of items (see
 * ./tags.ts). So the tokens of a recipe have to be matched to the items
 * available as a MATCHING PROBLEM, not a lookup: a recipe needing
 * ["#rock", "slate"] against a grid holding slate and rubble must give
 * #rock the rubble and "slate" the slate, and a greedy pass that gives
 * #rock the slate first would fail. The matcher below is a proper
 * augmenting-path matching, so it always finds the assignment when one
 * exists.
 *
 * DETERMINISM: crafting is pure. The same grid and the same recipe table
 * always give the same recipe and the same consumed cells, and no
 * ingredient is ever consumed at random. (The frozen Recipe has no chance
 * field, so there is no chance-based output to roll; if one is ever added
 * to the contract, its roll must come from the seeded PRNG in
 * src/core/rng.ts, never from Math.random.)
 */

import type { Recipe } from "../types.js";
import type { CraftingGrid } from "./grid.js";
import { RECIPES } from "./recipes.js";
import { ingredientAccepts } from "./tags.js";

/** A recipe matched against a grid: the recipe and the cells it uses. */
export interface RecipeMatch {
  readonly recipe: Recipe;
  /** The grid cells the recipe consumes, ascending. */
  readonly cells: readonly number[];
}

/**
 * Assign every token to a distinct item that satisfies it.
 *
 * `units` is one entry per ITEM available, so a stack of five planks is
 * five units and can satisfy five one-plank tokens. Returns the index into
 * `units` for each token, or null when no assignment exists.
 *
 * This is Kuhn's augmenting-path algorithm: deterministic, and it finds an
 * assignment whenever one exists - which a greedy pass does not.
 */
function matchUnits(tokens: readonly string[], units: readonly string[]): number[] | null {
  const assigned: number[] = new Array<number>(tokens.length).fill(-1);

  const tryAssign = (tokenIndex: number, seen: boolean[]): boolean => {
    const token = tokens[tokenIndex];
    if (token === undefined) {
      return false;
    }
    for (let unit = 0; unit < units.length; unit++) {
      const item = units[unit];
      if (item === undefined || seen[unit] === true) {
        continue;
      }
      if (!ingredientAccepts(token, item)) {
        continue;
      }
      seen[unit] = true;
      const holder = assigned.indexOf(unit);
      if (holder === -1 || tryAssign(holder, seen)) {
        assigned[tokenIndex] = unit;
        return true;
      }
    }
    return false;
  };

  for (let token = 0; token < tokens.length; token++) {
    if (!tryAssign(token, new Array<boolean>(units.length).fill(false))) {
      return null;
    }
  }
  return assigned;
}

/**
 * The shape of a recipe with its empty rows and columns trimmed.
 *
 * Trimming is what makes a 2x2 recipe fit in the 2x2 inventory grid, and
 * what lets the same recipe be placed in a corner of the 3x3 bench grid.
 */
function trimmedShape(
  recipe: Recipe,
): { rows: number; cols: number; cells: readonly (readonly string[])[] } | null {
  const shape = recipe.shape;
  if (shape === undefined) {
    return null;
  }
  let top = shape.length;
  let bottom = -1;
  let left = Number.POSITIVE_INFINITY;
  let right = -1;
  for (let row = 0; row < shape.length; row++) {
    const cells = shape[row] ?? [];
    for (let col = 0; col < cells.length; col++) {
      if ((cells[col] ?? "") !== "") {
        if (row < top) top = row;
        if (row > bottom) bottom = row;
        if (col < left) left = col;
        if (col > right) right = col;
      }
    }
  }
  if (bottom < 0) {
    return null;
  }
  const rows = bottom - top + 1;
  const cols = right - left + 1;
  const trimmed: string[][] = [];
  for (let row = top; row <= bottom; row++) {
    const cells = shape[row] ?? [];
    const out: string[] = [];
    for (let col = left; col <= right; col++) {
      out.push(cells[col] ?? "");
    }
    trimmed.push(out);
  }
  return { rows, cols, cells: trimmed };
}

/**
 * The tokens a recipe needs, one per item it consumes.
 *
 * For a shaped recipe that is the tokens of its shape; for a shapeless one
 * it is the recipe's own ingredient list. Both are the same multiset, and
 * both are what the recipe book counts.
 */
export function recipeTokens(recipe: Recipe): readonly string[] {
  if (recipe.kind === "shaped") {
    const shape = trimmedShape(recipe);
    if (shape === null) {
      return recipe.ingredients;
    }
    const tokens: string[] = [];
    for (const row of shape.cells) {
      for (const cell of row) {
        if (cell !== "") {
          tokens.push(cell);
        }
      }
    }
    return tokens;
  }
  return recipe.ingredients;
}

/**
 * The shape of a recipe as a grid of cells, for the recipe book to draw.
 *
 * A cell is the token that goes there, or null for an empty cell. The
 * result is always 3x3, the biggest grid in the game, so the recipe book
 * can lay every recipe out the same way.
 */
export function recipePattern(recipe: Recipe): readonly (readonly (string | null)[])[] {
  const empty: (string | null)[][] = [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];
  if (recipe.kind === "shapeless") {
    return empty;
  }
  const shape = trimmedShape(recipe);
  if (shape === null) {
    return empty;
  }
  const out: (string | null)[][] = [
    [null, null, null],
    [null, null, null],
    [null, null, null],
  ];
  for (let row = 0; row < shape.rows; row++) {
    const target = out[row];
    if (target === undefined) {
      continue;
    }
    for (let col = 0; col < shape.cols; col++) {
      const token = shape.cells[row]?.[col] ?? "";
      target[col] = token === "" ? null : token;
    }
  }
  return out;
}

/**
 * Does this shaped recipe match this grid?
 *
 * The pattern is tried at every offset it could occupy, and the first
 * offset that fits wins. The order is fixed, so the match is
 * deterministic: the same grid always consumes the same cells.
 */
function matchShaped(grid: CraftingGrid, recipe: Recipe): readonly number[] | null {
  const shape = trimmedShape(recipe);
  if (shape === null) {
    return null;
  }
  if (shape.rows > grid.width || shape.cols > grid.width) {
    return null;
  }
  for (let top = 0; top + shape.rows <= grid.width; top++) {
    for (let left = 0; left + shape.cols <= grid.width; left++) {
      const cells: number[] = [];
      let ok = true;
      for (let row = 0; row < grid.width && ok; row++) {
        for (let col = 0; col < grid.width && ok; col++) {
          const index = row * grid.width + col;
          const patternRow = row - top;
          const patternCol = col - left;
          const inside =
            patternRow >= 0 &&
            patternRow < shape.rows &&
            patternCol >= 0 &&
            patternCol < shape.cols;
          if (!inside) {
            // A cell the pattern does not cover must be empty.
            if (grid.cells[index] !== null) {
              ok = false;
            }
            continue;
          }
          const token = shape.cells[patternRow]?.[patternCol] ?? "";
          if (token === "") {
            // A hole in the pattern must be empty in the grid too.
            if (grid.cells[index] !== null) {
              ok = false;
            }
            continue;
          }
          const stack = grid.cells[index];
          if (stack === null || stack === undefined || !ingredientAccepts(token, stack.id)) {
            ok = false;
            continue;
          }
          cells.push(index);
        }
      }
      if (ok) {
        return cells;
      }
    }
  }
  return null;
}

/**
 * Does this shapeless recipe match this grid?
 *
 * Every item in the grid must be used and every token of the recipe must
 * be satisfied, so the counts have to agree, not just the kinds. Each
 * occupied cell is ONE item: a stack of five planks in one cell still
 * fills one slot, so it satisfies one plank token, not five.
 */
function matchShapeless(grid: CraftingGrid, recipe: Recipe): readonly number[] | null {
  const cells: number[] = [];
  const units: string[] = [];
  for (let index = 0; index < grid.cells.length; index++) {
    const stack = grid.cells[index];
    if (stack === undefined || stack === null) {
      continue;
    }
    cells.push(index);
    units.push(stack.id);
  }
  if (cells.length !== recipe.ingredients.length) {
    return null;
  }
  const assignment = matchUnits(recipe.ingredients, units);
  if (assignment === null) {
    return null;
  }
  return assignment.map((unit) => cells[unit] ?? -1).sort((a, b) => a - b);
}

/**
 * The recipe this grid makes, if any.
 *
 * The table is searched in order and the first match wins, so a grid that
 * satisfies two recipes always gives the same one.
 */
export function matchGrid(
  grid: CraftingGrid,
  recipes: readonly Recipe[] = RECIPES,
): RecipeMatch | null {
  for (const recipe of recipes) {
    const cells =
      recipe.kind === "shaped" ? matchShaped(grid, recipe) : matchShapeless(grid, recipe);
    if (cells !== null) {
      return { recipe, cells };
    }
  }
  return null;
}

/**
 * Can this recipe be made from what the player is carrying?
 *
 * `stock` is a list of item ids with how many of each there are. A stack
 * of five planks is five planks here, so a recipe that needs two planks
 * is affordable with one stack of five.
 */
export function canAfford(
  recipe: Recipe,
  stock: readonly { id: string; count: number }[],
): boolean {
  const tokens = recipeTokens(recipe);
  if (tokens.length === 0) {
    return false;
  }
  const units: string[] = [];
  for (const entry of stock) {
    for (let count = 0; count < entry.count; count++) {
      units.push(entry.id);
    }
  }
  return matchUnits(tokens, units) !== null;
}

/** The recipes a player could make from what they are carrying, in table order. */
export function availableRecipes(
  stock: readonly { id: string; count: number }[],
  recipes: readonly Recipe[] = RECIPES,
): readonly Recipe[] {
  return recipes.filter((recipe) => canAfford(recipe, stock));
}

/**
 * The size of the grid a recipe needs.
 *
 * A recipe that fits in 2x2 can be made in the inventory; one that needs
 * 3x3 has to be made at a craftbench.
 */
export function gridSizeFor(recipe: Recipe): 2 | 3 {
  const shape = trimmedShape(recipe);
  if (shape === null) {
    return 2;
  }
  return shape.rows > 2 || shape.cols > 2 ? 3 : 2;
}
