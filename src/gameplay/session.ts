/**
 * BlockForge — the gameplay session: what the player carries and what is
 * lying on the ground.
 *
 * OWNERSHIP: GAMEPLAY. Pure logic: no DOM, no clock, no randomness.
 *
 * This is the one object the game loop talks to. It holds the player's
 * inventory, the items dropped in the world, and the tick counter, and it
 * answers the three questions the loop asks:
 *
 *   "the player broke a block"   -> breakBlock() spawns the drops
 *   "the world moved on"         -> update() ages the items and collects
 *                                    whatever the player walked over
 *   "what is the player holding"  -> held(), via the inventory
 *
 * THE TICK IS THE CLOCK. Time comes from a tick counter, never from the
 * wall clock, so the same inputs always produce the same world - the same
 * rule the core contract follows.
 *
 * DETERMINISM: an item's position is a pure function of the tick (see
 * itemEntities.ts), so the same break at the same tick always leaves the
 * item in the same place, whatever order the world was updated in.
 */

import type { BlockId, Inventory, ItemStack, ToolSpec, Vec3 } from "../core/types.js";
import { canBreak } from "../core/constants.js";
import { dropFor } from "./drops.js";
import {
  addItem,
  createInventory,
  heldItem,
  removeItem,
  selectSlot,
  type AddResult,
} from "./inventory.js";
import {
  collectItems,
  itemPosition,
  spawnItem,
  type ItemEntity,
  type SolidProbe,
} from "./itemEntities.js";
import { wearTool } from "./tools.js";

/** Ticks in one second. The world clock runs at twenty, and so does this. */
export const TICKS_PER_SECOND = 20;

/** A dropped item, as the renderer needs to see it. */
export interface DroppedItemView {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: BlockId;
}

/**
 * What a break did to the tool that made it.
 *
 * `toolBroke` is the id of the tool that used up its last use and left the
 * pack, or null when nothing broke. The screen shows "your mattock broke"
 * from it, so the player is not left wondering where the tool in their hand
 * went.
 */
export interface BreakOutcome {
  readonly toolBroke: string | null;
}

/** The player's starting kit: the four timber tools and some blocks. */
const STARTING_KIT: readonly ItemStack[] = [
  { id: "mattock_timber", count: 1, durability: 60 },
  { id: "trowel_timber", count: 1, durability: 60 },
  { id: "billhook_timber", count: 1, durability: 60 },
  { id: "maul_timber", count: 1, durability: 60 },
  { id: "loam", count: 16 },
  { id: "timber", count: 16 },
  { id: "rubble", count: 16 },
  { id: "sand", count: 16 },
];

/**
 * The player's stuff: their inventory, and the items lying in the world.
 */
export class GameplaySession {
  private inventory: Inventory;
  private items: ItemEntity[] = [];
  private nextItemId = 1;
  private tick = 0;
  private tickCarry = 0;

  constructor() {
    const { inventory } = createInventory(STARTING_KIT);
    this.inventory = inventory;
  }

  /** What the player is carrying. */
  get carried(): Inventory {
    return this.inventory;
  }

  /** The stack in the selected slot, or null when that slot is empty. */
  held(): ItemStack | null {
    return heldItem(this.inventory);
  }

  /** Move the hotbar selection. */
  select(index: number): void {
    this.inventory = selectSlot(this.inventory, index);
  }

  /**
   * The player broke a block: leave what it drops on the ground, and pay
   * for it with the tool.
   *
   * The tool matters. A block that needs a tool and was not broken with one
   * drops NOTHING, which is what makes tools worth crafting.
   *
   * T82: THE TOOL WEARS. Breaking a block with a tool costs that tool one
   * use of its durability, and when the last use is gone the tool BREAKS
   * and leaves the pack. The wear is gated on the same `canBreak` the drop
   * table uses, so a block that dropped nothing (because the wrong tool was
   * used) costs the tool nothing either - the two can never disagree.
   *
   * The wear lands in this class, so the caller does not have to know about
   * it: a break is a break, and the tool that made it paid for it.
   */
  breakBlock(
    block: BlockId,
    tool: ToolSpec | null,
    x: number,
    y: number,
    z: number,
    world: SolidProbe,
  ): BreakOutcome {
    for (const stack of dropFor(block, tool)) {
      this.items = [
        ...this.items,
        spawnItem(this.nextItemId++, stack, x, y, z, this.tick, world),
      ];
    }
    if (tool === null || !canBreak(block, tool)) {
      return { toolBroke: null };
    }
    const wear = wearTool(this.inventory, tool);
    this.inventory = wear.inventory;
    return { toolBroke: wear.broke ? tool.id : null };
  }

  /**
   * Advance the world and collect whatever the player walked over.
   *
   * `dt` is the elapsed time in seconds. The tick counter advances in
   * fixed fifths of a second, so the session's clock is the world's clock
   * and never the wall clock.
   */
  update(dt: number, feet: Vec3): void {
    this.tickCarry += dt;
    while (this.tickCarry >= 1 / TICKS_PER_SECOND) {
      this.tickCarry -= 1 / TICKS_PER_SECOND;
      this.tick += 1;
    }
    const result = collectItems(this.items, this.inventory, feet, this.tick);
    this.items = [...result.items];
    this.inventory = result.inventory;
  }

  /**
   * Take one of the held item out of the pack, for placing a block.
   *
   * Returns false when there was nothing to take, so the caller can refuse
   * the placement instead of placing blocks out of thin air.
   */
  consumeHeld(): boolean {
    const held = this.held();
    if (held === null) {
      return false;
    }
    this.inventory = removeItem(this.inventory, held.id, 1);
    return true;
  }

  /** Put an item straight into the pack, without a walk over a dropped one. */
  give(stack: ItemStack): AddResult {
    const result = addItem(this.inventory, stack);
    this.inventory = result.inventory;
    return result;
  }

  /** The items lying in the world, for the renderer to draw. */
  droppedItems(): readonly DroppedItemView[] {
    return this.items.map((item) => {
      const position = itemPosition(item, this.tick);
      return {
        id: item.id,
        x: position.x,
        y: position.y,
        z: position.z,
        block: item.stack.id as BlockId,
      };
    });
  }
}
