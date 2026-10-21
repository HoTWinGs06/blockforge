/**
 * BlockForge — the recipe table.
 *
 * OWNERSHIP: GAMEPLAY. Pure: no DOM, no clock, no randomness.
 *
 * A recipe is the frozen contract's `Recipe` (src/core/types.ts):
 *
 *   { id, kind: "shaped" | "shapeless", ingredients, shape?, result }
 *
 * `ingredients` is the MULTISET of ingredient tokens the recipe consumes,
 * one entry per item. For a shapeless recipe that is the whole story. For a
 * shaped recipe the `shape` adds the layout, and `ingredients` is the same
 * tokens flattened out of the shape - so a reader can ask "what does this
 * need?" without walking the grid, and the matcher can use the shape for
 * position and the ingredients for counting.
 *
 * An ingredient token is either an exact item id ("timber") or a tag
 * ("#plank", see ./tags.ts). A tag lets one recipe accept a family of
 * items, which is how a tool can be made of "any plank" instead of one
 * exact block.
 *
 * THE TOOL RECIPES ARE DERIVED, NOT TYPED
 * The sixteen tools are frozen in `TOOL_SPECS` (src/core/constants.ts), so
 * the recipe for each one is generated from that table: a shape per tool
 * KIND, a head material per tool TIER. A tool added to the contract
 * therefore gets a recipe automatically, and the recipe can never disagree
 * with the tool it makes.
 */

import { TOOL_SPECS } from "../constants.js";
import type { ItemStack, Recipe, ToolKind, ToolTier } from "../types.js";

/**
 * What a tool's head is made of, per tier.
 *
 * The slate tier is a TAG on purpose: a slate tool is made of "any rock",
 * so the rubble broken out of slate works as well as the slate itself.
 */
const TIER_HEAD: Readonly<Record<ToolTier, string>> = Object.freeze({
  timber: "millplank",
  slate: "#rock",
  ironveil: "ironveil",
  lumencrystal: "lumencrystal",
});

/** The handle of every tool: any plank. */
const HANDLE = "#plank";

/**
 * The shape of each tool kind, as rows of cells.
 *
 * "#head" and "#handle" are placeholders the table fills in per tier.
 * An empty string is an empty cell. Shapes are trimmed of empty rows and
 * columns when they are matched, so a shape that uses the full 3x3 always
 * needs a craftbench and a narrower one fits the 2x2 inventory grid.
 */
const TOOL_SHAPES: Readonly<Record<ToolKind, readonly (readonly string[])[]>> =
  Object.freeze({
    mattock: Object.freeze([
      ["#head", "#head", "#head"],
      ["", "#handle", ""],
      ["", "#handle", ""],
    ]),
    billhook: Object.freeze([
      ["#head", "#head"],
      ["", "#handle"],
      ["", "#handle"],
    ]),
    trowel: Object.freeze([
      ["#head"],
      ["#handle"],
      ["#handle"],
    ]),
    maul: Object.freeze([
      ["#head", "#head"],
      ["#head", "#head"],
      ["", "#handle"],
    ]),
    sabre: Object.freeze([
      ["#head", "#head"],
      ["", "#handle"],
    ]),
  });

/** The tokens of a shape, flattened row-major, empties dropped. */
function tokensOf(shape: readonly (readonly string[])[]): readonly string[] {
  const tokens: string[] = [];
  for (const row of shape) {
    for (const cell of row) {
      if (cell !== "") {
        tokens.push(cell);
      }
    }
  }
  return tokens;
}

/** The recipe for one tool, built from its kind's shape and its tier. */
function toolRecipe(id: string, kind: ToolKind, tier: ToolTier, result: ItemStack): Recipe {
  const head = TIER_HEAD[tier];
  const shape = TOOL_SHAPES[kind].map((row) =>
    row.map((cell) => (cell === "#head" ? head : cell === "#handle" ? HANDLE : "")),
  );
  return {
    id,
    kind: "shaped",
    ingredients: tokensOf(shape),
    shape,
    result,
  };
}

/** The recipes that are not tools: the building blocks. */
const BUILDING_RECIPES: readonly Recipe[] = Object.freeze([
  {
    id: "millplank_from_timber",
    kind: "shapeless",
    ingredients: Object.freeze(["timber"]),
    result: { id: "millplank", count: 4 },
  },
  {
    id: "craftbench",
    kind: "shaped",
    ingredients: Object.freeze(["#plank", "#plank", "#plank", "#plank"]),
    shape: Object.freeze([
      ["#plank", "#plank"],
      ["#plank", "#plank"],
    ]),
    result: { id: "craftbench", count: 1 },
  },
  {
    id: "masonry",
    kind: "shaped",
    ingredients: Object.freeze(["#rock", "#rock", "#rock", "#rock"]),
    shape: Object.freeze([
      ["#rock", "#rock"],
      ["#rock", "#rock"],
    ]),
    result: { id: "masonry", count: 1 },
  },
  {
    id: "smeltforge",
    kind: "shaped",
    ingredients: Object.freeze([
      "#rock", "#rock", "#rock",
      "#rock", "", "#rock",
      "#rock", "#rock", "#rock",
    ]),
    shape: Object.freeze([
      ["#rock", "#rock", "#rock"],
      ["#rock", "", "#rock"],
      ["#rock", "#rock", "#rock"],
    ]),
    result: { id: "smeltforge", count: 1 },
  },
]);

/**
 * Every recipe in the game.
 *
 * The order is the order the table is built in, and the order a match is
 * searched in, so the same grid always produces the same recipe.
 */
export const RECIPES: readonly Recipe[] = Object.freeze([
  ...BUILDING_RECIPES,
  ...TOOL_SPECS.map((spec) =>
    toolRecipe(spec.id, spec.kind, spec.tier, {
      id: spec.id,
      count: 1,
      durability: spec.durability,
    }),
  ),
]);

/** The recipe with this id, if there is one. */
export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((recipe) => recipe.id === id);
}
