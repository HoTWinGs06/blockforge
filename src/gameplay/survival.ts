/**
 * BlockForge — the survival rules: health, hunger, damage and death.
 *
 * OWNERSHIP: GAMEPLAY. Pure: no DOM, no clock, no randomness.
 *
 * The contract already freezes `PlayerState` with its `health` and `hunger`
 * fields, so nothing here needs adding to it. This module is the RULES
 * around those two numbers: how fast hunger drains, what hurts, what
 * heals, and what death means.
 *
 * THE CLOCK IS THE TICK
 * Hunger drains on the tick counter, never on the wall clock, and the
 * drain is a pure function of (state, ticks, activity). There is no
 * `Date.now()` and no `performance.now()` anywhere near it, so the same
 * ticks always produce the same survival state - the same rule the
 * day/night cycle and the dropped items already follow.
 *
 * THE SCALE IS 0..20
 * The HUD draws the health and hunger bars against a maximum of 20, so
 * both numbers live on that scale. Twenty is full health and a full
 * belly; zero health is death and zero hunger is starving.
 *
 * THE NUMBERS ARE GAMEPLAY'S TO CHOOSE
 * The contract fixes the two fields, not the tuning. These values are the
 * gameplay layer's own and can be retuned without touching the contract.
 */

import type { MobKind } from "../core/types.js";

/** Full health, and the top of the HUD's health bar. */
export const MAX_HEALTH = 20;

/** A full belly, and the top of the HUD's hunger bar. */
export const MAX_HUNGER = 20;

/**
 * Ticks of standing still that cost one point of hunger.
 *
 * At twenty ticks to the second that is thirty seconds a point, so a
 * full belly lasts ten minutes of doing nothing - long enough to explore,
 * short enough that the bar visibly moves while a player is playing.
 */
export const HUNGER_TICKS_PER_POINT = 600;

/**
 * What the player is doing, and how fast hunger drains while they do it.
 *
 * A number here is a MULTIPLIER on the tick count, not a rate of its own,
 * so a sprinting player drains exactly three times as fast as a sleeping
 * one, from the same rule.
 */
export type Activity = "idle" | "moving" | "sprinting";

/** The drain multiplier for each activity. */
export const ACTIVITY_DRAIN: Readonly<Record<Activity, number>> = Object.freeze({
  idle: 1,
  moving: 2,
  sprinting: 3,
});

/**
 * Ticks at zero hunger before the player loses a point of health.
 *
 * Five seconds a point, so a starving player has a minute or two to find
 * food before it starts to matter.
 */
export const STARVATION_TICKS_PER_DAMAGE = 100;

/**
 * Ticks of a well-fed player before they heal a point of health.
 *
 * Health does not come back on its own while the player is hungry, and
 * food only fills the belly - so the way back from a bad fall is to eat
 * and then wait.
 */
export const REGEN_TICKS = 600;

/** The hunger a player needs before they start healing. */
export const REGEN_HUNGER = 18;

/**
 * Blocks a fall may be without any harm.
 *
 * A jump is about one block, so three is comfortably above the height a
 * player can jump. Every block past that costs a point of health.
 */
export const SAFE_FALL_BLOCKS = 3;

/**
 * The food, and how much hunger each item puts back.
 *
 * The item ids are BlockForge's own. A mob's meat will go in here when
 * the mobs land (T79), and the drop table hands the player the same ids.
 */
export const FOOD: Readonly<Record<string, number>> = Object.freeze({
  wildfig: 3,
  grazermeat: 4,
  fluttermeat: 3,
  shellmeat: 2,
  lurkmeat: 3,
  snarlermeat: 4,
});

/**
 * The damage a mob's attack does, by mob kind.
 *
 * The passive kinds deal none - a grazer is not a threat - and the two
 * hostile kinds do. The kinds and their names are the contract's; these
 * numbers are gameplay's.
 */
export const MOB_DAMAGE: Readonly<Record<MobKind, number>> = Object.freeze({
  grazer: 0,
  flutter: 0,
  shellback: 0,
  lurker: 3,
  snarler: 4,
});

/**
 * The player's survival state.
 *
 * `health` and `hunger` are the two numbers the contract's `PlayerState`
 * carries. The two counters are the working detail: how far the player
 * is into the next hunger point, and how far into the next point of
 * starvation damage. They are part of the state so that the state is
 * closed - everything needed to continue the game is in here.
 */
export interface SurvivalState {
  readonly health: number;
  readonly hunger: number;
  /** True once health has run out: the player is dead until they respawn. */
  readonly dead: boolean;
  /** Ticks of drain accumulated toward the next point of hunger. */
  readonly drainTicks: number;
  /** Ticks at zero hunger accumulated toward the next point of damage. */
  readonly starveTicks: number;
  /** Ticks of being well fed accumulated toward the next point of healing. */
  readonly regenTicks: number;
}

/** A fresh player: full health, a full belly, and nothing counted yet. */
export function createSurvival(): SurvivalState {
  return {
    health: MAX_HEALTH,
    hunger: MAX_HUNGER,
    dead: false,
    drainTicks: 0,
    starveTicks: 0,
    regenTicks: 0,
  };
}

/**
 * Advance the survival state by a number of ticks.
 *
 * This is the whole of the hunger rule: the player drains at a rate set
 * by what they are doing, starves when the belly is empty, and heals
 * when it is full. The result depends only on the state it was given,
 * the number of ticks, and the activity - so the same ticks always give
 * the same answer.
 */
export function advanceSurvival(
  state: SurvivalState,
  ticks: number,
  activity: Activity,
): SurvivalState {
  if (ticks <= 0 || state.dead) {
    return state;
  }

  // Hunger drains first, weighted by the activity.
  let drainTicks = state.drainTicks + ticks * ACTIVITY_DRAIN[activity];
  let hunger = state.hunger;
  while (drainTicks >= HUNGER_TICKS_PER_POINT) {
    drainTicks -= HUNGER_TICKS_PER_POINT;
    hunger = Math.max(0, hunger - 1);
  }

  // An empty belly hurts, and a full one heals.
  let starveTicks = state.starveTicks;
  let regenTicks = state.regenTicks;
  let health = state.health;
  if (hunger === 0) {
    starveTicks += ticks;
    while (starveTicks >= STARVATION_TICKS_PER_DAMAGE) {
      starveTicks -= STARVATION_TICKS_PER_DAMAGE;
      health = Math.max(0, health - 1);
    }
    regenTicks = 0;
  } else if (hunger >= REGEN_HUNGER) {
    regenTicks += ticks;
    while (regenTicks >= REGEN_TICKS) {
      regenTicks -= REGEN_TICKS;
      health = Math.min(MAX_HEALTH, health + 1);
    }
    starveTicks = 0;
  } else {
    starveTicks = 0;
    regenTicks = 0;
  }

  return {
    health,
    hunger,
    dead: health <= 0,
    drainTicks,
    starveTicks,
    regenTicks,
  };
}

/**
 * Take health off the player.
 *
 * The amount is clamped at zero, and hitting zero is death. A dead
 * player stays dead until they respawn, so nothing here brings them
 * back.
 */
export function damageSurvival(state: SurvivalState, amount: number): SurvivalState {
  if (state.dead || amount <= 0) {
    return state;
  }
  const health = Math.max(0, state.health - amount);
  return { ...state, health, dead: health <= 0 };
}

/**
 * The damage a fall of the given distance does.
 *
 * A fall of three blocks or less is free, and every block past that
 * costs a point of health. The distance is in blocks.
 */
export function fallDamage(distance: number): number {
  if (distance <= SAFE_FALL_BLOCKS) {
    return 0;
  }
  return Math.floor(distance - SAFE_FALL_BLOCKS);
}

/**
 * The food value of an item, or zero when it is not food.
 */
export function foodValue(itemId: string): number {
  return FOOD[itemId] ?? 0;
}

/**
 * Eat something and put the hunger back.
 *
 * Returns the state unchanged when the item is not food or the player
 * is not hungry, so a full player does not waste a meal.
 */
export function eatSurvival(state: SurvivalState, itemId: string): SurvivalState {
  const value = foodValue(itemId);
  if (value <= 0 || state.dead || state.hunger >= MAX_HUNGER) {
    return state;
  }
  return { ...state, hunger: Math.min(MAX_HUNGER, state.hunger + value) };
}

/**
 * The state a player comes back with: alive, whole and fed.
 *
 * The world is not touched by this. Death is the player's business -
 * the blocks they broke stay broken and the items they dropped stay
 * where they fell.
 */
export function respawnSurvival(): SurvivalState {
  return createSurvival();
}
