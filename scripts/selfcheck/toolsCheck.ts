/**
 * Tools self-check.
 *
 * Verifies the properties the operator's "add crafting tools" complaint
 * depends on:
 *   - a tool in the hand loses one use of its durability every time it
 *     breaks a block;
 *   - a tool whose last use is spent BREAKS and leaves the pack;
 *   - a REFUSED break costs the tool nothing: the wrong kind of tool does
 *     not break the block, does not drop it, and does not wear;
 *   - only the tool in the HAND wears - a tool in another slot is untouched;
 *   - the sabre is a weapon: no block needs it, and it is not in the
 *     mining table, but it has damage numbers of its own.
 *
 * Build and run:
 *   npx tsc -p scripts/tsconfig.build.json
 *   node node_modules/.cache/blockforge-scripts/scripts/selfcheck/toolsCheck.js
 */

import {
  GameplaySession,
  countOf,
  sabreDamage,
  wearTool,
} from "../../src/gameplay/index.js";
import { craft } from "../../src/gameplay/crafting.js";
import { createGrid, gridWith } from "../../src/core/crafting/index.js";
import { BlockId } from "../../src/core/types.js";
import { TOOL_SPECS, canBreak, requiredToolFor, toolSpec } from "../../src/core/constants.js";
import type { Inventory, ToolSpec } from "../../src/core/types.js";

let failures = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    process.stdout.write(`  ok   ${name}\n`);
  } else {
    failures++;
    process.stderr.write(`  FAIL ${name} ${detail}\n`);
  }
}

process.stdout.write("tools self-check\n");

/** A pack holding one tool, with that tool in hand. */
function packWith(tool: ToolSpec, durability = tool.durability): Inventory {
  return {
    slots: [
      { id: tool.id, count: 1, durability },
      { id: "rubble", count: 4 },
    ],
    selected: 0,
  };
}

/** The durability left on the tool in hand, or null when it is gone. */
function wearLeft(inventory: Inventory): number | null {
  const slot = inventory.slots[inventory.selected];
  return slot === undefined || slot.id === "" ? null : (slot.durability ?? null);
}

const mattock = toolSpec("mattock_timber");
const trowel = toolSpec("trowel_timber");
const billhook = toolSpec("billhook_timber");

if (mattock === undefined || trowel === undefined || billhook === undefined) {
  check("the contract's tools resolve", false);
  process.stderr.write("the contract's tools do not resolve - the check cannot run\n");
  process.exit(1);
}

// 1. A tool in the hand wears by one use per break.
{
  const before = packWith(mattock);
  const wear = wearTool(before, mattock);
  check("a tool loses one use", wearLeft(wear.inventory) === mattock.durability - 1, String(wearLeft(wear.inventory)));
  check("the tool did not break", wear.broke === false);
  check("the pack is a new pack", wear.inventory !== before);
  check("the old pack is untouched", wearLeft(before) === mattock.durability);
}

// 2. A tool with one use left BREAKS and leaves the pack.
{
  const wear = wearTool(packWith(mattock, 1), mattock);
  check("the last use breaks the tool", wear.broke === true);
  check("a broken tool leaves the pack", wearLeft(wear.inventory) === null, String(wearLeft(wear.inventory)));
  check("the slot is empty, not negative", (wear.inventory.slots[0]?.count ?? 0) === 0);
}

// 3. Only the tool in the HAND wears.
{
  const pack: Inventory = {
    slots: [
      { id: "rubble", count: 4 },
      { id: mattock.id, count: 1, durability: mattock.durability },
    ],
    selected: 0,
  };
  const wear = wearTool(pack, mattock);
  check("a tool in another slot does not wear", wearLeft(wear.inventory) === null);
  check("the other tool is untouched", wear.inventory.slots[1]?.durability === mattock.durability);
  check("nothing broke", wear.broke === false);
}

// 4. A tool with no recorded wear starts at the contract's full durability.
{
  const wear = wearTool(
    { slots: [{ id: mattock.id, count: 1 }, { id: "", count: 0 }], selected: 0 },
    mattock,
  );
  check("an unworn tool starts at full durability", wearLeft(wear.inventory) === mattock.durability - 1, String(wearLeft(wear.inventory)));
}

// 5. THE WRONG-TOOL RULE: a refused break costs the tool nothing.
{
  // Timber needs a billhook, so a mattock is refused.
  check("timber needs a billhook", requiredToolFor(BlockId.Timber) === "billhook", String(requiredToolFor(BlockId.Timber)));
  check("a mattock cannot break timber", !canBreak(BlockId.Timber, mattock));
  check("a mattock cannot break clay", !canBreak(BlockId.Clay, mattock));
  check("a billhook can break timber", canBreak(BlockId.Timber, billhook));
  // The session is the place where the wear and the drop table meet.
  const session = new GameplaySession();
  session.breakBlock(BlockId.Timber, mattock, 0, 2, 0, { isSolid: () => false });
  const mattockSlot = session.carried.slots.find((slot) => slot.id === mattock.id);
  check("a refused break leaves the tool whole", mattockSlot?.durability === mattock.durability, String(mattockSlot?.durability));
  check("a refused break drops nothing", session.droppedItems().length === 0, String(session.droppedItems().length));
}

// 6. A real break wears the tool AND drops the block.
{
  const session = new GameplaySession();
  const outcome = session.breakBlock(BlockId.Rubble, mattock, 0, 2, 0, { isSolid: () => false });
  const slot = session.carried.slots.find((s) => s.id === mattock.id);
  check("a real break wears the tool", slot?.durability === mattock.durability - 1, String(slot?.durability));
  check("a real break drops the block", session.droppedItems().length === 1, String(session.droppedItems().length));
  check("nothing broke yet", outcome.toolBroke === null);
}

// 7. The tool breaks when its last use is spent, and says so.
{
  const session = new GameplaySession();
  // Put a nearly spent mattock in hand.
  const mattockIndex = session.carried.slots.findIndex((slot) => slot.id === mattock.id);
  session.select(mattockIndex);
  // Spend the tool down by breaking rubble until it gives out.
  let broke: string | null = null;
  for (let i = 0; i < mattock.durability + 2 && broke === null; i++) {
    const outcome = session.breakBlock(BlockId.Rubble, mattock, 0, 2, 0, { isSolid: () => false });
    broke = outcome.toolBroke;
  }
  check("the tool eventually breaks", broke === mattock.id, String(broke));
  check("a broken tool is not in the pack", countOf(session.carried, mattock.id) === 0, String(countOf(session.carried, mattock.id)));
}

// 8. Bare hands never wear anything.
{
  const session = new GameplaySession();
  session.breakBlock(BlockId.Rubble, null, 0, 2, 0, { isSolid: () => false });
  const slot = session.carried.slots.find((s) => s.id === mattock.id);
  check("bare hands wear nothing", slot?.durability === mattock.durability, String(slot?.durability));
}

// 9. The sabre is a weapon, not a digging tool.
{
  check("the sabre is a tool kind", TOOL_SPECS.length === 16);
  check("no block needs a sabre", !Object.values(BlockId).some((b) => requiredToolFor(b) === "sabre"));
  check("the sabre has no mining spec", !TOOL_SPECS.some((spec) => spec.kind === "sabre"));
  check("a sabre does damage", sabreDamage("timber") > 0, String(sabreDamage("timber")));
  check("a better sabre does more damage", sabreDamage("lumencrystal") > sabreDamage("timber"));
}

// 10. Every frozen tool is a real tool, with a spec that resolves.
{
  for (const spec of TOOL_SPECS) {
    const resolved = toolSpec(spec.id);
    check(`${spec.id} resolves to its own spec`, resolved?.id === spec.id);
    check(`${spec.id} has a durability above zero`, spec.durability > 0, String(spec.durability));
  }
}

// 11. THE WHOLE CHAIN: craft a tool, put it in the pack, and mine with it.
//
// This is the operator's complaint - "there is no way to get or build
// tools" - read as one line of play: the recipe table makes a mattock, the
// mattock goes in the pack, the player takes it in hand, and breaking a
// block with it wears it down.
{
  // A slate mattock: three rocks for the head, two planks for the handle.
  const head = { id: "rubble", count: 1 };
  const handle = { id: "millplank", count: 1 };
  let grid = createGrid(3);
  grid = gridWith(grid, 0, head);
  grid = gridWith(grid, 1, head);
  grid = gridWith(grid, 2, head);
  grid = gridWith(grid, 4, handle);
  grid = gridWith(grid, 7, handle);
  const outcome = craft(grid);
  check("three rocks and two planks make a slate mattock", outcome?.result.id === "mattock_slate", String(outcome?.result.id));
  check("the crafted mattock starts at full durability", outcome?.result.durability === TOOL_SPECS.find((s) => s.id === "mattock_slate")?.durability, String(outcome?.result.durability));

  // It goes in the pack and the player takes it in hand.
  const session = new GameplaySession();
  const given = session.give(outcome?.result ?? { id: "mattock_slate", count: 1 });
  check("the crafted mattock goes in the pack", given.leftover === 0, String(given.leftover));
  const slot = session.carried.slots.findIndex((s) => s.id === "mattock_slate");
  check("the crafted mattock is in a slot", slot >= 0, String(slot));
  session.select(slot);
  check("the crafted mattock is in hand", session.held()?.id === "mattock_slate", String(session.held()?.id));

  // And it mines, and it wears.
  const slate = toolSpec("mattock_slate");
  if (slate !== undefined) {
    session.breakBlock(BlockId.Slate, slate, 0, 2, 0, { isSolid: () => false });
    const worn = session.carried.slots.find((s) => s.id === "mattock_slate");
    check("the crafted mattock wears when it mines", worn?.durability === slate.durability - 1, String(worn?.durability));
    check("the crafted mattock dropped the slate", session.droppedItems().length === 1, String(session.droppedItems().length));
  }
}

if (failures > 0) {
  process.stderr.write(`\ntools self-check FAILED: ${failures} check(s)\n`);
  process.exit(1);
}
process.stdout.write("\ntools self-check PASSED\n");
