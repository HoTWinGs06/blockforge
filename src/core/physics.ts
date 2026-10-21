/**
 * BlockForge — AABB collision and gravity.
 *
 * OWNERSHIP: ENGINE.
 *
 * Pure: no state, no side effects, no time source. The caller passes the
 * delta and the world query; the functions return new values. The same
 * inputs always produce the same output, in any process.
 *
 * The body is an axis-aligned box whose `position` is the centre of its
 * feet. Collisions are resolved one axis at a time (X, then Y, then Z),
 * which is the standard voxel approach: it is simple, stable and cannot trap
 * a body inside a wall.
 *
 * A blocked axis SNAPS to the surface it hit rather than stopping short, so
 * a body resting on the floor has its feet exactly on the floor's top face
 * (y = 1 for a block at y = 0) instead of a fraction above it.
 */
import { SOLID_BLOCKS } from "./types.js";
import type { Aabb, Vec3 } from "./types.js";

/** Blocks per second the player falls, before terminal velocity. */
export const GRAVITY = 28;
/** Fall speed cap, in blocks per second. */
export const TERMINAL_VELOCITY = 60;

/** Half-width of the player's collision box. */
export const PLAYER_HALF_WIDTH = 0.3;
/** Height of the player's collision box. */
export const PLAYER_HEIGHT = 1.8;

/**
 * The height of a ledge the player walks up without jumping.
 *
 * One whole block, not the usual half. This matters: the terrain is made of
 * whole blocks, so a smaller step height would never let the player walk up
 * anything at all - every ledge would need a jump, and jumping while pressed
 * against a wall is the case that does not work.
 */
export const STEP_HEIGHT = 1.0;

/** Slack used when testing for overlap, so touching faces do not collide. */
const EPSILON = 1e-9;

/**
 * Longest distance a body may move in one collision sample, in blocks.
 *
 * A block is one unit thick, so any move shorter than this cannot pass a
 * whole block between two samples.
 */
const MAX_MOVE_STEP = 0.5;

/**
 * A world query for collision. Implementations are pure lookups — the
 * engine's chunk store backs one, a test can back another with a map.
 */
export interface SolidWorld {
  /** True when the block at the given integer coordinates is solid. */
  isSolid(x: number, y: number, z: number): boolean;
}

/** The result of a movement step. */
export interface MoveResult {
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** True when the body is resting on a solid block. */
  readonly onGround: boolean;
  /** True when any axis was blocked during the step. */
  readonly collided: boolean;
}

/** The collision box of a body standing with its feet at `feet`. */
export function bodyAabb(feet: Vec3, halfWidth = PLAYER_HALF_WIDTH, height = PLAYER_HEIGHT): Aabb {
  return {
    minX: feet.x - halfWidth,
    minY: feet.y,
    minZ: feet.z - halfWidth,
    maxX: feet.x + halfWidth,
    maxY: feet.y + height,
    maxZ: feet.z + halfWidth,
  };
}

/** True when two boxes overlap. Touching boxes do not overlap. */
export function aabbIntersects(a: Aabb, b: Aabb): boolean {
  return (
    a.minX < b.maxX &&
    a.maxX > b.minX &&
    a.minY < b.maxY &&
    a.maxY > b.minY &&
    a.minZ < b.maxZ &&
    a.maxZ > b.minZ
  );
}

/** The integer block range a box covers along one axis. */
function blockRange(min: number, max: number): [number, number] {
  return [Math.floor(min), Math.floor(max - EPSILON)];
}

/** True when the box overlaps any solid block in the world. */
export function collides(box: Aabb, world: SolidWorld): boolean {
  const [minX, maxX] = blockRange(box.minX, box.maxX);
  const [minY, maxY] = blockRange(box.minY, box.maxY);
  const [minZ, maxZ] = blockRange(box.minZ, box.maxZ);
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (world.isSolid(x, y, z)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * The solid blocks a box overlaps.
 *
 * Returned as a list so the caller can snap against the exact face it hit.
 */
function overlappingBlocks(
  box: Aabb,
  world: SolidWorld,
): Array<[number, number, number]> {
  const [minX, maxX] = blockRange(box.minX, box.maxX);
  const [minY, maxY] = blockRange(box.minY, box.maxY);
  const [minZ, maxZ] = blockRange(box.minZ, box.maxZ);
  const hits: Array<[number, number, number]> = [];
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (world.isSolid(x, y, z)) {
          hits.push([x, y, z]);
        }
      }
    }
  }
  return hits;
}

/** Clamp a fall speed to the terminal velocity. */
export function clampVelocity(velocity: Vec3): Vec3 {
  return {
    x: velocity.x,
    y: Math.max(velocity.y, -TERMINAL_VELOCITY),
    z: velocity.z,
  };
}

/**
 * Move a body by `delta`, resolving collisions against the world.
 *
 * Each axis is moved in turn. A blocked axis snaps to the surface it hit:
 * a body sliding into a wall ends up flush against it, and a body landing on
 * a block ends up exactly on top of it. The velocity of a blocked axis is
 * zeroed.
 */
export function moveWithCollisions(
  position: Vec3,
  velocity: Vec3,
  delta: Vec3,
  world: SolidWorld,
  halfWidth = PLAYER_HALF_WIDTH,
  height = PLAYER_HEIGHT,
): MoveResult {
  // A single sample of the body's box cannot see a thin obstacle it passed
  // entirely between two positions, so a fast body would tunnel through the
  // floor. Splitting a long move into steps shorter than the smallest block
  // means every obstacle is sampled.
  const longest = Math.max(Math.abs(delta.x), Math.abs(delta.y), Math.abs(delta.z));
  const steps = Math.max(1, Math.ceil(longest / MAX_MOVE_STEP));
  if (steps === 1) {
    return moveOnce(position, velocity, delta, world, halfWidth, height);
  }
  const step = { x: delta.x / steps, y: delta.y / steps, z: delta.z / steps };
  let at = position;
  let vel = velocity;
  let onGround = false;
  let collided = false;
  for (let i = 0; i < steps; i++) {
    const result = moveOnce(at, vel, step, world, halfWidth, height);
    at = result.position;
    vel = result.velocity;
    onGround = onGround || result.onGround;
    collided = collided || result.collided;
  }
  return { position: at, velocity: vel, onGround, collided };
}

/**
 * True when the body is standing on something.
 *
 * Probed with a thin box just under the feet, so a body that is exactly on a
 * block top counts as grounded and a body in mid-air does not.
 */
function groundedAt(
  feet: Vec3,
  world: SolidWorld,
  halfWidth: number,
  height: number,
): boolean {
  const probe = bodyAabb({ x: feet.x, y: feet.y - 0.05, z: feet.z }, halfWidth, height);
  return collides(probe, world);
}

/**
 * The feet height the body would stand at after walking up onto a ledge, or
 * null when it cannot step up.
 *
 * The rules, in order:
 *   - not while rising: stepping up during a jump is climbing a wall
 *   - only from the ground: in mid-air this would be wall-climbing
 *   - there must be room for the body where it would land
 *   - there must be a ledge top within STEP_HEIGHT of the feet, in the
 *     columns the body would occupy
 */
function stepUpY(
  feet: Vec3,
  target: Vec3,
  deltaY: number,
  world: SolidWorld,
  halfWidth: number,
  height: number,
): number | null {
  if (deltaY > 0) return null;
  if (!groundedAt(feet, world, halfWidth, height)) return null;

  const raisedY = feet.y + STEP_HEIGHT;
  if (collides(bodyAabb({ x: target.x, y: raisedY, z: target.z }, halfWidth, height), world)) {
    return null;
  }

  const [minX, maxX] = blockRange(target.x - halfWidth, target.x + halfWidth);
  const [minZ, maxZ] = blockRange(target.z - halfWidth, target.z + halfWidth);
  const top = Math.floor(raisedY);
  const bottom = Math.floor(feet.y) + 1;

  for (let y = top; y >= bottom; y--) {
    let solidBelow = false;
    let clearAbove = true;
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (world.isSolid(x, y - 1, z)) solidBelow = true;
        if (world.isSolid(x, y, z)) clearAbove = false;
      }
    }
    if (solidBelow && clearAbove) {
      if (!collides(bodyAabb({ x: target.x, y, z: target.z }, halfWidth, height), world)) {
        return y;
      }
      return null;
    }
  }
  return null;
}

/** One collision-resolved move, with no sub-stepping. */
function moveOnce(
  position: Vec3,
  velocity: Vec3,
  delta: Vec3,
  world: SolidWorld,
  halfWidth: number,
  height: number,
): MoveResult {
  let x = position.x;
  let y = position.y;
  let z = position.z;
  let vx = velocity.x;
  let vy = velocity.y;
  let vz = velocity.z;
  let onGround = false;
  let collided = false;

  // X axis.
  if (delta.x !== 0) {
    const candidate = bodyAabb({ x: x + delta.x, y, z }, halfWidth, height);
    const hits = overlappingBlocks(candidate, world);
    if (hits.length > 0) {
      // A low ledge should be walked up, not walked into. Without this the
      // player is stopped by every single block of terrain and has to jump
      // to climb anything.
      const steppedY = stepUpY({ x, y, z }, { x: x + delta.x, y, z }, delta.y, world, halfWidth, height);
      if (steppedY !== null) {
        x = x + delta.x;
        y = steppedY;
      } else {
        collided = true;
        vx = 0;
        // Stop flush against the nearest face along X.
        if (delta.x > 0) {
          x = Math.min(...hits.map(([bx]) => bx)) - halfWidth;
        } else {
          x = Math.max(...hits.map(([bx]) => bx + 1)) + halfWidth;
        }
      }
    } else {
      x = candidate.minX + halfWidth;
    }
  }

  // Y axis.
  if (delta.y !== 0) {
    const candidate = bodyAabb({ x, y: y + delta.y, z }, halfWidth, height);
    const hits = overlappingBlocks(candidate, world);
    if (hits.length > 0) {
      collided = true;
      if (delta.y < 0) {
        onGround = true;
        // Land exactly on top of the highest block that was hit.
        y = Math.max(...hits.map(([, by]) => by + 1));
      } else {
        // Stop with the head exactly under the lowest block that was hit.
        y = Math.min(...hits.map(([, by]) => by)) - height;
      }
      vy = 0;
    } else {
      y = candidate.minY;
    }
  }

  // Z axis.
  if (delta.z !== 0) {
    const candidate = bodyAabb({ x, y, z: z + delta.z }, halfWidth, height);
    const hits = overlappingBlocks(candidate, world);
    if (hits.length > 0) {
      const steppedY = stepUpY({ x, y, z }, { x, y, z: z + delta.z }, delta.y, world, halfWidth, height);
      if (steppedY !== null) {
        z = z + delta.z;
        y = steppedY;
      } else {
        collided = true;
        vz = 0;
        if (delta.z > 0) {
          z = Math.min(...hits.map(([, , bz]) => bz)) - halfWidth;
        } else {
          z = Math.max(...hits.map(([, , bz]) => bz + 1)) + halfWidth;
        }
      }
    } else {
      z = candidate.minZ + halfWidth;
    }
  }

  return {
    position: { x, y, z },
    velocity: { x: vx, y: vy, z: vz },
    onGround,
    collided,
  };
}

/**
 * Advance a body by one timestep: apply gravity, then move and resolve.
 *
 * `dt` is in seconds. Terminal velocity caps the fall.
 */
export function stepPhysics(
  position: Vec3,
  velocity: Vec3,
  dt: number,
  world: SolidWorld,
  halfWidth = PLAYER_HALF_WIDTH,
  height = PLAYER_HEIGHT,
): MoveResult {
  const accelerated = clampVelocity({
    x: velocity.x,
    y: velocity.y - GRAVITY * dt,
    z: velocity.z,
  });
  return moveWithCollisions(
    position,
    accelerated,
    { x: accelerated.x * dt, y: accelerated.y * dt, z: accelerated.z * dt },
    world,
    halfWidth,
    height,
  );
}

/**
 * A world backed by a plain map of solid coordinates. Useful for tests and
 * for the engine's own collision queries.
 */
export function solidWorldFromBlocks(
  blocks: Iterable<readonly [number, number, number]>,
): SolidWorld {
  const set = new Set<string>();
  for (const [x, y, z] of blocks) {
    set.add(`${x},${y},${z}`);
  }
  return {
    isSolid(x, y, z) {
      return set.has(`${x},${y},${z}`);
    },
  };
}

/** True when the given block id collides with bodies. */
export function isSolidBlock(id: string): boolean {
  return SOLID_BLOCKS.has(id as never);
}