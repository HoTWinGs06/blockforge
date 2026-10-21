/**
 * BlockForge — voxel raycasting (DDA).
 *
 * OWNERSHIP: ENGINE.
 *
 * Amanatides & Woo's grid traversal: the ray visits every voxel it crosses,
 * in order, without testing a whole line of candidates. Pure — the caller
 * supplies the block lookup and gets back the first hit.
 */
import type { BlockId, Vec3 } from "./types.js";

/** A world query for raycasting. */
export interface RaycastWorld {
  /** The block id at the given integer coordinates. */
  blockAt(x: number, y: number, z: number): BlockId;
}

/** What a ray hit. */
export interface RaycastHit {
  /** Coordinates of the block that was hit. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The block that was hit. */
  readonly block: BlockId;
  /** Distance from the ray origin to the hit, in blocks. */
  readonly distance: number;
  /** The face of the hit block that the ray entered through. */
  readonly normal: Vec3;
  /** The point of entry, on the surface of the hit block. */
  readonly point: Vec3;
}

/** A ray: an origin and a direction. The direction need not be normalised. */
export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/**
 * Cast a ray through the world and return the first solid block it enters.
 *
 * `maxDistance` bounds the search in blocks. Returns null when the ray
 * escapes without hitting anything.
 */
export function raycast(
  ray: Ray,
  world: RaycastWorld,
  maxDistance: number,
  isTarget: (block: BlockId) => boolean,
): RaycastHit | null {
  const { origin, direction } = ray;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length === 0 || maxDistance <= 0) {
    return null;
  }
  const dx = direction.x / length;
  const dy = direction.y / length;
  const dz = direction.z / length;

  // The voxel the ray starts in, and the exact point of entry.
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  // Step direction per axis: -1, 0 or +1.
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  // Distance along the ray to the next voxel boundary on each axis.
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
  const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);

  let tMaxX =
    stepX === 0
      ? Infinity
      : stepX > 0
        ? (x + 1 - origin.x) / dx
        : (x - origin.x) / dx;
  let tMaxY =
    stepY === 0
      ? Infinity
      : stepY > 0
        ? (y + 1 - origin.y) / dy
        : (y - origin.y) / dy;
  let tMaxZ =
    stepZ === 0
      ? Infinity
      : stepZ > 0
        ? (z + 1 - origin.z) / dz
        : (z - origin.z) / dz;

  // The face the ray entered through, per axis.
  let normalX = 0;
  let normalY = 0;
  let normalZ = 0;

  let distance = 0;
  // The bound is generous: a ray can cross at most one voxel per unit of
  // distance on each axis.
  const maxSteps = Math.ceil(maxDistance * 3) + 3;

  for (let step = 0; step <= maxSteps; step++) {
    if (distance > maxDistance) {
      return null;
    }
    const block = world.blockAt(x, y, z);
    if (isTarget(block)) {
      return {
        x,
        y,
        z,
        block,
        distance,
        normal: { x: normalX, y: normalY, z: normalZ },
        point: {
          x: origin.x + dx * distance,
          y: origin.y + dy * distance,
          z: origin.z + dz * distance,
        },
      };
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      distance = tMaxX;
      tMaxX += tDeltaX;
      normalX = -stepX;
      normalY = 0;
      normalZ = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      distance = tMaxY;
      tMaxY += tDeltaY;
      normalX = 0;
      normalY = -stepY;
      normalZ = 0;
    } else {
      z += stepZ;
      distance = tMaxZ;
      tMaxZ += tDeltaZ;
      normalX = 0;
      normalY = 0;
      normalZ = -stepZ;
    }
  }

  return null;
}

/**
 * Where a block placed against `hit` would go: the empty cell next to the
 * hit block, on the face the ray came in through.
 */
export function placementCell(hit: RaycastHit): { x: number; y: number; z: number } {
  return {
    x: hit.x + hit.normal.x,
    y: hit.y + hit.normal.y,
    z: hit.z + hit.normal.z,
  };
}