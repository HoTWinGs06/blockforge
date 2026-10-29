/**
 * The crafting registry: recipe storage, validation, and lookup.
 *
 * Pure and deterministic. Registration is fail-fast: rule violations throw
 * with a descriptive error at add time, so a bad recipe can never silently
 * match nothing at play time.
 */

import type { TagSets } from "./ingredient.ts";
import { occupiedBox } from "./grid.ts";
import { matchShaped } from "./shaped.ts";
import { matchShapeless } from "./shapeless.ts";
import type {
  CraftingGrid,
  CraftResult,
  Ingredient,
  Recipe,
  ShapelessRecipe,
  ShapedRecipe,
  ItemStack,
} from "./types.ts";
import { EMPTY_PATTERN_CHARS } from "./types.ts";

/** Construction input for `CraftingRegistry`. */
export interface RegistryInput {
  /** Tags referenced by recipe ingredients, e.g. `{ planks: [...] }`. */
  readonly tags?: Readonly<Record<string, readonly string[]>>;
  /** Recipes to register immediately, in priority order (first match wins). */
  readonly recipes?: readonly Recipe[];
}

/** Guard rails shared by every grid-consuming entry point. */
function assertGrid(grid: CraftingGrid): void {
  if (grid.width < 1 || grid.height < 1) {
    throw new Error(
      `Invalid crafting grid: dimensions must be >= 1 (got ${grid.width}x${grid.height}).`,
    );
  }
  const expected = grid.width * grid.height;
  if (grid.slots.length !== expected) {
    throw new Error(
      `Invalid crafting grid: expected ${expected} slots for a ${grid.width}x${grid.height} grid, got ${grid.slots.length}.`,
    );
  }
  for (const [index, slot] of grid.slots.entries()) {
    if (slot === null) {
      continue;
    }
    if (slot.item.length === 0) {
      throw new Error(`Invalid crafting grid: slot ${index} has an empty item id.`);
    }
    if (!Number.isInteger(slot.count) || slot.count < 1) {
      throw new Error(
        `Invalid crafting grid: slot ${index} count must be a whole number >= 1 (got ${slot.count}).`,
      );
    }
  }
}

function assertStack(stack: ItemStack, label: string, recipeId: string): void {
  if (stack.item.length === 0) {
    throw new Error(`Recipe "${recipeId}": ${label} has an empty item id.`);
  }
  if (!Number.isInteger(stack.count) || stack.count < 1) {
    throw new Error(
      `Recipe "${recipeId}": ${label} count must be a whole number >= 1 (got ${stack.count}).`,
    );
  }
}

function assertIngredient(
  ingredient: Ingredient,
  label: string,
  recipeId: string,
  tags: TagSets,
): void {
  switch (ingredient.kind) {
    case "item":
      if (ingredient.item.length === 0) {
        throw new Error(`Recipe "${recipeId}": ${label} has an empty item id.`);
      }
      return;
    case "tag":
      if (!tags.has(ingredient.tag)) {
        throw new Error(
          `Recipe "${recipeId}": ${label} references unknown tag "${ingredient.tag}".`,
        );
      }
      return;
  }
}

function assertShaped(recipe: ShapedRecipe, tags: TagSets): void {
  if (recipe.pattern.length === 0) {
    throw new Error(`Recipe "${recipe.id}": pattern must have at least one row.`);
  }
  let width = 0;
  let occupiedCells = 0;
  for (const [rowIndex, row] of recipe.pattern.entries()) {
    if (rowIndex === 0) {
      width = row.length;
      if (width === 0) {
        throw new Error(`Recipe "${recipe.id}": pattern rows must not be empty strings.`);
      }
    } else if (row.length !== width) {
      throw new Error(
        `Recipe "${recipe.id}": pattern row ${rowIndex} has length ${row.length}, expected ${width}.`,
      );
    }
    for (const symbol of row) {
      if (EMPTY_PATTERN_CHARS.includes(symbol)) {
        continue;
      }
      if (!(symbol in recipe.key)) {
        throw new Error(
          `Recipe "${recipe.id}": pattern character "${symbol}" has no entry in the recipe key.`,
        );
      }
      occupiedCells += 1;
    }
  }
  if (occupiedCells === 0) {
    throw new Error(`Recipe "${recipe.id}": pattern must contain at least one occupied cell.`);
  }
  for (const [symbol, ingredient] of Object.entries(recipe.key)) {
    const label = `key entry "${symbol}"`;
    assertIngredient(ingredient, label, recipe.id, tags);
  }
}

function assertShapeless(recipe: ShapelessRecipe, tags: TagSets): void {
  if (recipe.ingredients.length === 0) {
    throw new Error(`Recipe "${recipe.id}": shapeless recipes need at least one ingredient.`);
  }
  for (const [ingredientIndex, ingredient] of recipe.ingredients.entries()) {
    assertIngredient(ingredient, `ingredient ${ingredientIndex}`, recipe.id, tags);
  }
}

function assertRecipe(recipe: Recipe, tags: TagSets): void {
  if (recipe.id.length === 0) {
    throw new Error("Recipe id must be a non-empty string.");
  }
  assertStack(recipe.output, "output", recipe.id);
  switch (recipe.type) {
    case "shaped":
      assertShaped(recipe, tags);
      return;
    case "shapeless":
      assertShapeless(recipe, tags);
      return;
  }
}

/**
 * All crafting recipes of the game. Use one registry instance per game
 * session; it holds no mutable matchmaking state, so reads are shareable.
 */
export class CraftingRegistry {
  private readonly recipes: Recipe[] = [];
  private readonly byId = new Map<string, Recipe>();
  private readonly tagSets: TagSets;

  constructor(input: RegistryInput = {}) {
    const sets = new Map<string, ReadonlySet<string>>();
    for (const [name, members] of Object.entries(input.tags ?? {})) {
      sets.set(name, new Set(members));
    }
    this.tagSets = sets;
    for (const recipe of input.recipes ?? []) {
      this.register(recipe);
    }
  }

  /** Validates and adds a recipe. Duplicate ids throw. */
  register(recipe: Recipe): void {
    assertRecipe(recipe, this.tagSets);
    if (this.byId.has(recipe.id)) {
      throw new Error(`Duplicate crafting recipe id: "${recipe.id}".`);
    }
    this.recipes.push(recipe);
    this.byId.set(recipe.id, recipe);
  }

  /** Lookup by id. */
  getRecipe(id: string): Recipe | undefined {
    return this.byId.get(id);
  }

  /** All registered recipes, in registration (priority) order. */
  getRecipes(): readonly Recipe[] {
    return [...this.recipes];
  }

  /** Is a tag name known to this registry? */
  hasTag(name: string): boolean {
    return this.tagSets.has(name);
  }

  /** Member items of a tag, in registration order; undefined when unknown. */
  getTag(name: string): readonly string[] | undefined {
    const set = this.tagSets.get(name);
    return set === undefined ? undefined : [...set];
  }

  /**
   * First registered recipe satisfied by this grid, or null.
   * Grids are validated first: malformed grids throw (programmer error),
   * while an empty or non-matching grid simply yields null.
   */
  findRecipe(grid: CraftingGrid): Recipe | null {
    assertGrid(grid);
    if (occupiedBox(grid) === null) {
      return null;
    }
    for (const recipe of this.recipes) {
      const matched =
        recipe.type === "shaped"
          ? matchShaped(grid, recipe, this.tagSets)
          : matchShapeless(grid, recipe, this.tagSets);
      if (matched) {
        return recipe;
      }
    }
    return null;
  }

  /**
   * Match and consume in one step: every non-empty slot loses exactly
   * 1 item; slots that reach 0 become null.
   */
  craft(grid: CraftingGrid): CraftResult {
    assertGrid(grid);
    const recipe = this.findRecipe(grid);
    if (recipe === null) {
      return { ok: false };
    }
    const afterSlots = grid.slots.map((slot) => {
      if (slot === null) {
        return null;
      }
      const remaining = slot.count - 1;
      return remaining > 0 ? { item: slot.item, count: remaining } : null;
    });
    return {
      ok: true,
      recipe,
      output: { item: recipe.output.item, count: recipe.output.count },
      afterSlots,
    };
  }
}
