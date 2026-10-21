/**
 * BlockForge — ingredient tags for the crafting table.
 *
 * OWNERSHIP: GAMEPLAY. Pure: no DOM, no clock, no randomness.
 *
 * A recipe names what it needs with plain strings. A string is either an
 * exact item id ("timber") or a TAG - a family of items, any one of which
 * will do ("#rock" accepts slate or rubble). The frozen contract says the
 * tag vocabulary belongs to the recipe registry and not to the contract
 * (src/core/types.ts, on `Recipe`), so it lives here, next to the recipes
 * that use it.
 *
 * WHY TAGS CARRY A "#"
 * A tag and an item id are both strings, so without a marker they collide:
 * a tag named "slate" would shadow the item "slate", and a typo in a recipe
 * would quietly become a recipe that can never be crafted. The "#" prefix
 * makes the two impossible to confuse, and it reads as what it is when you
 * are staring at a recipe table.
 */

import type { ItemId } from "../types.js";

/**
 * Every tag the recipe table knows, and the items it accepts.
 *
 * A tag with one member is still worth having: it names a MATERIAL rather
 * than a particular block, so a later block (a second kind of plank, say)
 * joins the tag by editing one line and every recipe that wanted "any
 * plank" accepts it.
 */
export const INGREDIENT_TAGS: Readonly<Record<string, readonly ItemId[]>> = Object.freeze({
  /** Any sawn plank. */
  "#plank": Object.freeze(["millplank"]),
  /** Any stony block: slate itself, or the rubble broken out of it. */
  "#rock": Object.freeze(["slate", "rubble"]),
  /** Any soil you can dig. */
  "#soil": Object.freeze(["regolith", "loam", "sand", "gravel", "clay"]),
  /** Any raw wood product. */
  "#wood": Object.freeze(["timber", "millplank"]),
});

/** True when the token names a tag rather than an exact item. */
export function isTag(token: string): boolean {
  return token.startsWith("#");
}

/** The items a tag accepts, or an empty list when the token is not a tag. */
export function tagMembers(token: string): readonly ItemId[] {
  return isTag(token) ? (INGREDIENT_TAGS[token] ?? []) : [];
}

/**
 * True when `itemId` satisfies the ingredient named by `token`.
 *
 * An unknown "#" token matches nothing rather than everything: a recipe
 * that names a tag nobody defined is a recipe that cannot be crafted, and
 * that is the safe way to fail. A tag the registry knows accepts any of its
 * members; a plain token must equal the item id exactly.
 */
export function ingredientAccepts(token: string, itemId: ItemId): boolean {
  if (!isTag(token)) {
    return token === itemId;
  }
  const members = INGREDIENT_TAGS[token];
  return members !== undefined && members.includes(itemId);
}
