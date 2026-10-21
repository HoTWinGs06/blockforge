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

/**
 * How deep the ground probe reaches below the feet, in blocks.
 *
 * The probe is a thin slab, not the body: it answers "is there something to
 * stand on underfoot", and nothing else.
 */
const GROUND_PROBE = 0.05;

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
 * Probed with a thin slab just under the feet - not with the whole body.
 * The probe answers one question, "is there ground underfoot", and a body
 * whose head is inside a block is NOT standing on that block.
 */
function groundedAt(feet: Vec3, world: SolidWorld, halfWidth: number): boolean {
  const probe = bodyAabb(
    { x: feet.x, y: feet.y - GROUND_PROBE, z: feet.z },
    halfWidth,
    GROUND_PROBE,
  );
  return collides(probe, world);
}

/**
 * The feet height the body would stand at after walking up onto a ledge, or
 * null when it cannot step up.
 *
 * The rules, in order:
 *   - not while rising: stepping up during a jump is climbing a wall
 *   - only from the ground: in mid-air this would be wall-climbing
 *   - the move has budget left: one move raises the body at most
 *     STEP_HEIGHT, no matter how many axes step up
 *   - there must be room for the body where it would land
 *   - there must be a ledge top within STEP_HEIGHT of the feet, in the
 *     columns the body would occupy
 */
function stepUpY(
  feet: Vec3,
  target: Vec3,
  deltaY: number,
  rising: boolean,
  world: SolidWorld,
  halfWidth: number,
  height: number,
  maxY: number,
): number | null {
  if (deltaY > 0) return null;
  if (rising) return null;
  if (!groundedAt(feet, world, halfWidth)) return null;

  // The budget is per MOVE, not per axis: a body that steps up on X and
  // then on Z would otherwise climb two blocks in a single move, which is
  // the wall-climb this is supposed to prevent.
  const raisedY = Math.min(feet.y + STEP_HEIGHT, maxY);
  if (raisedY <= feet.y) return null;
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

  // The rise budget for this move. One move raises the body at most
  // STEP_HEIGHT, however many axes step up, so a body cannot climb two
  // blocks by moving diagonally into a corner of them.
  const maxY = position.y + STEP_HEIGHT;
  // A body that is moving upward is jumping, and a jumping body does not
  // step up: that is how a wall becomes climbable.
  const rising = velocity.y > 0;

  // X axis.
  if (delta.x !== 0) {
    const candidate = bodyAabb({ x: x + delta.x, y, z }, halfWidth, height);
    const hits = overlappingBlocks(candidate, world);
    if (hits.length > 0) {
      // A low ledge should be walked up, not walked into. Without this the
      // player is stopped by every single block of terrain and has to jump
      // to climb anything.
      const steppedY = stepUpY(
        { x, y, z },
        { x: x + delta.x, y, z },
        delta.y,
        rising,
        world,
        halfWidth,
        height,
        maxY,
      );
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
      const steppedY = stepUpY(
        { x, y, z },
        { x, y, z: z + delta.z },
        delta.y,
        rising,
        world,
        halfWidth,
        height,
        maxY,
      );
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
 * Ticks of grace after the body leaves the ground during which a jump still
 * works.
 *
 * Six ticks is about a tenth of a second at 60 ticks a second: long enough
 * that a press which is a fraction of a second late still jumps, short
 * enough that the player cannot float on the edge of a ledge.
 */
export const COYOTE_TICKS = 6;

/**
 * Ticks a jump press is remembered while the body is still in the air.
 *
 * This is the other half of the same forgiveness: a press which is a
 * fraction of a second early is not thrown away, it waits for the landing.
 */
export const JUMP_BUFFER_TICKS = 6;

/**
 * The player's jump state, carried from tick to tick.
 *
 * It is the whole of the player's own input history that the assist needs:
 * how much grace is left, how long a remembered press lasts, and whether
 * the key was already down.
 */
export interface JumpState {
  /** Ticks of coyote grace left at the start of this tick. */
  readonly coyoteTicks: number;
  /** Ticks of patience left on a remembered press, at the start of this tick. */
  readonly bufferTicks: number;
  /** True when the jump key was already down on the previous tick. */
  readonly heldLastTick: boolean;
}

/**
 * What the player did on this tick.
 */
export interface JumpInput {
  /** True while the jump key is down. */
  readonly jumpHeld: boolean;
  /** True when the body was standing on solid ground at the end of the last tick. */
  readonly onGround: boolean;
}

/**
 * The result of one tick of the jump assist.
 */
export interface JumpResult {
  /** The state to carry into the next tick. */
  readonly state: JumpState;
  /** True when the player should jump on this tick. */
  readonly jumped: boolean;
}

/**
 * The state of a player who has not jumped yet.
 */
export function createJumpState(): JumpState {
  return { coyoteTicks: 0, bufferTicks: 0, heldLastTick: false };
}

/**
 * Advance the jump assist by one tick and say whether to jump.
 *
 * The assist only decides WHEN. The caller applies the jump velocity.
 *
 * The rules, in order:
 *   - a press while the body is on the ground, or within COYOTE_TICKS of
 *     leaving it, jumps at once
 *   - a press earlier than that is remembered and fires on the landing
 *   - a held key is not a new press: only the rising edge counts, so
 *     holding the key does not bounce the player
 *
 * Pure: the result is a function of the state and the input alone. No
 * clock is read, so the same inputs always give the same jump.
 */
export function stepJumpAssist(state: JumpState, input: JumpInput): JumpResult {
  // The RISING EDGE of the key. The edge is derived from the history the
  // state carries, so a caller cannot get it wrong by passing the key state
  // where a press was meant.
  const pressed = input.jumpHeld && !state.heldLastTick;

  // The grace available RIGHT NOW: on the ground, or still within the
  // window left over from the last time the body was on the ground.
  const grace = input.onGround ? COYOTE_TICKS : state.coyoteTicks;

  let jumped = false;
  // A press spends the grace, so a jump cannot be followed by a coyote jump
  // out of the same landing.
  let nextCoyote = input.onGround ? COYOTE_TICKS : Math.max(0, state.coyoteTicks - 1);
  let nextBuffer = state.bufferTicks > 0 ? state.bufferTicks - 1 : 0;

  if (pressed) {
    if (grace > 0) {
      // Grounded, or just left the ground: the jump fires now.
      jumped = true;
      nextCoyote = 0;
      nextBuffer = 0;
    } else {
      // Too early. The body is in the air and out of grace, so the press
      // is remembered and fires when the body lands.
      nextBuffer = JUMP_BUFFER_TICKS;
    }
  }

  // A remembered press fires the moment the body touches down.
  if (!jumped && state.bufferTicks > 0 && input.onGround) {
    jumped = true;
    nextBuffer = 0;
    nextCoyote = 0;
  }

  return {
    state: { coyoteTicks: nextCoyote, bufferTicks: nextBuffer, heldLastTick: input.jumpHeld },
    jumped,
  };
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