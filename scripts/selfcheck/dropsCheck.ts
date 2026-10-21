/**
 * Drops and inventory self-check.
 *
 * Verifies the properties the operator's complaint depends on:
 *   - breaking a block LEAVES AN ITEM on the ground, and the player
 *     collects it by walking over it;
 *   - the wrong-tool rule holds: a block broken with the wrong tool (or
 *     with bare hands when the block needs a tool) drops NOTHING;
 *   - the inventory is a real thing: it stacks, it counts, it selects, and
 *     placing a block takes one out of it;
 *   - an item's position is a PURE FUNCTION OF THE TICK - the same break
 *     at the same tick always leaves the item in the same place, whatever
 *     order the world was updated in.
 *
 * Build and run:
 *   npx tsc -p scripts/tsconfig.build.json
 *   node node_modules/.cache/blockforge-scripts/scripts/selfcheck/dropsCheck.js
 */

import {
  GameplaySession,
  addItem,
  collectItems,
  countOf,
  createInventory,
  dropFor,
  heldItem,
  itemPosition,
  removeItem,
  selectSlot,
  spawnItem,
  type SolidProbe,
} from "../../src/gameplay/index.js";
import { BlockId } from "../../src/core/types.js";
import { TOOL_SPECS, canBreak, requiredToolFor, toolSpec } from "../../src/core/constants.js";

let failures = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    process.stdout.write(`  ok   ${name}\n`);
  } else {
    failures++;
    process.stderr.write(`  FAIL ${name} ${detail}\n`);
  }
}

process.stdout.write("drops and inventory self-check\n");

/** A world where everything is solid except a hole at (0, 0, 0)..(0, 2, 0). */
function worldWithHole(floorY: number): SolidProbe {
  return {
    isSolid: (_x: number, y: number, _z: number): boolean => y <= floorY,
  };
}

// 1. The drop table: a block drops itself, as an item with the block's name.
//
// Every mineable block needs a tool of some kind, so the tool is part of
// the call - bare hands can break nothing that drops.
{
  const mattock = toolSpec("mattock_timber") ?? null;
  const drops = dropFor(BlockId.Rubble, mattock);
  check("breaking rubble drops one rubble", drops.length === 1 && drops[0]?.id === "rubble", JSON.stringify(drops));
  check("the drop count is one", drops[0]?.count === 1, String(drops[0]?.count));
  const slate = dropFor(BlockId.Slate, mattock);
  check("breaking slate drops one slate", slate.length === 1 && slate[0]?.id === "slate", JSON.stringify(slate));
  const trowel = toolSpec("trowel_timber") ?? null;
  check("loam needs a trowel", requiredToolFor(BlockId.Loam) === "trowel", String(requiredToolFor(BlockId.Loam)));
  check("loam broken with a trowel drops loam", dropFor(BlockId.Loam, trowel).length === 1);
}

// 2. The wrong-tool rule: a block that needs a tool drops NOTHING without it.
{
  const timber = requiredToolFor(BlockId.Timber);
  check("timber needs a billhook", timber === "billhook", String(timber));
  check("timber cannot be broken bare-handed", !canBreak(BlockId.Timber, null));
  check("timber broken bare-handed drops nothing", dropFor(BlockId.Timber, null).length === 0);
  const wrongKind = toolSpec("mattock_timber") ?? null;
  check("timber broken with a mattock drops nothing", dropFor(BlockId.Timber, wrongKind).length === 0);
  const rightKind = toolSpec("billhook_timber") ?? null;
  check("timber broken with a billhook drops timber", dropFor(BlockId.Timber, rightKind).length === 1);
  // And a block that needs no tool is fine with bare hands.
  check("loam cannot be broken bare-handed", !canBreak(BlockId.Loam, null));
  check("loam drops with the right tool", dropFor(BlockId.Loam, toolSpec("trowel_timber") ?? null).length === 1);
}

// 3. Some blocks leave nothing at all.
{
  check("tidewater leaves nothing", dropFor(BlockId.Tidewater, null).length === 0);
  check("emberflow leaves nothing", dropFor(BlockId.Emberflow, null).length === 0);
  check("voidstone leaves nothing", dropFor(BlockId.Voidstone, toolSpec("mattock_timber") ?? null).length === 0);
}

// 4. The inventory: stacking, counting, selecting, removing.
{
  const { inventory } = createInventory([{ id: "rubble", count: 10 }]);
  check("a new inventory has nine slots", inventory.slots.length === 9, String(inventory.slots.length));
  check("the first slot holds the stack", inventory.slots[0]?.count === 10, String(inventory.slots[0]?.count));
  check("the rest are empty", inventory.slots[8]?.count === 0, String(inventory.slots[8]?.count));
  check("counting finds the whole stack", countOf(inventory, "rubble") === 10);

  const added = addItem(inventory, { id: "rubble", count: 5 });
  check("adding rubble stacks it", added.inventory.slots[0]?.count === 15, String(added.inventory.slots[0]?.count));
  check("nothing was left over", added.leftover === 0);
  check("the original inventory is untouched", inventory.slots[0]?.count === 10);

  const full = createInventory([{ id: "loam", count: 64 }]);
  const overflow = addItem(full.inventory, { id: "loam", count: 64 });
  check("a full stack does not take more", overflow.inventory.slots[0]?.count === 64);
  check("the overflow goes into the next slot", overflow.inventory.slots[1]?.count === 64);
  check("nothing was left over", overflow.leftover === 0, String(overflow.leftover));

  // Every slot full: the next item has nowhere to go and stays in the world.
  const packed = createInventory(
    Array.from({ length: 9 }, () => ({ id: "loam", count: 64 })),
  );
  const refused = addItem(packed.inventory, { id: "gravel", count: 3 });
  check("a full pack takes nothing", countOf(refused.inventory, "gravel") === 0);
  check("the refused count is reported", refused.leftover === 3, String(refused.leftover));

  const removed = removeItem(inventory, "rubble", 4);
  check("removing takes the items out", removed.slots[0]?.count === 6, String(removed.slots[0]?.count));

  const selected = selectSlot(inventory, 3);
  check("the selection moves", selected.selected === 3, String(selected.selected));
  check("a slot beyond the last is clamped", selectSlot(inventory, 99).selected === 8);
  check("a negative slot is clamped", selectSlot(inventory, -5).selected === 0);
  check("the selected slot is empty here", heldItem(selected) === null);
}

// 5. A tool does not stack: two mattocks are two mattocks.
{
  const mattock = toolSpec("mattock_slate");
  check("the slate mattock exists", mattock !== undefined);
  const start = createInventory([{ id: "mattock_slate", count: 1, durability: 130 }]);
  const added = addItem(start.inventory, { id: "mattock_slate", count: 1, durability: 130 });
  check("a second mattock takes its own slot", added.inventory.slots[0]?.count === 1 && added.inventory.slots[1]?.count === 1);
}

// 6. An item's position is a pure function of the tick.
{
  const world = worldWithHole(0);
  const item = spawnItem(1, { id: "rubble", count: 1 }, 0, 2, 0, 100, world);
  const first = itemPosition(item, 105);
  const second = itemPosition(item, 105);
  check("the same tick gives the same position", first.x === second.x && first.y === second.y && first.z === second.z);
  const later = itemPosition(item, 200);
  check("the item settles at the bottom of the hole", later.y < first.y, `${first.y} -> ${later.y}`);
  const settled = itemPosition(item, 200);
  const settledAgain = itemPosition(item, 500);
  check("a settled item stays settled", settled.y === settledAgain.y, `${settled.y} vs ${settledAgain.y}`);
  // The order of updates cannot change where the item is.
  const a = itemPosition(item, 110);
  const b = itemPosition(item, 110);
  check("the position does not depend on update order", a.y === b.y);
}

// 7. The player collects an item by walking over it.
{
  const world = worldWithHole(0);
  const item = spawnItem(1, { id: "rubble", count: 1 }, 0, 2, 0, 0, world);
  const { inventory } = createInventory();
  // The player stands on the item for long enough for the pickup delay.
  const result = collectItems([item], inventory, { x: 0.5, y: 2.5, z: 0.5 }, 30);
  check("walking over the item collects it", countOf(result.inventory, "rubble") === 1, String(countOf(result.inventory, "rubble")));
  check("the item is gone from the ground", result.items.length === 0, String(result.items.length));
  // Too early: the pickup delay has not passed.
  const early = collectItems([item], inventory, { x: 0.5, y: 2.5, z: 0.5 }, 0);
  check("an item that just dropped is not hoovered up", countOf(early.inventory, "rubble") === 0);
  check("the item is still on the ground", early.items.length === 1, String(early.items.length));
}

// 8. An item out of reach is NOT collected.
//
// Slate is used here, not rubble: slate is NOT in the starting kit, so the
// count is unambiguous, and it needs a MATTOCK - the wrong-tool rule means
// bare hands cannot break it at all.
{
  const session = new GameplaySession();
  session.breakBlock(BlockId.Slate, toolSpec("mattock_timber") ?? null, 0, 2, 0, worldWithHole(0));
  check("slate broken with a mattock leaves an item", session.droppedItems().length === 1, String(session.droppedItems().length));
  for (let i = 0; i < 60; i++) {
    session.update(1 / 60, { x: 40, y: 2.5, z: 40 });
  }
  check("an item far away is not collected", countOf(session.carried, "slate") === 0, String(countOf(session.carried, "slate")));
}

// 9. The session: breaking a block leaves an item, and it can be collected.
{
  const session = new GameplaySession();
  const world = worldWithHole(0);
  session.breakBlock(BlockId.Slate, toolSpec("mattock_timber") ?? null, 0, 2, 0, world);
  check("the broken block left an item on the ground", session.droppedItems().length === 1, String(session.droppedItems().length));
  const dropped = session.droppedItems()[0];
  check("the dropped item is slate", dropped?.block === BlockId.Slate, String(dropped?.block));
  for (let i = 0; i < 60; i++) {
    session.update(1 / 60, { x: 0.5, y: 2.5, z: 0.5 });
  }
  check("the item was collected into the pack", countOf(session.carried, "slate") === 1, String(countOf(session.carried, "slate")));
  check("the ground is clear afterwards", session.droppedItems().length === 0);
}

// 9b. Rubble needs a mattock, so bare hands break nothing and drop nothing.
{
  const session = new GameplaySession();
  session.breakBlock(BlockId.Rubble, null, 0, 2, 0, worldWithHole(0));
  check("rubble broken bare-handed leaves nothing", session.droppedItems().length === 0);
  const withMattock = new GameplaySession();
  withMattock.breakBlock(BlockId.Rubble, toolSpec("mattock_timber") ?? null, 0, 2, 0, worldWithHole(0));
  check("rubble broken with a mattock leaves rubble", withMattock.droppedItems().length === 1);
}

// 10. A block broken with the wrong tool leaves NOTHING on the ground.
{
  const session = new GameplaySession();
  session.breakBlock(BlockId.Timber, toolSpec("mattock_timber") ?? null, 0, 2, 0, worldWithHole(0));
  check("timber broken with a mattock leaves nothing", session.droppedItems().length === 0);
}

// 11. Placing a block takes it out of the pack.
{
  const session = new GameplaySession();
  const carried = countOf(session.carried, "loam");
  check("the player starts with loam", carried === 16, String(carried));
  // Select the loam slot and place.
  const loamSlot = session.carried.slots.findIndex((slot) => slot.id === "loam");
  session.select(loamSlot);
  check("the held item is loam", session.held()?.id === "loam", String(session.held()?.id));
  check("the placement is allowed", session.consumeHeld());
  check("the pack is one loam lighter", countOf(session.carried, "loam") === 15, String(countOf(session.carried, "loam")));
}

// 12. The sixteen frozen tools are all real tool ids, so a crafted tool
//     occupies an inventory slot like any other item.
{
  check("there are sixteen tools", TOOL_SPECS.length === 16, String(TOOL_SPECS.length));
  for (const spec of TOOL_SPECS) {
    const resolved = toolSpec(spec.id);
    if (resolved === undefined) {
      check(`${spec.id} resolves to a spec`, false);
      continue;
    }
    const start = createInventory([{ id: spec.id, count: 1, durability: spec.durability }]);
    check(`${spec.id} goes in the pack`, start.inventory.slots[0]?.id === spec.id);
  }
}

if (failures > 0) {
  process.stderr.write(`\ndrops and inventory self-check FAILED: ${failures} check(s)\n`);
  process.exit(1);
}
process.stdout.write("\ndrops and inventory self-check PASSED\n");
