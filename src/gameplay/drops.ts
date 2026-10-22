/**
 * BlockForge — the drop table.
 *
 * OWNERSHIP: GAMEPLAY. Pure: no DOM, no clock, no randomness.
 *
 * What a broken block leaves behind. A block item uses the block's own name
 * as its item id (the contract says so: "Block items use the block's name"),
 * so breaking rubble gives you rubble, and the id is the one the crafting
 * table already knows: "slate" and "rubble" are both "#rock", "timber" is
 * what the millplank recipe asks for.
 *
 * THE WRONG-TOOL RULE, and it is the rule that makes tools worth crafting:
 * a block that needs a tool CANNOT be broken without one - the contract's
 * `canBreak` says so and `breakSecondsWith` returns -1 - so a block broken
 * with the wrong tool leaves NOTHING. The drop table enforces it anyway,
 * because a drop that ignored the tool rule would hand out free ore.
 *
 * SOME BLOCKS LEAVE NOTHING AT ALL: the two liquids and the world floor.
 * There is no bucket and there is no way to put the floor back.
 */

import { canBreak } from "../core/constants.js";
import { BlockId } from "../core/types.js";
import type { ItemStack, ToolSpec } from "../core/types.js";

/** Blocks that leave nothing behind when they are broken. */
const LEAVES_NOTHING: ReadonlySet<BlockId> = new Set([
  BlockId.Air,
  BlockId.Tidewater,
  BlockId.Emberflow,
  BlockId.Voidstone,
]);

/**
 * What a broken block drops.
 *
 * `tool` is the tool the break was made with, or null for bare hands. The
 * wrong-tool rule is applied here: a block that needs a tool and was not
 * broken with one drops nothing at all.
 *
 * THE CANOPY CARRIES FOOD. A tree's leaves are not a thing the player
 * carries, but something grows in them: a wildfig. That is the player's
 * supply of food until the mobs land, and it is why the canopy needs a
 * billhook - the fruit is harvested with the same tool you fell the tree
 * with.
 */
export function dropFor(block: BlockId, tool: ToolSpec | null): readonly ItemStack[] {
  if (!canBreak(block, tool)) {
    return [];
  }
  if (block === BlockId.Foliage) {
    return [{ id: "wildfig", count: 1 }];
  }
  if (LEAVES_NOTHING.has(block)) {
    return [];
  }
  return [{ id: block, count: 1 }];
}
