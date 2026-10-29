/**
 * Crafting data types for BlockForge.
 *
 * Pure data only: no behavior, no I/O, no wall-clock, deterministic.
 * Everything a crafting UI, network layer, or save system needs to talk
 * about crafting lives here.
 */

/** A pile of items in an inventory or crafting-grid slot. */
export interface ItemStack {
  /** Item id, e.g. "oak_planks". */
  readonly item: string;
  /** Number of items in this stack; must be a whole number >= 1 when present. */
  readonly count: number;
}

/**
 * One required input of a recipe.
 * - `{ kind: "item" }` matches exactly that item id.
 * - `{ kind: "tag" }` matches any item registered under that tag
 *   (e.g. the "planks" tag covers oak and spruce planks).
 */
export type Ingredient = ItemIngredient | TagIngredient;

export interface ItemIngredient {
  readonly kind: "item";
  readonly item: string;
}

export interface TagIngredient {
  readonly kind: "tag";
  readonly tag: string;
}

/** Characters that mean "empty cell" inside a shaped pattern. */
export const EMPTY_PATTERN_CHARS: readonly string[] = [" ", "."];

/**
 * A recipe whose inputs occupy specific positions relative to each other.
 * The player grid is matched translation-invariantly: the bounding box of
 * the player's non-empty cells must equal the pattern shape cell-for-cell.
 */
export interface ShapedRecipe {
  readonly type: "shaped";
  /** Unique, human-readable id, e.g. "planks_to_sticks". */
  readonly id: string;
  /**
   * One string per pattern row. Every character is either a key found in
   * `key`, or an empty-cell marker (`" "` or `"."`). All rows must have the
   * same length.
   */
  readonly pattern: readonly string[];
  /** Maps each non-empty pattern character to its required ingredient. */
  readonly key: Readonly<Record<string, Ingredient>>;
  /** What the craft produces. */
  readonly output: ItemStack;
  /**
   * Also accept the pattern mirrored horizontally (Minecraft-like).
   * Defaults to true; set to false for direction-sensitive recipes.
   */
  readonly allowMirrored?: boolean;
}

/** A recipe whose inputs are position- and order-independent. */
export interface ShapelessRecipe {
  readonly type: "shapeless";
  readonly id: string;
  /** One entry per occupied slot; duplicates aggregate (2x planks = 2 slots). */
  readonly ingredients: readonly Ingredient[];
  readonly output: ItemStack;
}

export type Recipe = ShapedRecipe | ShapelessRecipe;

/**
 * A crafting grid: the player's 2x2 backpack grid or a crafting table's 3x3.
 * Slots are addressed row-major (left to right, top to bottom).
 */
export interface CraftingGrid {
  /** Columns; must be >= 1. */
  readonly width: number;
  /** Rows; must be >= 1. */
  readonly height: number;
  /**
   * Row-major slots; length must equal width * height.
   * null means "empty slot". Slot counts do not affect matching.
   */
  readonly slots: readonly (ItemStack | null)[];
}

/**
 * The outcome of `CraftingRegistry.craft`.
 *
 * Consuming rules: every non-empty slot loses exactly 1 item.
 * Slots that drop to 0 items become null in `afterSlots`.
 */
export type CraftResult =
  | {
      readonly ok: true;
      /** The recipe that matched (first registered match wins). */
      readonly recipe: Recipe;
      /** Produced stack; a fresh copy, safe to move into an output inventory. */
      readonly output: ItemStack;
      /** The input slots after consuming ingredients. Same indices, same order. */
      readonly afterSlots: readonly (ItemStack | null)[];
    }
  | {
      readonly ok: false;
    };
