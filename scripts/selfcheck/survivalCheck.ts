/**
 * Survival self-check.
 *
 * Verifies the properties the operator's "and shit - the rest of the
 * survival loop" complaint depends on:
 *   - hunger DRAINS, on the tick counter, and it drains FASTER with
 *     activity;
 *   - health falls when the player starves, when a mob hits them and
 *     when they fall from a height;
 *   - zero health is DEATH, and death respawns the player while the world
 *     survives it;
 *   - food puts the hunger back and is eaten from the pack;
 *   - the same ticks always give the same survival state.
 *
 * Build and run:
 *   npx tsc -p scripts/tsconfig.build.json
 *   node node_modules/.cache/blockforge-scripts/scripts/selfcheck/survivalCheck.js
 */

import {
  ACTIVITY_DRAIN,
  FOOD,
  GameplaySession,
  HUNGER_TICKS_PER_POINT,
  MOB_DAMAGE,
  MAX_HEALTH,
  MAX_HUNGER,
  SAFE_FALL_BLOCKS,
  advanceSurvival,
  countOf,
  createSurvival,
  fallDamage,
} from "../../src/gameplay/index.js";
import { BlockId } from "../../src/core/types.js";
import { toolSpec } from "../../src/core/constants.js";

let failures = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    process.stdout.write(`  ok   ${name}\n`);
  } else {
    failures++;
    process.stderr.write(`  FAIL ${name} ${detail}\n`);
  }
}

process.stdout.write("survival self-check\n");

// 1. A fresh player is whole and fed.
{
  const state = createSurvival();
  check("a new player has full health", state.health === MAX_HEALTH, String(state.health));
  check("a new player has a full belly", state.hunger === MAX_HUNGER, String(state.hunger));
  check("a new player is not dead", state.dead === false);
}

// 2. Hunger drains on the tick counter, and faster with activity.
{
  const idle = advanceSurvival(createSurvival(), HUNGER_TICKS_PER_POINT, "idle");
  check("a point of hunger is gone after one drain period", idle.hunger === MAX_HUNGER - 1, String(idle.hunger));
  check("health is untouched by hunger", idle.health === MAX_HEALTH, String(idle.health));

  const sprinting = advanceSurvival(createSurvival(), HUNGER_TICKS_PER_POINT, "sprinting");
  check(
    "sprinting drains faster than idling",
    sprinting.hunger < idle.hunger,
    `${String(sprinting.hunger)} vs ${String(idle.hunger)}`,
  );
  check("moving drains faster than idling", advanceSurvival(createSurvival(), HUNGER_TICKS_PER_POINT, "moving").hunger < idle.hunger);
  check("sprinting drains faster than moving", advanceSurvival(createSurvival(), HUNGER_TICKS_PER_POINT, "sprinting").hunger < advanceSurvival(createSurvival(), HUNGER_TICKS_PER_POINT, "moving").hunger);
  check("the drain multipliers are what the table says", ACTIVITY_DRAIN.idle === 1 && ACTIVITY_DRAIN.moving === 2 && ACTIVITY_DRAIN.sprinting === 3);
}

// 3. The drain is a pure function of the ticks: the same ticks, the same
//    answer, however the ticks are split up.
{
  const oneBigCall = advanceSurvival(createSurvival(), 100, "moving");
  let manySmallCalls = createSurvival();
  for (let i = 0; i < 100; i++) {
    manySmallCalls = advanceSurvival(manySmallCalls, 1, "moving");
  }
  check("splitting the ticks changes nothing", oneBigCall.hunger === manySmallCalls.hunger, `${String(oneBigCall.hunger)} vs ${String(manySmallCalls.hunger)}`);
  check("splitting the ticks changes nothing (health)", oneBigCall.health === manySmallCalls.health);
  check("the same ticks give the same state", advanceSurvival(createSurvival(), 77, "idle").hunger === advanceSurvival(createSurvival(), 77, "idle").hunger);
}

// 4. Hunger never goes below zero, and a starved player starts to hurt.
{
  const starved = advanceSurvival(createSurvival(), HUNGER_TICKS_PER_POINT * MAX_HUNGER * 4, "idle");
  check("hunger stops at zero", starved.hunger === 0, String(starved.hunger));
  check("starving costs health", starved.health < MAX_HEALTH, String(starved.health));

  // Drain the belly dry, then keep going: the health must go.
  let state = createSurvival();
  for (let i = 0; i < HUNGER_TICKS_PER_POINT * MAX_HUNGER + 400; i++) {
    state = advanceSurvival(state, 1, "idle");
  }
  check("a long hunger drain starves the player", state.health < MAX_HEALTH, String(state.health));
  check("a starving player is not dead yet", state.dead === false, String(state.health));
}

// 5. A well-fed player heals.
{
  let state = createSurvival();
  state = { ...state, health: 10 };
  for (let i = 0; i < 4000; i++) {
    state = advanceSurvival(state, 1, "idle");
  }
  check("a fed player heals", state.health > 10, String(state.health));
  check("a fed player never heals past the maximum", state.health <= MAX_HEALTH, String(state.health));
}

// 6. The fall rule.
{
  check("a small fall is free", fallDamage(SAFE_FALL_BLOCKS) === 0, String(fallDamage(SAFE_FALL_BLOCKS)));
  check("a fall past the safe distance hurts", fallDamage(SAFE_FALL_BLOCKS + 1) > 0, String(fallDamage(SAFE_FALL_BLOCKS + 1)));
  check("the damage grows with the drop", fallDamage(10) > fallDamage(5));
  check("no fall is negative damage", fallDamage(-4) === 0, String(fallDamage(-4)));
}

// 7. The session: hunger drains while the player stands still.
{
  const session = new GameplaySession();
  const before = session.hunger;
  // Ten minutes of game time, one tick at a time, at twenty ticks a second.
  for (let i = 0; i < 12000; i++) {
    session.update(1 / 20, { x: 0.5, y: 70, z: 0.5 }, "idle", true);
  }
  check("hunger drains in the real session", session.hunger < before, `${String(before)} -> ${String(session.hunger)}`);
  check("the session reports real health", session.health <= MAX_HEALTH, String(session.health));
  check("the player is not dead from standing still", session.dead === false, String(session.health));
}

// 8. The session: a fall hurts, but the drop into the world does not.
{
  const session = new GameplaySession();
  // The spawn drop: the player starts in the air and lands. It is not a
  // fall the player took, so it costs nothing.
  session.update(1 / 20, { x: 0.5, y: 90, z: 0.5 }, "idle", false);
  session.update(1 / 20, { x: 0.5, y: 70, z: 0.5 }, "idle", true);
  check("the drop into the world is free", session.health === MAX_HEALTH, String(session.health));

  // Now a real fall: the player has landed, jumps off a cliff and lands.
  session.update(1 / 20, { x: 0.5, y: 70, z: 0.5 }, "idle", true);
  session.update(1 / 20, { x: 0.5, y: 70, z: 0.5 }, "idle", false);
  session.update(1 / 20, { x: 0.5, y: 60, z: 0.5 }, "idle", false);
  session.update(1 / 20, { x: 0.5, y: 60, z: 0.5 }, "idle", true);
  check("a real fall hurts", session.health < MAX_HEALTH, String(session.health));
}

// 9. The session: a mob's attack lands.
{
  const session = new GameplaySession();
  const before = session.health;
  session.hurtByMob("lurker");
  check("a lurker's bite hurts", session.health < before, `${String(before)} -> ${String(session.health)}`);
  check("the bite does what the table says", session.health === before - MOB_DAMAGE.lurker, String(session.health));

  const passive = new GameplaySession();
  passive.hurtByMob("grazer");
  check("a grazer does not bite", passive.health === MAX_HEALTH, String(passive.health));
}

// 10. Death, and the respawn that follows.
{
  const session = new GameplaySession();
  session.damage(MAX_HEALTH);
  check("no health left is death", session.dead === true);
  check("a dead player is at zero health", session.health === 0, String(session.health));

  // The world survives: the pack is still there.
  check("the pack survives the death", countOf(session.carried, "rubble") === 16, String(countOf(session.carried, "rubble")));

  session.respawn();
  check("the respawn brings the player back", session.dead === false);
  check("the respawn restores the health", session.health === MAX_HEALTH, String(session.health));
  check("the respawn fills the belly", session.hunger === MAX_HUNGER, String(session.hunger));
  check("the world still survives the respawn", countOf(session.carried, "rubble") === 16, String(countOf(session.carried, "rubble")));
}

// 11. Food puts the hunger back, and it is eaten from the pack.
{
  const session = new GameplaySession();
  // Take a bite out of the belly first: three drain periods, so there is
  // room for a whole meal to go back in.
  for (let i = 0; i < HUNGER_TICKS_PER_POINT * 3; i++) {
    session.update(1 / 20, { x: 0.5, y: 70, z: 0.5 }, "idle", true);
  }
  const hungry = session.hunger;
  check("the player is hungry before the meal", hungry < MAX_HUNGER, String(hungry));

  // A wildfig in hand: the canopy drop.
  const fig = session.give({ id: "wildfig", count: 2 });
  check("the fig went into the pack", fig.leftover === 0, String(fig.leftover));
  const slot = session.carried.slots.findIndex((item) => item.id === "wildfig");
  check("the fig is in a slot", slot >= 0, String(slot));
  session.select(slot);
  check("the fig is in hand", session.held()?.id === "wildfig", String(session.held()?.id));

  const outcome = session.eat();
  check("the meal was eaten", outcome.ate === true, String(outcome.reason));
  check("the meal put hunger back", session.hunger > hungry, `${String(hungry)} -> ${String(session.hunger)}`);
  check("the meal was worth what the food table says", outcome.restored === FOOD.wildfig, String(outcome.restored));
  check("the fig left the pack", countOf(session.carried, "wildfig") === 1, String(countOf(session.carried, "wildfig")));

  // A full player does not waste a meal.
  const full = new GameplaySession();
  full.give({ id: "wildfig", count: 1 });
  const fullSlot = full.carried.slots.findIndex((item) => item.id === "wildfig");
  full.select(fullSlot);
  const refused = full.eat();
  check("a full player refuses the meal", refused.ate === false);
  check("the refusal says why", refused.reason === "not-hungry", String(refused.reason));
  check("the refused meal stays in the pack", countOf(full.carried, "wildfig") === 1, String(countOf(full.carried, "wildfig")));
}

// 12. A block that is not food cannot be eaten.
{
  const session = new GameplaySession();
  const slot = session.carried.slots.findIndex((item) => item.id === "rubble");
  session.select(slot);
  const outcome = session.eat();
  check("rubble is not food", outcome.ate === false);
  check("the refusal says it is not food", outcome.reason === "not-food", String(outcome.reason));
}

// 13. The food comes from somewhere: the tree canopy.
{
  const billhook = toolSpec("billhook_timber") ?? null;
  const session = new GameplaySession();
  session.breakBlock(BlockId.Foliage, billhook, 0, 70, 0, { isSolid: () => false });
  check("the canopy drops a fig", session.droppedItems().length === 1, String(session.droppedItems().length));
  check("the drop is a fig", session.droppedItems()[0]?.block === ("wildfig" as BlockId), String(session.droppedItems()[0]?.block));
  // And the wrong-tool rule still holds on the canopy.
  const wrong = new GameplaySession();
  wrong.breakBlock(BlockId.Foliage, toolSpec("mattock_timber") ?? null, 0, 70, 0, { isSolid: () => false });
  check("the canopy drops nothing for the wrong tool", wrong.droppedItems().length === 0, String(wrong.droppedItems().length));
}

// 14. The whole loop: starve, die, respawn, eat, live.
{
  const session = new GameplaySession();
  // Break the canopy for food first, the way a player would.
  session.breakBlock(BlockId.Foliage, toolSpec("billhook_timber") ?? null, 0, 70, 0, { isSolid: () => false });
  // The drop needs a moment before it can be picked up, so walk over it
  // for a few ticks.
  for (let i = 0; i < 20; i++) {
    session.update(1 / 20, { x: 0.5, y: 70, z: 0.5 }, "idle", true);
  }
  check("the fig was collected", countOf(session.carried, "wildfig") === 1, String(countOf(session.carried, "wildfig")));

  // Starve the player all the way down.
  for (let i = 0; i < 20000; i++) {
    session.update(1 / 20, { x: 0.5, y: 70, z: 0.5 }, "idle", true);
  }
  check("the player starved", session.dead === true, String(session.health));
  check("a starved player is at zero health", session.health === 0, String(session.health));

  session.respawn();
  check("the player is alive again", session.dead === false);
  check("the player is fed again", session.hunger === MAX_HUNGER, String(session.hunger));
  check("the fig survived the death", countOf(session.carried, "wildfig") === 1, String(countOf(session.carried, "wildfig")));

  // And the meal is still good for food - once the player is hungry again.
  // Three drain periods, so there is room for a whole meal to go back in.
  for (let i = 0; i < HUNGER_TICKS_PER_POINT * 3; i++) {
    session.update(1 / 20, { x: 0.5, y: 70, z: 0.5 }, "idle", true);
  }
  const slot = session.carried.slots.findIndex((item) => item.id === "wildfig");
  session.select(slot);
  const meal = session.eat();
  check("the meal after the respawn works", meal.ate === true, String(meal.reason));
  check("the meal after the respawn restored hunger", meal.restored === FOOD.wildfig, String(meal.restored));
}

if (failures > 0) {
  process.stderr.write(`\nsurvival self-check FAILED: ${failures} check(s)\n`);
  process.exit(1);
}
process.stdout.write("\nsurvival self-check PASSED\n");
