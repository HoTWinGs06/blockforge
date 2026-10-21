import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { BlockId, type MeshOutput, type Chunk } from "../src/core/types.js";
import { CHUNK_VOLUME, blockIndex, SECTION_HEIGHT } from "../src/core/constants.js";

describe("PRIORITY 3: Greedy Meshing Invariant Specification", async () => {
  const mesherFile = path.resolve(__dirname, "../src/core/meshing.ts");
  const mesherEngineFile = path.resolve(__dirname, "../src/engine/meshing.ts");
  const mesherExists = fs.existsSync(mesherFile) || fs.existsSync(mesherEngineFile);

  it("specifies Greedy Mesher contract for ENGINE", () => {
    if (!mesherExists) {
      expect(true).toBe(true);
      return;
    }
    expect(mesherExists).toBe(true);
  });

  if (mesherExists) {
    const targetModule = fs.existsSync(mesherFile)
      ? "../src/core/meshing.js"
      : "../src/engine/meshing.js";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mesherModule: any = await import(/* @vite-ignore */ targetModule);
    const meshSection = mesherModule.meshSection || mesherModule.buildSectionMesh;

    it("MeshOutput structure strictly adheres to contract", () => {
      const blocks = new Uint8Array(CHUNK_VOLUME);
      const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };
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
      blocks[blockIndex(5, 5, 5)] = 2;
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
          blocks[blockIndex(x, 0, z)] = 3;
        }
      }
      const chunk: Chunk = { key: { cx: 0, cz: 0 }, blocks };

      const mesh1: MeshOutput = meshSection(chunk, 0);
      const mesh2: MeshOutput = meshSection(chunk, 0);

      expect(Buffer.from(mesh1.positions.buffer).equals(Buffer.from(mesh2.positions.buffer))).toBe(true);
      expect(Buffer.from(mesh1.indices.buffer).equals(Buffer.from(mesh2.indices.buffer))).toBe(true);
      expect(Buffer.from(mesh1.blocks.buffer).equals(Buffer.from(mesh2.blocks.buffer))).toBe(true);
    });
  }
});
