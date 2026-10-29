/**
 * Shapeless recipe matching.
 *
 * Ingredients are position- and order-independent, so the multiset of the
 * player's non-empty cells must satisfy the recipe's ingredient multiset.
 * Each occupied slot is consumed by exactly one ingredient entry — a single
 * stack of count 4 never stands in for four separate slots.
 *
 * Because an item can satisfy several ingredients at once (an "item"
 * ingredient somewhere else, several overlapping tags), candidates are
 * assigned with a small deterministic backtracking search. Grids are at
 * most 3x3, so this is trivially cheap and fully deterministic.
 */

import {
  ingredientKey,
  matchesIngredient,
  type TagSets,
} from "./ingredient.ts";
import { nonEmptySlots, slotAt } from "./grid.ts";
import type { CraftingGrid, Ingredient, ShapelessRecipe } from "./types.ts";

interface IngredientGroup {
  readonly ingredient: Ingredient;
  /** How many slots this entry must consume. */
  needed: number;
}

/** Does this grid satisfy the shapeless recipe? */
export function matchShapeless(
  grid: CraftingGrid,
  recipe: ShapelessRecipe,
  tags: TagSets,
): boolean {
  // Group equal ingredients. Deterministic: first-seen order.
  const groups: IngredientGroup[] = [];
  const keyToGroup = new Map<string, IngredientGroup>();
  for (const ingredient of recipe.ingredients) {
    const key = ingredientKey(ingredient);
    const existing = keyToGroup.get(key);
    if (existing === undefined) {
      const group: IngredientGroup = { ingredient, needed: 1 };
      groups.push(group);
      keyToGroup.set(key, group);
    } else {
      existing.needed += 1;
    }
  }

  const occupied = nonEmptySlots(grid);
  if (occupied.length !== recipe.ingredients.length) {
    return false;
  }

  // Candidate groups per occupied slot, in ascending group order.
  const candidates: number[][] = occupied.map((slotIndex) => {
    const slot = slotAt(grid, slotIndex);
    // nonEmptySlots guarantees a stack; defensive fallback: no candidates.
    if (slot === null) {
      return [];
    }
    const matches: number[] = [];
    for (const [groupIndex, group] of groups.entries()) {
      if (matchesIngredient(slot, group.ingredient, tags)) {
        matches.push(groupIndex);
      }
    }
    return matches;
  });

  const used = new Map<number, number>();
  // Backtrack slots in index order, trying candidates in group order.
  const assign = (slotPosition: number): boolean => {
    if (slotPosition === candidates.length) {
      return true;
    }
    for (const groupIndex of candidates[slotPosition] ?? []) {
      const group = groups[groupIndex];
      if (group === undefined) {
        continue;
      }
      const usedCount = used.get(groupIndex) ?? 0;
      if (usedCount < group.needed) {
        used.set(groupIndex, usedCount + 1);
        if (assign(slotPosition + 1)) {
          return true;
        }
        used.set(groupIndex, usedCount);
      }
    }
    return false;
  };

  return assign(0);
}
