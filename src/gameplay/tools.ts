/**
 * BlockForge — using a tool.
 *
 * OWNERSHIP: GAMEPLAY. Pure: no DOM, no clock, no randomness.
 *
 * The contract's `ItemStack` carries the REMAINING durability of a tool, and
 * the contract's `ToolSpec` says how many uses a fresh one has. The rule is
 * one subtraction and one comparison: a tool that breaks a block loses one
 * use, and when the last one is gone the tool is GONE.
 *
 * A WORN-OUT TOOL LEAVES THE PACK. It does not fall on the floor as a
 * broken item: there is no item for a broken tool, and the pack is nine
 * slots deep. The player has to craft another one, which is what makes the
 * crafting chain worth anything.
 *
 * ONLY THE TOOL IN HAND WEARS. The tool is the one in the selected slot, so
 * a tool lying in another slot is untouched - the same rule as the drop
 * table, which only credits the tool that was actually in the hand.
 *
 * A REFUSED BREAK COSTS NOTHING. The contract's `canBreak` says which kind
 * a block needs, so a block broken with the wrong kind is not broken at all
 * and the tool in the hand does not wear. The wear and the drop table are
 * gated on the same predicate, so they can never disagree.
 */

import type { Inventory, ToolSpec, ToolTier } from "../core/types.js";
import { EMPTY_STACK } from "./inventory.js";

/** The result of wearing a tool once. */
export interface ToolWear {
  /** The pack after the wear. */
  readonly inventory: Inventory;
  /** True when the tool used up its last use and BROKE: it left the pack. */
  readonly broke: boolean;
}

/**
 * Wear the tool in hand once: it loses one use of its durability.
 *
 * The wear lands on the SELECTED slot, and only when that slot holds the
 * tool that was used - a tool in another slot is a different tool and is
 * not the one in the hand.
 *
 * A tool that was given no durability of its own starts at the FULL
 * durability its spec says, because the contract's `TOOL_SPECS` is the one
 * place that says how long a tool lasts.
 */
export function wearTool(inventory: Inventory, tool: ToolSpec): ToolWear {
  const index = inventory.selected;
  const slot = inventory.slots[index];
  if (slot === undefined || slot.id !== tool.id) {
    // Not the tool in the hand: nothing to wear.
    return { inventory, broke: false };
  }
  const remaining = (slot.durability ?? tool.durability) - 1;
  const slots = inventory.slots.slice();
  if (remaining <= 0) {
    // The tool BROKE. It leaves the pack; there is no broken-tool item.
    slots[index] = { ...EMPTY_STACK };
    return { inventory: { slots, selected: inventory.selected }, broke: true };
  }
  slots[index] = { ...slot, durability: remaining };
  return { inventory: { slots, selected: inventory.selected }, broke: false };
}

/**
 * The damage a sabre does, by tier.
 *
 * The sabre is a WEAPON, not a digging tool: it is deliberately not in the
 * contract's `TOOL_SPECS` and not in the mining table, and no block names
 * it as the kind it needs. What it is for is fighting, and the numbers for
 * that are GAMEPLAY's to choose.
 *
 * The tiers are the contract's own, so a sabre of a tier reads the same way
 * a mattock of that tier does. A tool added to the contract's table later
 * gets a recipe automatically (the shape is already in the recipe table);
 * the damage table here is keyed the same way.
 */
export const SABRE_DAMAGE: Readonly<Record<ToolTier, number>> = Object.freeze({
  timber: 3,
  slate: 5,
  ironveil: 8,
  lumencrystal: 12,
});

/** The damage the sabre of a tier does. */
export function sabreDamage(tier: ToolTier): number {
  return SABRE_DAMAGE[tier];
}
