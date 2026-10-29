/**
 * BlockForge — mob data layer (T79 / M3).
 *
 * OWNERSHIP: GAMEPLAY. Pure: no DOM, no clock (tick is input, not Date),
 * deterministic from (world state, tick) — same tick + same inputs => same state,
 * regardless of which mob is updated first.
 *
 * Contract (frozen in src/core/types.ts): MobKind, MobStateKind, MobState.
 * Original names only: grazer, flutter, shellback, lurker, snarler.
 *
 * DESIGN (lazy / ponytail): smallest complete layer that satisfies the frozen
 * contract and the brief's determinism, spawn, pathing and drop rules.
 * - Spawn: deterministic from seed + chunk.
 * - AI: pure function of mob + tick + playerPos + solid check.
 * - Pathing: one-step vector toward target, refused if solid.
 * - Drops: wired into FOOD (survival) and item chain (drops table).
 */

import { createRng } from "../core/rng.js";
import type {
  MobKind,
  MobStateKind,
  MobState,
  Vec3,
  ChunkKey,
  ItemStack,
} from "../core/types.js";

/* ------------------------------------------------------------------ */
/*  Original food item ids — never a Mojang/Microsoft name.          */
/* ------------------------------------------------------------------ */

/** What each mob kind drops when it dies. Original ids, consistent
 * with the crafting/item chain (survival FOOD must list the same ids). */
export const MOB_DROP_ITEM: Readonly<Record<MobKind, string>> =
  Object.freeze({
    grazer: "grazermeat",
    flutter: "fluttermeat",
    shellback: "shellmeat",
    lurker: "lurkmeat",
    snarler: "snarlermeat",
  });

/** Drop table for a mob kind — pure data, used by session when a mob dies. */
export function mobDropTable(kind: MobKind): readonly ItemStack[] {
  return [{ id: MOB_DROP_ITEM[kind], count: 1 }];
}

/* ------------------------------------------------------------------ */
/*  Health / damage / speed constants (gameplay owns these).          */
/* ------------------------------------------------------------------ */

export const MOB_MAX_HEALTH: Readonly<Record<MobKind, number>> = Object.freeze({
  grazer: 10,
  flutter: 6,
  shellback: 12,
  lurker: 8,
  snarler: 14,
});

export const MOB_SPEED: Readonly<Record<MobKind, number>> = Object.freeze({
  grazer: 0.05,
  flutter: 0.08,
  shellback: 0.03,
  lurker: 0.07,
  snarler: 0.09,
});

export const AI_TIMER_DEFAULT = 20; // ticks between re-evaluations
export const DEATH_TIMER_MAX = 60; // ticks a dead mob lingers

/* ------------------------------------------------------------------ */
/*  Spawn — deterministic, seeded, order-independent.                  */
/* ------------------------------------------------------------------ */

/** Spawn a mob in/around the given chunk, pure of any clock. */
export function spawnMob(
  seed: number,
  kind: MobKind,
  home: ChunkKey,
  id: number,
): MobState {
  // Derive a per-mob, per-spawn child rng from seed + kind + chunk so
  // the same seed + same chunk always places the same mob at the same spot,
  // regardless of which mob spawns first in the batch.
  const rng = createRng(seed ^ (kind.length * 0x9e3779b9) ^ (home.cx * 31 + home.cz * 17));
  // Place near chunk center (chunk is 16x16 by convention used by world layer).
  const baseX = home.cx * 16 + 8;
  const baseZ = home.cz * 16 + 8;
  const offX = Math.floor(rng.nextFloat() * 10) - 5; // [-5, 4]
  const offZ = Math.floor(rng.nextFloat() * 10) - 5;
  const x = baseX + offX + 0.5;
  const z = baseZ + offZ + 0.5;
  const y = 2; // spawn at surface; world layer can adjust if chunk is below
  const maxH = MOB_MAX_HEALTH[kind];
  return {
    id,
    kind,
    position: { x, y, z },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: Math.floor(rng.nextFloat() * 360),
    health: maxH,
    maxHealth: maxH,
    state: "idle",
    home,
    aiTimer: AI_TIMER_DEFAULT,
    age: 0,
    onGround: true,
    deathTimer: 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Pure AI — depends only on mob + tick + player + solid check.     */
/*  No Date.now, no Math.random, no update-order dependency.           */
/* ------------------------------------------------------------------ */

/** Minimal view of the world needed by AI (gameplay passes this). */
export interface MobWorldView {
  readonly tick: number;
  readonly playerPos: Vec3 | null;
  readonly solidAt: (p: Vec3) => boolean;
}

/** Passive / hostile behavior classification (original names only). */
function isHostile(kind: MobKind): boolean {
  return kind === "lurker" || kind === "snarler";
}

/** Distance squared — pure arithmetic, no clock. */
function dist2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** One-step movement toward target, refused if the new cell is solid.
 * Pathfinding is deliberately cheap (no A* — just direct step with
 * solid-refuse) to stay affordable on the 2-CPU build host. */
function stepToward(
  from: Vec3,
  to: Vec3,
  speed: number,
  solidAt: (p: Vec3) => boolean,
): Vec3 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const nx = from.x + (dx / len) * speed;
  const ny = from.y + (dy / len) * speed;
  const nz = from.z + (dz / len) * speed;
  // Simple affordance: don't enter solid. If blocked, stay.
  if (solidAt({ x: nx, y: ny, z: nz })) {
    return from;
  }
  return { x: nx, y: ny, z: nz };
}

/** Core AI update — pure, order-independent, deterministic. */
export function updateMobAI(mob: MobState, view: MobWorldView): MobState {
  if (mob.state === "dead") {
    if (mob.deathTimer > 0) {
      return { ...mob, deathTimer: mob.deathTimer - 1 };
    }
    return mob; // removal is session-layer
  }
  if (mob.health <= 0) {
    return { ...mob, state: "dead", deathTimer: DEATH_TIMER_MAX, velocity: { x: 0, y: 0, z: 0 } };
  }

  // Derive all randomness from (mob.id, tick) through the official PRNG —
  // this is what makes it independent of which other mob ran first.
  const rng = createRng(mob.id * 0x9e3779b9 + view.tick);
  const timer = Math.max(0, mob.aiTimer - 1);

  // Passive / hostile radius thresholds (gameplay values, not frozen).
  const fleeRadius = 6; // blocks
  const chaseRadius = 12;
  const attackRadius = 2;

  const player = view.playerPos;
  const nearPlayer = player !== null && dist2(mob.position, player) < fleeRadius * fleeRadius;

  // Decision tree — pure, no hidden state.
  let nextState: MobStateKind = mob.state;
  let newPos = mob.position;
  let newVel = mob.velocity;
  let newTimer = timer;

  if (isHostile(mob.kind)) {
    if (player !== null) {
      const d = Math.sqrt(dist2(mob.position, player));
      if (d <= attackRadius) {
        nextState = "attack";
        newTimer = AI_TIMER_DEFAULT;
        // Attack does not move (pure interaction handled by session hurtByMob).
        newVel = { x: 0, y: 0, z: 0 };
      } else if (d <= chaseRadius) {
        nextState = "chase";
        newTimer = AI_TIMER_DEFAULT;
        const speed = MOB_SPEED[mob.kind];
        newPos = stepToward(mob.position, player, speed, view.solidAt);
        const dx = player.x - mob.position.x;
        const dz = player.z - mob.position.z;
        newVel = { x: dx, y: 0, z: dz };
      } else if (timer <= 0) {
        // Wander near home when player is far — deterministic from seed.
        nextState = "wander";
        newTimer = AI_TIMER_DEFAULT + Math.floor(rng.nextFloat() * 20);
        // Pick a target within 4 blocks of home center, pure seed.
        const cx = mob.home.cx * 16 + 8;
        const cz = mob.home.cz * 16 + 8;
        const tx = cx + (rng.nextFloat() * 8 - 4);
        const tz = cz + (rng.nextFloat() * 8 - 4);
        const speed = MOB_SPEED[mob.kind];
        newPos = stepToward(mob.position, { x: tx, y: mob.position.y, z: tz }, speed, view.solidAt);
      } else {
        newTimer = timer;
      }
    } else if (timer <= 0) {
      nextState = "wander";
      newTimer = AI_TIMER_DEFAULT + Math.floor(rng.nextFloat() * 20);
      const cx = mob.home.cx * 16 + 8;
      const cz = mob.home.cz * 16 + 8;
      const tx = cx + (rng.nextFloat() * 8 - 4);
      const tz = cz + (rng.nextFloat() * 8 - 4);
      const speed = MOB_SPEED[mob.kind];
      newPos = stepToward(mob.position, { x: tx, y: mob.position.y, z: tz }, speed, view.solidAt);
    }
  } else {
    // Passive kinds.
    if (nearPlayer && timer <= 0) {
      nextState = "flee";
      newTimer = AI_TIMER_DEFAULT;
      const awayX = mob.position.x - (player!.x - mob.position.x);
      const awayZ = mob.position.z - (player!.z - mob.position.z);
      const speed = MOB_SPEED[mob.kind];
      newPos = stepToward(mob.position, { x: awayX, y: mob.position.y, z: awayZ }, speed * 1.2, view.solidAt);
    } else if (timer <= 0) {
      // Re-evaluate: idle / graze / wander
      const roll = rng.nextFloat();
      if (roll < 0.4) {
        nextState = "idle";
      } else if (roll < 0.7) {
        nextState = "graze";
      } else {
        nextState = "wander";
      }
      newTimer = AI_TIMER_DEFAULT + Math.floor(rng.nextFloat() * 20);
      if (nextState === "wander") {
        const cx = mob.home.cx * 16 + 8;
        const cz = mob.home.cz * 16 + 8;
        const tx = cx + (rng.nextFloat() * 8 - 4);
        const tz = cz + (rng.nextFloat() * 8 - 4);
        const speed = MOB_SPEED[mob.kind];
        newPos = stepToward(mob.position, { x: tx, y: mob.position.y, z: tz }, speed, view.solidAt);
      }
      // graze: stay where we are (no movement)
    } else {
      // Between evaluations — continue current motion if wandering, else stay.
      if (mob.state === "wander") {
        // Carry through a deterministic drift: use seed based on mob + tick
        // but without reshuffling — keep direction flat for simplicity.
        // (Lazy: no complex inertia; wander just re-evaluates each timer.)
        newTimer = timer;
      } else {
        newTimer = timer;
      }
    }
  }

  // Age + ground check (pure — no clock read).
  const onGround = !view.solidAt({ x: newPos.x, y: newPos.y - 0.05, z: newPos.z }) &&
                   view.solidAt({ x: newPos.x, y: newPos.y, z: newPos.z }); // approximate
  const age = mob.age + 1;

  // Yaw: face movement direction or stay.
  let yaw = mob.yaw;
  if (nextState === "chase" || nextState === "flee" || nextState === "wander") {
    yaw = Math.atan2(newVel.x || 0, newVel.z || 0) * (180 / Math.PI);
    if (yaw < 0) yaw += 360;
  }

  return {
    ...mob,
    state: nextState,
    position: newPos,
    velocity: newVel,
    yaw: Math.round(yaw),
    aiTimer: newTimer,
    age,
    onGround,
    health: mob.health,
    deathTimer: mob.deathTimer,
  };
}

/* Interaction is handled by session -> hurtByMob / MOB_DAMAGE (survival);
 * this module provides pure drop data (mobDropTable) and pure AI (updateMobAI).
 * No extra wrapper needed. */
