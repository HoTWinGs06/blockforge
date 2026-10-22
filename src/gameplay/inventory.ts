/**
 * BlockForge — the inventory rules.
 *
 * OWNERSHIP: GAMEPLAY. Pure: no DOM, no clock, no randomness.
 *
 * The contract already freezes `Inventory` (slots, selected) and `ItemStack`
 * (id, count, durability), so this module is the RULES around them, not a
 * new data model: what fits in a slot, what stacks, what the player is
 * holding, and what happens when there is no room left.
 *
 * The player carries HOTBAR_SLOTS slots and the selected one is the one in
 * hand. The HUD already draws nine slots, so nine is what the player gets.
 *
 * A TOOL NEVER STACKS. A tool's stack carries a durability, and two mattocks
 * of the same kind with different wear are not the same thing, so a tool
 * takes a slot to itself. Blocks and materials stack up to MAX_STACK.
 *
 * AN EMPTY SLOT is a stack with no id and no count. The contract's ItemStack
 * has no null variant, so "nothing here" has to be a value; the HUD already
 * draws a slot with an empty id as an empty slot.
 */

import type { Inventory, ItemStack } from "../core/types.js";

/** How many slots the player carries. The HUD draws exactly nine. */
export const HOTBAR_SLOTS = 9;

/** How many of one item fit in a slot. */
export const MAX_STACK = 64;

/** The marker for a slot with nothing in it. */
export const EMPTY_STACK: ItemStack = Object.freeze({ id: "", count: 0 });

/** True when the slot holds nothing. */
export function isEmpty(stack: ItemStack | undefined): boolean {
  return stack === undefined || stack.id === "" || stack.count <= 0;
}

/**
 * A new inventory.
 *
 * The given stacks go into the first slots, in order, and the rest of the
 * slots are empty. More stacks than there are slots are dropped, and the
 * count of what did not fit is returned, so the caller can keep the
 * remainder in the world rather than lose it.
 */
export function createInventory(
  stacks: readonly ItemStack[] = [],
): { inventory: Inventory; leftover: number } {
  const slots: ItemStack[] = [];
  let leftover = 0;
  for (const stack of stacks) {
    if (stack.count <= 0) {
      continue;
    }
    if (slots.length >= HOTBAR_SLOTS) {
      leftover += stack.count;
      continue;
    }
    slots.push({ ...stack });
  }
  while (slots.length < HOTBAR_SLOTS) {
    slots.push({ ...EMPTY_STACK });
  }
  return { inventory: { slots, selected: 0 }, leftover };
}

/** The result of putting an item into the inventory. */
export interface AddResult {
  readonly inventory: Inventory;
  /** How many of the item did not fit and stayed in the world. */
  readonly leftover: number;
}

/**
 * Put an item into the inventory.
 *
 * It merges into a stack of the same kind first, and only then takes an
 * empty slot, so a player carrying forty rubble and then one more ends up
 * with one stack of forty-one rather than two slots used. When there is no
 * room the item stays in the world: the count that did not fit comes back
 * as `leftover`.
 */
export function addItem(inventory: Inventory, stack: ItemStack): AddResult {
  if (stack.count <= 0 || stack.id === "") {
    return { inventory, leftover: 0 };
  }
  const slots = inventory.slots.slice();
  let remaining = stack.count;

  // 1. Merge into a matching stack. A tool never merges: its durability is
  //    part of what it is.
  if (stack.durability === undefined) {
    for (let i = 0; i < slots.length && remaining > 0; i++) {
      const slot = slots[i];
      if (slot === undefined || isEmpty(slot) || slot.id !== stack.id) {
        continue;
      }
      if (slot.durability !== undefined) {
        continue;
      }
      const room = MAX_STACK - slot.count;
      if (room <= 0) {
        continue;
      }
      const moved = Math.min(room, remaining);
      slots[i] = { ...slot, count: slot.count + moved };
      remaining -= moved;
    }
  }

  // 2. Fill empty slots.
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const slot = slots[i];
    if (slot === undefined || !isEmpty(slot)) {
      continue;
    }
    const moved = Math.min(MAX_STACK, remaining);
    slots[i] = { ...stack, count: moved };
    remaining -= moved;
  }

  return { inventory: { slots, selected: inventory.selected }, leftover: remaining };
}

/**
 * Take items out of the inventory.
 *
 * Used when a block is placed: the block leaves the pack. The stacks are
 * taken from the first slots that hold the item.
 */
export function removeItem(inventory: Inventory, id: string, count = 1): Inventory {
  const slots = inventory.slots.slice();
  let remaining = count;
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const slot = slots[i];
    if (slot === undefined || slot.id !== id || slot.count <= 0) {
      continue;
    }
    const taken = Math.min(slot.count, remaining);
    remaining -= taken;
    slots[i] = taken >= slot.count ? { ...EMPTY_STACK } : { ...slot, count: slot.count - taken };
  }
  return { slots, selected: inventory.selected };
}

/** Move the selection. The index is clamped to the slots that exist. */
export function selectSlot(inventory: Inventory, index: number): Inventory {
  const selected = Math.max(0, Math.min(HOTBAR_SLOTS - 1, Math.trunc(index)));
  return { slots: inventory.slots, selected };
}

/** The stack in the selected slot, or null when that slot is empty. */
export function heldItem(inventory: Inventory): ItemStack | null {
  const slot = inventory.slots[inventory.selected];
  return slot === undefined || isEmpty(slot) ? null : slot;
}

/** How many of one item the player is carrying, over every slot. */
export function countOf(inventory: Inventory, id: string): number {
  let total = 0;
  for (const slot of inventory.slots) {
    if (slot.id === id) {
      total += slot.count;
    }
  }
  return total;
}
