/**
 * BlockForge — the gameplay layer's public surface.
 *
 * OWNERSHIP: GAMEPLAY. Pure logic: no DOM, no clock, no randomness.
 *
 * The game loop (src/main.ts) talks to this and nothing else in the layer,
 * so the internals can move without breaking the caller.
 *
 * NOTE: src/core/index.ts is the ARCHITECT's core barrel and does not
 * re-export this layer, because src/core/ must not depend on src/gameplay/
 * (the layering rule in docs/ARCHITECTURE.md). Import the gameplay layer
 * as "./gameplay/index.js" from the app shell.
 */

export {
  GameplaySession,
  TICKS_PER_SECOND,
  MOB_SPAWN_INTERVAL_TICKS,
  MAX_MOBS,
  MOB_SPAWN_RING_RADIUS,
  MOB_MIN_SPAWN_DISTANCE,
  MOB_SPAWN_SEARCH_TOP,
  MOB_SPAWN_SEARCH_BOTTOM,
  MOB_ATTACK_COOLDOWN_TICKS,
} from "./session.js";
export type {
  BreakOutcome,
  DroppedItemView,
  EatOutcome,
  MobView,
} from "./session.js";
export {
  advanceSurvival,
  createSurvival,
  damageSurvival,
  eatSurvival,
  fallDamage,
  foodValue,
  respawnSurvival,
  ACTIVITY_DRAIN,
  FOOD,
  HUNGER_TICKS_PER_POINT,
  MOB_DAMAGE,
  MAX_HEALTH,
  MAX_HUNGER,
  REGEN_HUNGER,
  REGEN_TICKS,
  SAFE_FALL_BLOCKS,
  STARVATION_TICKS_PER_DAMAGE,
} from "./survival.js";
export type { Activity, SurvivalState } from "./survival.js";
export {
  addItem,
  countOf,
  createInventory,
  heldItem,
  isEmpty,
  removeItem,
  selectSlot,
  EMPTY_STACK,
  HOTBAR_SLOTS,
  MAX_STACK,
} from "./inventory.js";
export type { AddResult } from "./inventory.js";
export { dropFor } from "./drops.js";
export { SABRE_DAMAGE, sabreDamage, wearTool } from "./tools.js";
export type { ToolWear } from "./tools.js";
export {
  collectItems,
  isWithinReach,
  itemPosition,
  spawnItem,
  ITEM_SIZE,
  ITEM_LIFETIME_TICKS,
  PICKUP_DELAY_TICKS,
  PICKUP_RADIUS,
  SETTLE_TICKS,
} from "./itemEntities.js";
export type { CollectResult, ItemEntity, SolidProbe } from "./itemEntities.js";
export {
  stockOf,
  recipeBook,
  preview,
  craft,
  gridSize,
} from "./crafting.js";
export type { CraftOutcome, StockEntry } from "./crafting.js";
export {
  spawnMob,
  updateMobAI,
  mobDropTable,
  MOB_DROP_ITEM,
  MOB_MAX_HEALTH,
  MOB_SPEED,
  AI_TIMER_DEFAULT,
  DEATH_TIMER_MAX,
} from "./mobs.js";
export type { MobWorldView } from "./mobs.js";
