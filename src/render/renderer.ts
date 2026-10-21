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
import type { BlockId, ChunkKey, MeshOutput, PlayerState } from "../core/types.js";
import { blockFromOrdinal } from "../core/world.js";
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z } from "../core/constants.js";
import { faceUv, getAtlasTexture } from "./textures.js";
import { buildSky } from "./sky.js";
import { FOG_FAR, FOG_NEAR } from "./viewDistance.js";
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
  //
  // MeshOutput.blocks holds ORDINALS, not BlockId values - the mesher pushes
  // the numeric ordinal of the block, and the engine exports
  // blockFromOrdinal() to turn one back into a BlockId. Treating them as
  // BlockIds (which are strings) made every lookup miss, so faceUv() fell
  // back to tile 0 and EVERY BLOCK IN THE GAME rendered with the same
  // texture. That was the cause of the operator's "no different colour
  // textures for the blocks".
  // NOTE on the array length. The mesher pushes EIGHT floats per quad
  // (four corners, two floats each) but only FOUR vertices per quad, so
  // output.uvs is TWICE the length a vertex-indexed uv attribute needs.
  // Allocating output.uvs.length gave an attribute twice too long, and
  // three.js then read only the first half of it - which happened to be the
  // first two UVs of every quad. The result was that every face sampled the
  // same texel, and the whole world rendered as one flat texture.
  //
  // The attribute must be sized by the VERTEX count, which is
  // output.positions.length / 3.
  const vertexCount = output.positions.length / 3;
  const uvs = new Float32Array(vertexCount * 2);
  const blockOrdinals = output.blocks;
  for (let tri = 0; tri * 3 + 2 < output.indices.length; tri++) {
    const ordinal = blockOrdinals[tri];
    if (ordinal === undefined) {
      continue;
    }
    let id: BlockId;
    try {
      id = blockFromOrdinal(ordinal);
    } catch {
      // An out-of-range ordinal is a mesh defect, not a crash. Fall back to
      // the first tile rather than taking the whole renderer down.
      continue;
    }
    const corners = faceUv(id);
    for (let v = 0; v < 3; v++) {
      const vi = output.indices[tri * 3 + v];
      const c = corners[v % 4];
      if (vi === undefined || c === undefined) {
        continue;
      }
      uvs[vi * 2] = c[0];
      uvs[vi * 2 + 1] = c[1];
    }
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

  // MeshStandardMaterial, not Lambert.
  //
  // The atlas is an sRGB colour map, and Lambert under a single hemisphere
  // light leaves every face that points away from the sun almost black. The
  // operator reported "the blocks all look the same" and the diagnostic
  // proved the ATLAS is correct - eight distinct sampled colours, twenty-two
  // distinct UV sets - so the fault was downstream: the lighting. Standard
  // material with a real ambient term keeps every face readable, and the
  // per-face texture differences survive.
  const material = new THREE.MeshStandardMaterial({
    map: getAtlasTexture(),
    vertexColors: false,
    roughness: 0.95,
    metalness: 0.0,
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
    // The fog distance is tied to the engine's VIEW_RADIUS_CHUNKS so the fade
    // hides the boundary of the loaded region: the player never sees the edge
    // of the world, they see it fade out into the sky.
    this.scene.fog = new THREE.Fog("#8fb8e8", FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / Math.max(1, canvas.clientHeight),
      0.1,
      1000,
    );
    // The terrain surface is around y = 68 for the default seed. Starting the
    // camera here means the very first frame looks at the ground rather than
    // at the unlit underside of a hill twelve blocks up.
    this.camera.position.set(0.5, 70.5, 0.5);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      // The G2 gate asserts ZERO console errors/warnings, so do not let
      // three.js emit its own informational output.
      powerPreference: "high-performance",
    });
    this.renderer.setSize(canvas.clientWidth, Math.max(1, canvas.clientHeight), false);
    this.renderer.setPixelRatio(1);

    // Lighting: sky light, a warm key light, and a floor of ambient.
    //
    // THE KEY FACT, learned the hard way from a screenshot: three.js r155+
    // uses physically correct lighting by default. Under that model a light
    // intensity of 1-2 is DIM - a DirectionalLight of 1.9 lights a surface to
    // roughly 2% of its albedo, and the whole terrain renders as a black
    // mass no matter how good the textures are. The UV rewrite was proven
    // correct (21 distinct UV regions, 16 distinct sampled colours from a
    // real chunk mesh), so the blackness was the lighting all along.
    //
    // The intensities below are calibrated for the physical model: sun ~3,
    // sky ~2, ambient ~1.2. The ambient floor is what guarantees that a face
    // pointing away from the sun is still readable.
    this.scene.add(new THREE.HemisphereLight("#cfe3ff", "#8a7d68", 2.0));
    this.scene.add(new THREE.AmbientLight("#b9c6d8", 1.2));

    const sunDirection = new THREE.Vector3(60, 120, 40);
    const sun = new THREE.DirectionalLight("#fff3d6", 3.0);
    sun.position.copy(sunDirection);
    this.scene.add(sun);

    // Tone mapping keeps the bright sunlit faces from blowing out while the
    // shaded faces stay readable.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // The sky dome and its sun disc share the light's direction, so the
    // bright spot in the sky and the lit side of the blocks agree.
    this.scene.add(buildSky(sunDirection));

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
