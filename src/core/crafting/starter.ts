/**
 * The starter crafting data set: the recipes a new BlockForge session
 * begins with. Wood tier only, mirroring Minecraft's classic early recipes.
 *
 * Item vocabulary:
 *   oak_log, spruce_log, oak_planks, spruce_planks, stick,
 *   crafting_table, coal, torch, wooden_pickaxe
 */

import { CraftingRegistry } from "./registry.ts";
import type { Recipe } from "./types.ts";

const P_PLANKS = { kind: "tag", tag: "planks" } as const;

/** Recipes available from the first play session. */
export const STARTER_RECIPES: readonly Recipe[] = [
  {
    type: "shapeless",
    id: "oak_log_to_planks",
    ingredients: [{ kind: "item", item: "oak_log" }],
    output: { item: "oak_planks", count: 4 },
  },
  {
    type: "shapeless",
    id: "spruce_log_to_planks",
    ingredients: [{ kind: "item", item: "spruce_log" }],
    output: { item: "spruce_planks", count: 4 },
  },
  {
    type: "shaped",
    id: "planks_to_sticks",
    pattern: ["P", "P"],
    key: { P: P_PLANKS },
    output: { item: "stick", count: 4 },
  },
  {
    type: "shaped",
    id: "crafting_table",
    pattern: ["PP", "PP"],
    key: { P: P_PLANKS },
    output: { item: "crafting_table", count: 1 },
  },
  {
    type: "shaped",
    id: "torch",
    pattern: ["C", "S"],
    key: { C: { kind: "item", item: "coal" }, S: { kind: "item", item: "stick" } },
    output: { item: "torch", count: 4 },
  },
  {
    type: "shaped",
    id: "wooden_pickaxe",
    pattern: ["PPP", " S ", " S "],
    key: { P: P_PLANKS, S: { kind: "item", item: "stick" } },
    output: { item: "wooden_pickaxe", count: 1 },
  },
];

/** Tag vocabulary shared with recipes, usable by any future system. */
export const STARTER_TAGS: Readonly<Record<string, readonly string[]>> = {
  wood: ["oak_log", "spruce_log"],
  planks: ["oak_planks", "spruce_planks"],
};

/** A registry preloaded with the starter gameplay recipes and tags. */
export function createStarterRegistry(): CraftingRegistry {
  return new CraftingRegistry({ tags: STARTER_TAGS, recipes: STARTER_RECIPES });
}
