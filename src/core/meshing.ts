/**
 * BlockForge — greedy mesher.
 *
 * OWNERSHIP: ENGINE.
 *
 * Greedy meshing merges coplanar faces of the same block into the largest
 * possible quad, which cuts the triangle count of a typical chunk by an order
 * of magnitude compared to per-face quads.
 *
 * DETERMINISM: the output is a pure function of the padded block volume.
 * Faces are emitted in a fixed order — section, then face direction, then
 * slice, then position inside the slice — so the same input always produces
 * byte-identical arrays, in any process.
 *
 * The padded volume is the chunk plus a one-block margin on every side. The
 * margin is what makes the border faces of a chunk correct: a face is only
 * drawn when the neighbour on the other side lets it through.
 *
 * CONVENTIONS
 * -----------
 * - `positions` are local to what was meshed: x and z run 0..16, and y runs
 *   0..16 for a section mesh and 0..256 for a whole-chunk mesh.
 * - `normals` are unit axis vectors, one per vertex.
 * - `uvs` run 0..width and 0..height in block units, so a merged quad of
 *   4x3 blocks gets a 4x3 texture. The renderer must wrap textures.
 * - `blocks` hold the ORDINAL of the face's BlockId, one entry per triangle,
 *   parallel to `indices` — the same ordinal the chunk storage uses.
 */
import type { BlockId, Chunk, MeshOutput } from "./types.js";
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  SECTION_HEIGHT,
  SECTIONS_PER_CHUNK,
} from "./constants.js";
import { blockFromOrdinal, shouldRenderFace } from "./world.js";
import type { ChunkNeighbours } from "./world.js";

/** Padded extent along X and Z (16 plus a one-block margin each side). */
const PX = CHUNK_SIZE_X + 2;
const PZ = CHUNK_SIZE_Z + 2;

/** Air's ordinal — air has no faces. */
const AIR = 0;

/**
 * A face direction.
 *
 * `axis` is the axis the face is perpendicular to, `sign` its direction. The
 * two remaining axes carry the texture: `uAxis` runs along the texture's
 * horizontal axis and `vAxis` along its vertical axis, with `uSign` and
 * `vSign` saying which way the texture grows. The signs are what let a
 * texture wrap the right way round on every one of the six faces.
 */
interface FaceDirection {
  readonly axis: 0 | 1 | 2;
  readonly sign: 1 | -1;
  readonly uAxis: 0 | 1 | 2;
  readonly vAxis: 0 | 1 | 2;
  readonly uSign: 1 | -1;
  readonly vSign: 1 | -1;
}

/**
 * The six face directions.
 *
 * Texture axes follow what a viewer expects: looking at a face from outside,
 * the texture's horizontal axis points to the viewer's right and the
 * vertical axis points up.
 */
const FACE_DIRECTIONS: readonly FaceDirection[] = [
  // +X: viewer looks along -X, so texture right is -Z and texture up is +Y.
  { axis: 0, sign: 1, uAxis: 2, vAxis: 1, uSign: -1, vSign: 1 },
  // -X: viewer looks along +X, so texture right is +Z and texture up is +Y.
  { axis: 0, sign: -1, uAxis: 2, vAxis: 1, uSign: 1, vSign: 1 },
  // +Y (top): looking down, texture right is +X and texture up is -Z.
  { axis: 1, sign: 1, uAxis: 0, vAxis: 2, uSign: 1, vSign: -1 },
  // -Y (bottom): looking up, texture right is +X and texture up is +Z.
  { axis: 1, sign: -1, uAxis: 0, vAxis: 2, uSign: 1, vSign: 1 },
  // +Z: viewer looks along -Z, so texture right is +X and texture up is +Y.
  { axis: 2, sign: 1, uAxis: 0, vAxis: 1, uSign: 1, vSign: 1 },
  // -Z: viewer looks along +Z, so texture right is -X and texture up is +Y.
  { axis: 2, sign: -1, uAxis: 0, vAxis: 1, uSign: -1, vSign: 1 },
];

/** Cross product of two axis-aligned unit vectors. */
function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Unit vector along an axis, with a sign. */
function axisVector(
  axis: 0 | 1 | 2,
  sign: 1 | -1,
): readonly [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  out[axis] = sign;
  return out;
}

/**
 * Does the quad wound counter-clockwise around `u` x `v` face the normal?
 *
 * The quad's corners are laid out along the positive `uAxis` and `vAxis`
 * directions, so its geometric normal is `uAxis` x `vAxis`. The wanted
 * normal is `sign` along `axis`. When they disagree the triangle winding
 * has to be reversed, otherwise the face would be back-facing.
 */
function needsFlip(direction: FaceDirection): boolean {
  const geometric = cross(
    axisVector(direction.uAxis, 1),
    axisVector(direction.vAxis, 1),
  );
  const wanted = axisVector(direction.axis, direction.sign);
  return (
    geometric[0] * wanted[0] +
      geometric[1] * wanted[1] +
      geometric[2] * wanted[2] <
    0
  );
}

/** Precomputed winding decision per face direction. */
const FLIP: readonly boolean[] = FACE_DIRECTIONS.map(needsFlip);

/**
 * Index into the padded volume. Layout is x-fastest, then z, then y — the
 * same order the chunk itself uses, so filling the margin is a straight copy.
 */
function paddedIndex(x: number, y: number, z: number): number {
  return (x + 1) + PX * ((z + 1) + PZ * (y + 1));
}

/**
 * Build the padded volume for one 16-tall section of a chunk.
 *
 * @param chunk       the chunk being meshed
 * @param y0          first chunk-local Y covered by the section
 * @param neighbours  the four horizontal neighbours
 */
function buildPadded(
  chunk: Chunk,
  y0: number,
  neighbours: ChunkNeighbours,
): Uint8Array {
  const padded = new Uint8Array(PX * (SECTION_HEIGHT + 2) * PZ);
  const { west, east, north, south } = neighbours;
  const layer = CHUNK_SIZE_X * CHUNK_SIZE_Z;

  for (let y = 0; y < SECTION_HEIGHT; y++) {
    const worldY = y0 + y;
    const chunkBase = worldY * layer;
    // Interior: the chunk's own blocks.
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      const from = chunkBase + z * CHUNK_SIZE_X;
      const to = paddedIndex(0, y, z);
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        padded[to + x] = chunk.blocks[from + x] ?? AIR;
      }
    }
    // The four side margins, taken from the neighbouring chunks.
    if (west) {
      for (let z = 0; z < CHUNK_SIZE_Z; z++) {
        padded[paddedIndex(-1, y, z)] =
          west.blocks[chunkBase + z * CHUNK_SIZE_X + (CHUNK_SIZE_X - 1)] ?? AIR;
      }
    }
    if (east) {
      for (let z = 0; z < CHUNK_SIZE_Z; z++) {
        padded[paddedIndex(CHUNK_SIZE_X, y, z)] =
          east.blocks[chunkBase + z * CHUNK_SIZE_X] ?? AIR;
      }
    }
    if (north) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        padded[paddedIndex(x, y, -1)] =
          north.blocks[chunkBase + (CHUNK_SIZE_Z - 1) * CHUNK_SIZE_X + x] ?? AIR;
      }
    }
    if (south) {
      for (let x = 0; x < CHUNK_SIZE_X; x++) {
        padded[paddedIndex(x, y, CHUNK_SIZE_Z)] =
          south.blocks[chunkBase + x] ?? AIR;
      }
    }
  }

  // The vertical margins come from the same chunk, one section up or down.
  // Only the interior columns are needed: the face tests read the vertical
  // margin at interior x/z only (the side margins are read at interior y).
  for (let z = 0; z < CHUNK_SIZE_Z; z++) {
    for (let x = 0; x < CHUNK_SIZE_X; x++) {
      const below = y0 - 1;
      padded[paddedIndex(x, -1, z)] =
        below >= 0 && below < CHUNK_SIZE_Y
          ? chunk.blocks[below * layer + z * CHUNK_SIZE_X + x] ?? AIR
          : AIR;
      const above = y0 + SECTION_HEIGHT;
      padded[paddedIndex(x, SECTION_HEIGHT, z)] =
        above >= 0 && above < CHUNK_SIZE_Y
          ? chunk.blocks[above * layer + z * CHUNK_SIZE_X + x] ?? AIR
          : AIR;
    }
  }

  return padded;
}

/** Accumulates mesh output. Plain arrays, converted to typed arrays at the end. */
class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];
  readonly blocks: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  build(): MeshOutput {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      indices: new Uint32Array(this.indices),
      blocks: new Uint8Array(this.blocks),
    };
  }
}

/**
 * Greedy-mesh one padded section.
 *
 * @param padded  the padded block volume
 * @param y0      chunk-local Y of the section's first layer
 * @param builder where the result is written
 */
function meshPadded(padded: Uint8Array, y0: number, builder: MeshBuilder): void {
  // Stride of each axis inside the padded volume. The volume's origin is at
  // padded index 1 on every axis, so the base offset is added once and the
  // strides alone address the rest.
  const stride: readonly [number, number, number] = [1, PX * PZ, PX];
  const base = 1 + PX + PX * PZ;
  const dim: readonly [number, number, number] = [
    CHUNK_SIZE_X,
    SECTION_HEIGHT,
    CHUNK_SIZE_Z,
  ];
  // The mask holds the block ordinal of a visible face, or -1 for "no face".
  const mask = new Int32Array(CHUNK_SIZE_X * SECTION_HEIGHT);

  for (let f = 0; f < 6; f++) {
    const direction = FACE_DIRECTIONS[f] as FaceDirection;
    const { axis, sign, uAxis, vAxis } = direction;
    const axisStride = stride[axis];
    const uStride = stride[uAxis];
    const vStride = stride[vAxis];
    const uDim = dim[uAxis];
    const vDim = dim[vAxis];
    const flip = FLIP[f] as boolean;

    const normal = axisVector(axis, sign);
    // The quad's geometry always runs along the positive axes; the texture
    // signs are applied to the UVs below.
    const uVec = axisVector(uAxis, 1);
    const vVec = axisVector(vAxis, 1);

    for (let slice = 0; slice < dim[axis]; slice++) {
      // 1. Build the mask of visible faces for this slice. The index walks
      // the padded volume directly — no coordinate object per cell.
      const sliceBase = base + slice * axisStride;
      for (let v = 0; v < vDim; v++) {
        const rowBase = sliceBase + v * vStride;
        let selfIndex = rowBase;
        for (let u = 0; u < uDim; u++) {
          const self = padded[selfIndex] ?? AIR;
          const neighbour = padded[selfIndex + sign * axisStride] ?? AIR;
          mask[v * uDim + u] = shouldRenderFace(self, neighbour) ? self : -1;
          selfIndex += uStride;
        }
      }

      // 2. Merge the mask into the largest possible quads.
      for (let v = 0; v < vDim; v++) {
        for (let u = 0; u < uDim; u++) {
          const block = mask[v * uDim + u] as number;
          if (block < 0) {
            continue;
          }
          let width = 1;
          while (u + width < uDim && mask[v * uDim + (u + width)] === block) {
            width++;
          }
          let quadHeight = 1;
          let grow = true;
          while (grow && v + quadHeight < vDim) {
            for (let i = 0; i < width; i++) {
              if (mask[(v + quadHeight) * uDim + u + i] !== block) {
                grow = false;
                break;
              }
            }
            if (grow) {
              quadHeight++;
            }
          }

          // 3. Emit the quad.
          //
          // The quad always spans the positive `uAxis` and `vAxis`
          // directions from its base corner — that is the region the mask
          // merge covered. The texture signs only affect the UVs, so the
          // texture grows the right way round on each face without moving
          // the geometry.
          const plane = sign > 0 ? slice + 1 : slice;
          const base: [number, number, number] = [0, 0, 0];
          base[axis] = plane;
          base[uAxis] = u;
          base[vAxis] = v;

          const c0: [number, number, number] = [base[0], base[1] + y0, base[2]];
          const c1: [number, number, number] = [
            base[0] + uVec[0] * width,
            base[1] + uVec[1] * width + y0,
            base[2] + uVec[2] * width,
          ];
          const c2: [number, number, number] = [
            base[0] + uVec[0] * width + vVec[0] * quadHeight,
            base[1] + uVec[1] * width + vVec[1] * quadHeight + y0,
            base[2] + uVec[2] * width + vVec[2] * quadHeight,
          ];
          const c3: [number, number, number] = [
            base[0] + vVec[0] * quadHeight,
            base[1] + vVec[1] * quadHeight + y0,
            base[2] + vVec[2] * quadHeight,
          ];
          const first = builder.vertexCount;

          for (const c of [c0, c1, c2, c3]) {
            builder.positions.push(c[0], c[1], c[2]);
            builder.normals.push(normal[0], normal[1], normal[2]);
          }
          // UVs run 0..width along the texture's horizontal axis and
          // 0..quadHeight along its vertical axis, so a merged quad of
          // 4x3 blocks gets a 4x3 texture. The sign of each axis decides
          // which corner the texture starts at.
          const u0 = direction.uSign > 0 ? 0 : width;
          const u1 = direction.uSign > 0 ? width : 0;
          const v0 = direction.vSign > 0 ? 0 : quadHeight;
          const v1 = direction.vSign > 0 ? quadHeight : 0;
          builder.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);

          if (flip) {
            builder.indices.push(
              first,
              first + 2,
              first + 1,
              first,
              first + 3,
              first + 2,
            );
          } else {
            builder.indices.push(
              first,
              first + 1,
              first + 2,
              first,
              first + 2,
              first + 3,
            );
          }
          // One entry per triangle, parallel to `indices`.
          builder.blocks.push(block, block);

          // 4. Consume the merged region.
          for (let dv = 0; dv < quadHeight; dv++) {
            for (let du = 0; du < width; du++) {
              mask[(v + dv) * uDim + u + du] = -1;
            }
          }

          u += width - 1;
        }
      }
    }
  }
}

/**
 * Mesh one 16-tall section of a chunk.
 *
 * Positions are LOCAL to the section: x and z run 0..16 and y runs 0..16, so
 * a section mesh can be placed at (section * SECTION_HEIGHT) without any
 * further offset. The renderer adds that offset when it uploads the section.
 */
export function meshSection(
  chunk: Chunk,
  section: number,
  neighbours: ChunkNeighbours = {},
): MeshOutput {
  const y0 = section * SECTION_HEIGHT;
  const padded = buildPadded(chunk, y0, neighbours);
  const builder = new MeshBuilder();
  meshPadded(padded, 0, builder);
  return builder.build();
}

/**
 * Mesh every section of a chunk into one buffer.
 *
 * The sections are emitted in ascending order, so the result is a
 * deterministic function of the chunk and its neighbours.
 */
export function meshChunk(
  chunk: Chunk,
  neighbours: ChunkNeighbours = {},
): MeshOutput {
  const builder = new MeshBuilder();
  for (let section = 0; section < SECTIONS_PER_CHUNK; section++) {
    const y0 = section * SECTION_HEIGHT;
    const padded = buildPadded(chunk, y0, neighbours);
    meshPadded(padded, y0, builder);
  }
  return builder.build();
}

/** The block id a mesh triangle belongs to, from its ordinal. */
export function meshTriangleBlock(
  output: MeshOutput,
  triangle: number,
): BlockId {
  const ordinal = output.blocks[triangle] ?? AIR;
  return blockFromOrdinal(ordinal);
}