/**
 * Ingredient matching.
 */

import type { Ingredient, ItemStack } from "./types.ts";

/** All registered tags as `tagName -> member item ids`. */
export type TagSets = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Whether a stack satisfies one ingredient requirement.
 * Counts are deliberately ignored: a stack of any size satisfies a slot.
 */
export function matchesIngredient(
  stack: ItemStack,
  ingredient: Ingredient,
  tags: TagSets,
): boolean {
  switch (ingredient.kind) {
    case "item":
      return stack.item === ingredient.item;
    case "tag": {
      const members = tags.get(ingredient.tag);
      return members !== undefined && members.has(stack.item);
    }
  }
}

/** Stable identity key used to group equal ingredients. */
export function ingredientKey(ingredient: Ingredient): string {
  return ingredient.kind === "item" ? `item:${ingredient.item}` : `tag:${ingredient.tag}`;
}
