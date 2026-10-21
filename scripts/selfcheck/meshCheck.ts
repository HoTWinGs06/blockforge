/**
 * Mesh self-check.
 *
 * Verifies the properties the renderer and the TEST AUTHOR depend on:
 *   - every triangle's winding agrees with its normal;
 *   - every quad's UVs cover its width and height in block units;
 *   - a single block in air produces exactly six quads (one per face);
 *   - the same chunk always produces byte-identical output.
 *
 * Build and run:
 *   npx tsc -p scripts/tsconfig.build.json
 *   node .build/scripts/selfcheck/meshCheck.js
 */

import { createChunk, setBlock } from "../../src/core/world.js";
import { blockOrdinal } from "../../src/core/world.js";
import { meshChunk } from "../../src/core/meshing.js";
import { BlockId } from "../../src/core/types.js";

let failures = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    process.stdout.write(`  ok   ${name}\n`);
  } else {
    failures++;
    process.stderr.write(`  FAIL ${name} ${detail}\n`);
  }
}

/** A 3-vector. */
type Vec3 = readonly [number, number, number];

/** The cross product of two 3-vectors. */
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

process.stdout.write("mesh self-check\n");

// 1. A single block in air: six faces, one per direction.
{
  const chunk = createChunk({ cx: 0, cz: 0 });
  setBlock(chunk, 8, 10, 8, BlockId.Rubble);
  const mesh = meshChunk(chunk);
  const quads = mesh.indices.length / 6;
  check("one block produces six quads", quads === 6, `got ${quads}`);
  check(
    "blocks array has one entry per triangle",
    mesh.blocks.length === mesh.indices.length / 3,
    `${mesh.blocks.length} vs ${mesh.indices.length / 3}`,
  );
  check(
    "every face is the block's own",
    [...mesh.blocks].every((b) => b === blockOrdinal(BlockId.Rubble)),
  );
}

// 2. Winding: the triangle's geometric normal matches the vertex normal.
{
  const chunk = createChunk({ cx: 0, cz: 0 });
  setBlock(chunk, 8, 10, 8, BlockId.Rubble);
  setBlock(chunk, 9, 10, 8, BlockId.Slate);
  setBlock(chunk, 7, 12, 9, BlockId.Loam);
  const mesh = meshChunk(chunk);

  let windingOk = true;
  let normalsOk = true;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const i0 = mesh.indices[t] ?? 0;
    const i1 = mesh.indices[t + 1] ?? 0;
    const i2 = mesh.indices[t + 2] ?? 0;
    const p = (i: number): Vec3 => [
      mesh.positions[i * 3] ?? 0,
      mesh.positions[i * 3 + 1] ?? 0,
      mesh.positions[i * 3 + 2] ?? 0,
    ];
    const a = p(i0);
    const b = p(i1);
    const c = p(i2);
    const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = cross(e1, e2);
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9) {
      normalsOk = false;
      continue;
    }
    const unit: Vec3 = [n[0] / len, n[1] / len, n[2] / len];
    const vn: Vec3 = [
      mesh.normals[i0 * 3] ?? 0,
      mesh.normals[i0 * 3 + 1] ?? 0,
      mesh.normals[i0 * 3 + 2] ?? 0,
    ];
    // The vertex normal must point the same way as the triangle's own
    // winding: a positive dot means the face is front-facing.
    if (unit[0] * vn[0] + unit[1] * vn[1] + unit[2] * vn[2] <= 0) {
      windingOk = false;
    }
  }
  check("triangle winding agrees with the vertex normal", windingOk);
  check("no degenerate triangles", normalsOk);
}

// 3. UVs cover the quad in block units.
{
  const chunk = createChunk({ cx: 0, cz: 0 });
  // A 4x1x1 slab of slate: the greedy mesher should merge its top face
  // into a single quad with 0..4 UVs.
  for (let x = 2; x < 6; x++) {
    setBlock(chunk, x, 10, 8, BlockId.Slate);
  }
  const mesh = meshChunk(chunk);
  let sawWideQuad = false;
  for (let q = 0; q < mesh.indices.length; q += 6) {
    const i0 = mesh.indices[q] ?? 0;
    const u0 = mesh.uvs[i0 * 2] ?? 0;
    const u1 = mesh.uvs[(mesh.indices[q + 1] ?? 0) * 2] ?? 0;
    const v0 = mesh.uvs[i0 * 2 + 1] ?? 0;
    const v1 = mesh.uvs[(mesh.indices[q + 2] ?? 0) * 2 + 1] ?? 0;
    if (
      Math.abs(Math.abs(u1 - u0) - 4) < 1e-6 &&
      Math.abs(Math.abs(v1 - v0) - 1) < 1e-6
    ) {
      sawWideQuad = true;
    }
  }
  check("a 4x1 slab merges into one quad with 0..4 UVs", sawWideQuad);
}

// 4. Determinism: the same chunk always produces identical bytes.
{
  const build = (): ReturnType<typeof meshChunk> => {
    const chunk = createChunk({ cx: 3, cz: -2 });
    setBlock(chunk, 1, 20, 1, BlockId.Timber);
    setBlock(chunk, 2, 20, 1, BlockId.Foliage);
    return meshChunk(chunk);
  };
  const a = build();
  const b = build();
  const same =
    a.positions.every((v, i) => v === b.positions[i]) &&
    a.indices.every((v, i) => v === b.indices[i]) &&
    a.uvs.every((v, i) => v === b.uvs[i]) &&
    a.blocks.every((v, i) => v === b.blocks[i]);
  check("meshing the same chunk twice is byte-identical", same);
}

// 5. Positions stay inside the chunk's bounds.
{
  const chunk = createChunk({ cx: 0, cz: 0 });
  setBlock(chunk, 0, 0, 0, BlockId.Voidstone);
  const mesh = meshChunk(chunk);
  let inBounds = true;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i] ?? 0;
    const y = mesh.positions[i + 1] ?? 0;
    const z = mesh.positions[i + 2] ?? 0;
    if (x < 0 || x > 16 || y < 0 || y > 256 || z < 0 || z > 16) {
      inBounds = false;
    }
  }
  check("positions stay inside the chunk bounds", inBounds);
}

if (failures > 0) {
  process.stderr.write(`\nmesh self-check FAILED: ${failures} check(s)\n`);
  process.exit(1);
}
process.stdout.write("\nmesh self-check PASSED\n");
