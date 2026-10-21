/**
 * BlockForge — PRIORITY 3: Greedy Meshing Invariant Specification.
 *
 * OWNERSHIP: TEST AUTHOR (tests/).
 *
 * The mesher turns a chunk of blocks into triangles. The renderer draws
 * them, and nothing else in the project checks them, so the properties
 * below are the only thing standing between a bad mesh and a broken game:
 *
 *   1. the vertex order is STABLE — the same chunk and the same
 *      neighbours give byte-identical arrays, every time;
 *   2. `blocks` holds exactly one entry per triangle, parallel to
 *      `indices`, so the renderer can pick a texture without a reverse
 *      lookup;
 *   3. air never has a face, and a face between two blocks of the same
 *      kind is culled;
 *   4. no face is drawn ACROSS a section boundary — a block at the top
 *      of one section and the block above it belong to the same solid
 *      body and must not show a seam;
 *   5. the neighbour margin works: a chunk meshed next to a solid
 *      neighbour must not draw the face that the neighbour hides.
 */
import { describe, it, expect } from "vitest";
import { meshChunk, meshSection, meshTriangleBlock } from "../src/core/meshing.js";
import { BlockId, type Chunk, type MeshOutput } from "../src/core/types.js";
import { CHUNK_VOLUME, SECTION_HEIGHT, blockIndex } from "../src/core/constants.js";

/** An empty chunk at the origin. */
function emptyChunk(): Chunk {
  return { key: { cx: 0, cz: 0 }, blocks: new Uint8Array(CHUNK_VOLUME) };
}

/** The ordinal of a block id. */
const ORD = {
  slate: 2,
  rubble: 3,
  regolith: 4,
  loam: 5,
} as const;

/** The number of triangles in a mesh. */
const triangles = (mesh: MeshOutput): number => mesh.indices.length / 3;

/** True when two meshes are byte-identical. */
function sameMesh(a: MeshOutput, b: MeshOutput): boolean {
  return (
    Buffer.from(a.positions.buffer).equals(Buffer.from(b.positions.buffer)) &&
    Buffer.from(a.normals.buffer).equals(Buffer.from(b.normals.buffer)) &&
    Buffer.from(a.uvs.buffer).equals(Buffer.from(b.uvs.buffer)) &&
    Buffer.from(a.indices.buffer).equals(Buffer.from(b.indices.buffer)) &&
    Buffer.from(a.blocks.buffer).equals(Buffer.from(b.blocks.buffer))
  );
}

describe("PRIORITY 3: Greedy Meshing Invariant Specification", () => {
  it("MeshOutput structure strictly adheres to contract", () => {
    const chunk = emptyChunk();
    const mesh: MeshOutput = meshSection(chunk, 0);

    expect(mesh.positions).toBeInstanceOf(Float32Array);
    expect(mesh.normals).toBeInstanceOf(Float32Array);
    expect(mesh.uvs).toBeInstanceOf(Float32Array);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
    expect(mesh.blocks).toBeInstanceOf(Uint8Array);

    expect(mesh.positions.length).toBe(0);
    expect(mesh.indices.length).toBe(0);
    expect(mesh.blocks.length).toBe(0);
  });

  it("never emits a face for an air block", () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };
    const mesh: MeshOutput = meshSection(chunk, 0);

    for (let i = 0; i < mesh.blocks.length; i++) {
      expect(mesh.blocks[i]).not.toBe(BlockId.Air);
    }
  });

  it("never emits vertex positions outside section vertical boundaries", () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks[blockIndex(5, 5, 5)] = ORD.slate;
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };
    const mesh: MeshOutput = meshSection(chunk, 0);

    for (let i = 1; i < mesh.positions.length; i += 3) {
      const y = mesh.positions[i];
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(SECTION_HEIGHT);
    }
  });

  it("mesher output is byte-identical across repeated runs for identical inputs", () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        blocks[blockIndex(x, 0, z)] = ORD.slate;
      }
    }
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };

    const mesh1: MeshOutput = meshSection(chunk, 0);
    const mesh2: MeshOutput = meshSection(chunk, 0);

    expect(sameMesh(mesh1, mesh2)).toBe(true);
  });

  it("emits exactly one blocks entry per triangle", () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks[blockIndex(2, 2, 2)] = ORD.slate;
    blocks[blockIndex(9, 4, 7)] = ORD.loam;
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };

    for (const mesh of [meshSection(chunk, 0), meshChunk(chunk)]) {
      expect(mesh.blocks.length).toBe(triangles(mesh));
      expect(mesh.indices.length).toBe(triangles(mesh) * 3);
      // Each quad contributes 4 vertices and 2 triangles, so there are
      // 2 vertices per triangle.
      expect(mesh.positions.length).toBe(triangles(mesh) * 2 * 3);
      expect(mesh.normals.length).toBe(triangles(mesh) * 2 * 3);
      expect(mesh.uvs.length).toBe(triangles(mesh) * 2 * 2);
    }
  });

  it("meshChunk is byte-identical across repeated runs", () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        blocks[blockIndex(x, 3, z)] = ORD.rubble;
      }
    }
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };
    expect(sameMesh(meshChunk(chunk), meshChunk(chunk))).toBe(true);
  });

  it("meshChunk covers the whole chunk height", () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks[blockIndex(1, 200, 1)] = ORD.slate;
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };
    const mesh = meshChunk(chunk);
    // A block near the top of the chunk must still be meshed.
    let maxY = 0;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      const y = mesh.positions[i] as number;
      if (y > maxY) maxY = y;
    }
    expect(maxY).toBeGreaterThan(200);
  });

  it("meshTriangleBlock names the block a triangle belongs to", () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks[blockIndex(3, 3, 3)] = ORD.loam;
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };
    const mesh = meshSection(chunk, 0);
    expect(meshTriangleBlock(mesh, 0)).toBe(BlockId.Loam);
  });

  it("meshTriangleBlock returns air for a triangle that does not exist", () => {
    const chunk = emptyChunk();
    const mesh = meshSection(chunk, 0);
    expect(meshTriangleBlock(mesh, 9999)).toBe(BlockId.Air);
  });

  it("culls the face between two blocks of the same kind", () => {
    // A 2x2x2 block of slate has 6 outer faces (12 triangles) and no
    // interior faces.
    const blocks = new Uint8Array(CHUNK_VOLUME);
    for (let x = 4; x < 6; x++) {
      for (let y = 4; y < 6; y++) {
        for (let z = 4; z < 6; z++) {
          blocks[blockIndex(x, y, z)] = ORD.slate;
        }
      }
    }
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };
    const mesh = meshSection(chunk, 0);
    expect(triangles(mesh)).toBe(12);
  });

  it("draws no face ACROSS a section boundary", () => {
    // A solid column spanning y=15 and y=16 crosses the section
    // boundary. The two blocks are one body, so meshing section 0 must
    // not draw the top of the y=15 block, and meshing section 1 must
    // not draw the bottom of the y=16 block.
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks[blockIndex(5, 15, 5)] = ORD.slate;
    blocks[blockIndex(5, 16, 5)] = ORD.slate;
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };

    // Section 0 sees the y=15 block with a solid block above it: only
    // its four side faces and its bottom, so 5 faces, 10 triangles.
    expect(triangles(meshSection(chunk, 0))).toBe(10);
    // Section 1 sees the y=16 block with a solid block below it: the
    // same 5 faces, 10 triangles.
    expect(triangles(meshSection(chunk, 1))).toBe(10);
  });

  it("draws a face where the block above a section boundary is air", () => {
    // The mirror of the test above: with air above, the top face IS
    // drawn, so the section-0 mesh has 6 faces, 12 triangles.
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks[blockIndex(5, 15, 5)] = ORD.slate;
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };
    expect(triangles(meshSection(chunk, 0))).toBe(12);
  });

  it("merges a flat slab into a single quad", () => {
    // A 4x1 slab of the same block must merge into ONE quad (2
    // triangles), not 8 separate quads.
    const blocks = new Uint8Array(CHUNK_VOLUME);
    for (let x = 0; x < 4; x++) {
      blocks[blockIndex(x, 0, 0)] = ORD.slate;
    }
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };
    const mesh = meshSection(chunk, 0);
    // One merged quad for the top, one for the bottom, one for each side
    // of the slab, and the two end caps: 6 quads, 12 triangles.
    expect(triangles(mesh)).toBe(12);
    // The merged top face is 4 blocks wide, so its UVs run 0..4.
    let widest = 0;
    for (let i = 0; i < mesh.uvs.length; i++) {
      const span = Math.abs(mesh.uvs[i] as number);
      if (span > widest) widest = span;
    }
    expect(widest).toBe(4);
  });

  it("hides the face a solid neighbour would cover", () => {
    // A single slate block at x=0 with a solid neighbour at x=-1: the
    // -X face must not be drawn, so there are 5 faces, 10 triangles,
    // not 6 faces and 12.
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks[blockIndex(0, 0, 0)] = ORD.slate;
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };

    const alone = meshSection(chunk, 0);
    expect(triangles(alone)).toBe(12);

    const west = new Uint8Array(CHUNK_VOLUME);
    west[blockIndex(15, 0, 0)] = ORD.slate;
    const withNeighbour = meshSection(chunk, 0, { west: { key: { cx: -1, cz: 0 }, blocks: west } });
    expect(triangles(withNeighbour)).toBe(10);
  });

  it("uses the east, north and south neighbour margins too", () => {
    // Each neighbour must sit on the edge it borders, and the test block
    // on the matching edge of the chunk being meshed, or the neighbour
    // is not actually adjacent to it.
    const solid = (lx: number, lz: number): Uint8Array => {
      const b = new Uint8Array(CHUNK_VOLUME);
      b[blockIndex(lx, 0, lz)] = ORD.slate;
      return b;
    };

    // A block on the -X edge of the chunk, hidden by a west neighbour.
    expect(
      triangles(
        meshSection({ key: { cx: 0, cz: 0 }, blocks: solid(0, 0) }, 0, {
          west: { key: { cx: -1, cz: 0 }, blocks: solid(15, 0) },
        }),
      ),
    ).toBe(10);

    // A block on the +X edge, hidden by an east neighbour.
    expect(
      triangles(
        meshSection({ key: { cx: 0, cz: 0 }, blocks: solid(15, 0) }, 0, {
          east: { key: { cx: 1, cz: 0 }, blocks: solid(0, 0) },
        }),
      ),
    ).toBe(10);

    // A block on the -Z edge, hidden by a north neighbour.
    expect(
      triangles(
        meshSection({ key: { cx: 0, cz: 0 }, blocks: solid(0, 0) }, 0, {
          north: { key: { cx: 0, cz: -1 }, blocks: solid(0, 15) },
        }),
      ),
    ).toBe(10);

    // A block on the +Z edge, hidden by a south neighbour.
    expect(
      triangles(
        meshSection({ key: { cx: 0, cz: 0 }, blocks: solid(0, 15) }, 0, {
          south: { key: { cx: 0, cz: 1 }, blocks: solid(0, 0) },
        }),
      ),
    ).toBe(10);
  });

  it("is byte-identical for the same chunk and the same neighbours", () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks[blockIndex(3, 3, 3)] = ORD.slate;
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };
    const west = new Uint8Array(CHUNK_VOLUME);
    west[blockIndex(15, 3, 3)] = ORD.slate;
    const neighbours = { west: { key: { cx: -1, cz: 0 }, blocks: west } };

    expect(sameMesh(meshSection(chunk, 0, neighbours), meshSection(chunk, 0, neighbours))).toBe(true);
    expect(sameMesh(meshChunk(chunk, neighbours), meshChunk(chunk, neighbours))).toBe(true);
  });

  it("every triangle's winding agrees with its normal", () => {
    // A back-facing triangle would be culled by the renderer, so the
    // mesh would silently lose faces.
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks[blockIndex(4, 4, 4)] = ORD.slate;
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };
    const mesh = meshSection(chunk, 0);

    for (let t = 0; t < triangles(mesh); t++) {
      const i0 = mesh.indices[t * 3] as number;
      const i1 = mesh.indices[t * 3 + 1] as number;
      const i2 = mesh.indices[t * 3 + 2] as number;
      const p = (i: number, k: number): number => mesh.positions[i * 3 + k] as number;
      const ax = p(i1, 0) - p(i0, 0);
      const ay = p(i1, 1) - p(i0, 1);
      const az = p(i1, 2) - p(i0, 2);
      const bx = p(i2, 0) - p(i0, 0);
      const by = p(i2, 1) - p(i0, 1);
      const bz = p(i2, 2) - p(i0, 2);
      // The cross product of the two edges gives the geometric normal.
      const cx = ay * bz - az * by;
      const cy = az * bx - ax * bz;
      const cz = ax * by - ay * bx;
      const nx = mesh.normals[i0 * 3] as number;
      const ny = mesh.normals[i0 * 3 + 1] as number;
      const nz = mesh.normals[i0 * 3 + 2] as number;
      // The dot product is positive when the winding faces the normal.
      expect(cx * nx + cy * ny + cz * nz).toBeGreaterThan(0);
    }
  });

  it("every normal is a unit axis vector", () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks[blockIndex(4, 4, 4)] = ORD.slate;
    blocks[blockIndex(6, 2, 8)] = ORD.loam;
    const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };
    const mesh = meshSection(chunk, 0);

    for (let i = 0; i < mesh.normals.length; i += 3) {
      const x = mesh.normals[i] as number;
      const y = mesh.normals[i + 1] as number;
      const z = mesh.normals[i + 2] as number;
      expect(Math.abs(x) + Math.abs(y) + Math.abs(z)).toBe(1);
    }
  });
});
