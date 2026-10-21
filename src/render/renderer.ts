/**
 * BlockForge — renderer.
 *
 * Consumes the FROZEN core contract (src/core/types.ts, src/core/constants.ts)
 * without changing it. This module owns everything Three.js and DOM: scene,
 * lighting, first-person camera, chunk meshes, the block highlight, and the HUD.
 *
 * ORIGINALITY: the texture atlas is generated procedurally at runtime
 * (see textures.ts) and sounds are synthesised with WebAudio (see audio.ts).
 * No binary art or audio is committed to this repository.
 */

import * as THREE from "three";
import type { ChunkKey, MeshOutput, PlayerState } from "../core/types.js";
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from "../core/constants.js";
import { faceUv, getAtlasTexture } from "./textures.js";
import { blockFromOrdinal } from "../core/world.js";
/** How far the player can reach when breaking or placing a block. */
export const REACH_DISTANCE = 6;

/** A chunk mesh built from a MeshOutput. */
export interface ChunkMesh {
  readonly key: ChunkKey;
  readonly mesh: THREE.Mesh;
  dispose(): void;
}

/**
 * Build a Three.js mesh for one chunk from the mesher's MeshOutput.
 *
 * MeshOutput.blocks is one entry per triangle, parallel to indices, so the
 * per-face block kind is available for atlas UV selection.
 */
export function buildChunkMesh(key: ChunkKey, output: MeshOutput): ChunkMesh {
  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute("position", new THREE.BufferAttribute(output.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(output.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(output.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(output.indices, 1));

  // Resolve per-triangle block kinds into atlas UVs. The mesher gives us a
  // flat uv attribute; we rewrite it from the block ids so each face samples
  // its own tile.
  const uvs = new Float32Array(output.uvs.length);
  const blockIds = output.blocks;
  for (let tri = 0; tri * 3 + 2 < output.indices.length; tri++) {
    // The mesher emits the ORDINAL of the face's block kind, one per triangle.
    // It has to be converted to a BlockId before it can be looked up in the
    // atlas: faceUv() -> tileIndex() does TILE_ORDER.indexOf(id), and
    // indexOf() on a NUMBER returns -1, which tileIndex() then clamps to 0.
    // Every face therefore sampled tile 0 (Voidstone, #17151f - the darkest
    // block in the palette), which is why the whole world rendered as one
    // near-black mass with no distinguishable block textures.
    const id = blockFromOrdinal(blockIds[tri] as number);
    const corners = faceUv(id);

    // A quad is 4 consecutive vertices and 2 triangles, and the mesher may
    // flip the winding. The corner of a quad that a vertex belongs to is its
    // offset from the quad's first vertex, so derive that rather than
    // assuming the triangle-local vertex order - assuming it gave the second
    // triangle of every quad the wrong three corners.
    const quadStart = (tri - (tri % 2)) * 3;
    let quadFirst = Infinity;
    for (let k = 0; k < 6; k++) {
      const idx = output.indices[quadStart + k];
      if (idx !== undefined && idx < quadFirst) quadFirst = idx;
    }
    for (let v = 0; v < 3; v++) {
      const vi = output.indices[tri * 3 + v];
      if (vi === undefined) continue;
      const corner = vi - quadFirst;
      const c = corners[corner];
      if (c === undefined) continue;
      uvs[vi * 2] = c[0];
      uvs[vi * 2 + 1] = c[1];
    }
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

  const material = new THREE.MeshLambertMaterial({
    map: getAtlasTexture(),
    vertexColors: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(key.cx * CHUNK_SIZE_X, 0, key.cz * CHUNK_SIZE_Z);
  mesh.name = `chunk:${key.cx},${key.cz}`;

  return {
    key,
    mesh,
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** The renderer owns the scene graph and the player camera. */
export class WorldRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private readonly chunkGroup = new THREE.Group();
  private readonly meshes = new Map<string, ChunkMesh>();
  private readonly highlight: THREE.LineSegments;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#8fb8e8");
    this.scene.fog = new THREE.Fog("#8fb8e8", 40, 140);

    this.camera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / Math.max(1, canvas.clientHeight),
      0.1,
      1000,
    );
    this.camera.position.set(0.5, 80, 0.5);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      // The G2 gate asserts ZERO console errors/warnings, so do not let
      // three.js emit its own informational output.
      powerPreference: "high-performance",
    });
    this.renderer.setSize(canvas.clientWidth, Math.max(1, canvas.clientHeight), false);
    this.renderer.setPixelRatio(1);

    // Sky light plus a warm key light so block faces read clearly.
    this.scene.add(new THREE.HemisphereLight("#cfe3ff", "#4a4238", 0.85));
    const sun = new THREE.DirectionalLight("#fff3d6", 0.75);
    sun.position.set(60, 120, 40);
    this.scene.add(sun);

    this.scene.add(this.chunkGroup);

    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: "#101014" }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);
  }

  /** Add or replace the mesh for a chunk. */
  setChunk(key: ChunkKey, output: MeshOutput): void {
    const id = `${key.cx},${key.cz}`;
    const existing = this.meshes.get(id);
    if (existing) {
      this.chunkGroup.remove(existing.mesh);
      existing.dispose();
    }
    const chunk = buildChunkMesh(key, output);
    this.meshes.set(id, chunk);
    this.chunkGroup.add(chunk.mesh);
  }

  /** Remove a chunk's mesh. */
  removeChunk(key: ChunkKey): void {
    const id = `${key.cx},${key.cz}`;
    const existing = this.meshes.get(id);
    if (existing) {
      this.chunkGroup.remove(existing.mesh);
      existing.dispose();
      this.meshes.delete(id);
    }
  }

  /** Apply the player's position and orientation to the camera. */
  applyPlayer(state: PlayerState): void {
    this.camera.position.set(
      state.position.x,
      state.position.y + 1.62,
      state.position.z,
    );
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = state.yaw;
    this.camera.rotation.x = state.pitch;
  }

  /** Show the wireframe on the block the player is aiming at. */
  showHighlight(x: number, y: number, z: number): void {
    this.highlight.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.highlight.visible = true;
  }

  hideHighlight(): void {
    this.highlight.visible = false;
  }

  /** Render one frame. */
  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Resize the drawing buffer to match the canvas. */
  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, Math.max(1, height), false);
  }

  dispose(): void {
    for (const chunk of this.meshes.values()) {
      chunk.dispose();
    }
    this.meshes.clear();
    this.renderer.dispose();
  }
}

/** Convert a world block coordinate to the chunk that contains it. */
export function chunkKeyOf(x: number, _y: number, z: number): ChunkKey {
  return {
    cx: Math.floor(x / CHUNK_SIZE_X),
    cz: Math.floor(z / CHUNK_SIZE_Z),
  };
}

/** True if the coordinate is inside the buildable world. */
export function withinWorld(y: number): boolean {
  return y >= 0 && y < CHUNK_SIZE_Y;
}
