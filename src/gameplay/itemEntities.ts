/**
 * BlockForge — dropped items in the world.
 *
 * OWNERSHIP: GAMEPLAY. Pure: no DOM, no clock, no randomness.
 *
 * When a block is broken it does not vanish: it becomes an item lying in
 * the world, and the player collects it by walking over it. This module is
 * that item's whole life - it appears, it falls, it settles, and the player
 * picks it up.
 *
 * DETERMINISM: an item's POSITION IS A PURE FUNCTION OF THE TICK. The item
 * records where it was born and where it comes to rest, and the position at
 * any tick is computed from those two numbers and the tick alone. Nothing is
 * integrated frame by frame, so a dropped item cannot drift differently
 * depending on the order the world happened to be updated in, and the same
 * break always produces the same drop.
 *
 * The item's id is a counter handed in by the caller: this module never
 * generates a random number, because there is no random number to generate.
 *
 * The world query is a structural type rather than the engine's, so this
 * module stays testable and has no dependency on the engine.
 */

import type { Inventory, ItemStack, Vec3 } from "../core/types.js";
import { addItem } from "./inventory.js";

/** The edge length of a dropped item, in blocks. */
export const ITEM_SIZE = 0.25;

/** Ticks a dropped item takes to fall and settle. */
export const SETTLE_TICKS = 10;

/** How high a dropped item hops as it settles, in blocks. */
export const HOP_HEIGHT = 0.12;

/** Ticks before a dropped item may be picked up, so it cannot be hoovered
 *  up out of the hole the player has just dug. */
export const PICKUP_DELAY_TICKS = 10;

/** How close the player must be, horizontally, to collect an item. */
export const PICKUP_RADIUS = 1.0;

/** How far below and above the player's feet an item may be and still be
 *  collected. */
export const PICKUP_VERTICAL = 1.6;

/** Ticks a dropped item survives before it disappears. */
export const ITEM_LIFETIME_TICKS = 2400;

/** A world query: is there a solid block at these coordinates? */
export interface SolidProbe {
  isSolid(x: number, y: number, z: number): boolean;
}

/** One dropped item in the world. */
export interface ItemEntity {
  /** The item's own id, unique for the life of the drop. */
  readonly id: number;
  /** What the item is and how many of it there are. */
  readonly stack: ItemStack;
  /** The column the item is in. */
  readonly x: number;
  readonly z: number;
  /** The height of the item's centre when it appeared. */
  readonly spawnY: number;
  /** The height of the item's centre once it has come to rest. */
  readonly restY: number;
  /** The tick the item appeared on. */
  readonly bornTick: number;
}

/**
 * Drop an item into the world.
 *
 * It appears in the middle of the cell the block was broken in, and falls to
 * the top of the first solid cell below it. The cell the block came from is
 * already air by the time this is called, so the item comes to rest in the
 * hole the player has just made.
 */
export function spawnItem(
  id: number,
  stack: ItemStack,
  x: number,
  y: number,
  z: number,
  tick: number,
  world: SolidProbe,
): ItemEntity {
  return {
    id,
    stack,
    x,
    z,
    spawnY: y + 0.5,
    restY: restingY(x, y, z, world),
    bornTick: tick,
  };
}

/**
 * Where the item comes to rest: on top of the first solid cell below the
 * cell it was dropped in. If there is nothing below it all the way down,
 * it stays where it was dropped.
 */
function restingY(x: number, y: number, z: number, world: SolidProbe): number {
  for (let cy = y; cy > 0; cy--) {
    if (world.isSolid(x, cy, z)) {
      return cy + 1 + ITEM_SIZE / 2;
    }
  }
  return y + 0.5;
}

/**
 * The item's position at a tick.
 *
 * It falls from where it was dropped to where it will rest, with a small
 * hop on the way, and then it is still. The whole curve is a function of
 * the tick, so the same item is in the same place every time.
 */
export function itemPosition(item: ItemEntity, tick: number): Vec3 {
  const age = Math.max(0, tick - item.bornTick);
  const u = Math.min(1, age / SETTLE_TICKS);
  const hop = HOP_HEIGHT * 4 * u * (1 - u);
  const y = item.spawnY + (item.restY - item.spawnY) * u + hop;
  return { x: item.x + 0.5, y, z: item.z + 0.5 };
}

/** True when the player is close enough to pick the item up. */
export function isWithinReach(item: ItemEntity, tick: number, feet: Vec3): boolean {
  if (tick - item.bornTick < PICKUP_DELAY_TICKS) {
    return false;
  }
  const position = itemPosition(item, tick);
  const dx = position.x - feet.x;
  const dz = position.z - feet.z;
  if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS) {
    return false;
  }
  return Math.abs(position.y - feet.y) <= PICKUP_VERTICAL;
}

/** The result of a pickup pass. */
export interface CollectResult {
  /** The items still lying in the world. */
  readonly items: readonly ItemEntity[];
  /** The player's inventory after the pickup. */
  readonly inventory: Inventory;
}

/**
 * Collect every item the player is standing on.
 *
 * An item that does not fit in the inventory stays in the world, with
 * whatever the player could not take reduced off it: a full pack leaves
 * the rest of the pile on the ground rather than destroying it.
 *
 * Items that have been lying around for too long are removed, so a long
 * session does not accumulate drops forever.
 */
export function collectItems(
  items: readonly ItemEntity[],
  inventory: Inventory,
  feet: Vec3,
  tick: number,
): CollectResult {
  const kept: ItemEntity[] = [];
  let current = inventory;
  for (const item of items) {
    if (tick - item.bornTick > ITEM_LIFETIME_TICKS) {
      continue;
    }
    if (!isWithinReach(item, tick, feet)) {
      kept.push(item);
      continue;
    }
    const result = addItem(current, item.stack);
    current = result.inventory;
    if (result.leftover > 0) {
      // The pack is full: the rest of the pile stays on the ground.
      kept.push({ ...item, stack: { ...item.stack, count: result.leftover } });
    }
  }
  return { items: kept, inventory: current };
}
