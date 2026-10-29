/**
 * Public surface of the crafting core.
 *
 * `src/core` is pure: no I/O, no wall-clock, no Math.random — all of this
 * module is deterministic and safe to run shared between client and server.
 */

export type {
  CraftingGrid,
  CraftResult,
  Ingredient,
  ItemIngredient,
  Recipe,
  ShapelessRecipe,
  ShapedRecipe,
  ItemStack,
} from "./types.ts";
export { EMPTY_PATTERN_CHARS } from "./types.ts";
export { CraftingRegistry } from "./registry.ts";
export type { RegistryInput } from "./registry.ts";
export { matchesIngredient, ingredientKey } from "./ingredient.ts";
export type { TagSets } from "./ingredient.ts";
export { nonEmptySlots, occupiedBox } from "./grid.ts";
export type { OccupiedBox } from "./grid.ts";
export { createStarterRegistry, STARTER_RECIPES, STARTER_TAGS } from "./starter.ts";
