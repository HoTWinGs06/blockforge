/**
 * Shaped recipe matching.
 *
 * A player grid matches a shaped recipe when the bounding box of the
 * player's non-empty cells has the pattern's exact shape and every cell
 * satisfies its pattern ingredient. Empty grid cells may live anywhere
 * outside the box; nothing may live outside the pattern's occupied shape
 * inside the box (holes must stay empty).
 */

import { matchesIngredient, type TagSets } from "./ingredient.ts";
import { occupiedBox, slotAt, type OccupiedBox } from "./grid.ts";
import { EMPTY_PATTERN_CHARS } from "./types.ts";
import type { CraftingGrid, Ingredient, ShapedRecipe } from "./types.ts";

/** Safe row lookup; never throws, returns "" past the end. */
function rowAt(pattern: readonly string[], y: number): string {
  const row = pattern[y];
  return row === undefined ? "" : row;
}

/** Mirrored copy of a shaped pattern (every row reversed). */
function mirror(pattern: readonly string[]): string[] {
  return pattern.map((row) => [...row].reverse().join(""));
}

/**
 * Compare one candidate pattern (original or mirrored) against the
 * player's occupied box cell-for-cell.
 */
function patternFitsBox(
  grid: CraftingGrid,
  box: OccupiedBox,
  pattern: readonly string[],
  key: Readonly<Record<string, Ingredient>>,
  tags: TagSets,
): boolean {
  const patternHeight = pattern.length;
  const firstRow = pattern[0];
  const patternWidth = firstRow === undefined ? 0 : firstRow.length;
  if (patternWidth === 0 || box.width !== patternWidth || box.height !== patternHeight) {
    return false;
  }
  for (let y = 0; y < patternHeight; y++) {
    const row = rowAt(pattern, y);
    for (let x = 0; x < patternWidth; x++) {
      const symbol = row.charAt(x);
      const gridX = box.minX + x;
      const gridY = box.minY + y;
      const slot = slotAt(grid, gridY * grid.width + gridX);
      const expectsEmpty = symbol === "" || EMPTY_PATTERN_CHARS.includes(symbol);
      if (expectsEmpty) {
        if (slot !== null) {
          return false;
        }
        continue;
      }
      const ingredient = key[symbol];
      // Unknown symbols are impossible for validated recipes, but treat
      // them defensively as "cannot match".
      if (slot === null || ingredient === undefined) {
        return false;
      }
      if (!matchesIngredient(slot, ingredient, tags)) {
        return false;
      }
    }
  }
  return true;
}

/** Does this grid satisfy the shaped recipe? */
export function matchShaped(grid: CraftingGrid, recipe: ShapedRecipe, tags: TagSets): boolean {
  const box = occupiedBox(grid);
  if (box === null) {
    return false;
  }
  if (patternFitsBox(grid, box, recipe.pattern, recipe.key, tags)) {
    return true;
  }
  const allowMirrored = recipe.allowMirrored ?? true;
  return allowMirrored && patternFitsBox(grid, box, mirror(recipe.pattern), recipe.key, tags);
}
