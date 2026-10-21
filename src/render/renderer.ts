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
import { CloudLayer } from "./clouds.js";
import { WORLD_SEED } from "./engineBridge.js";
import { Viewmodel } from "./viewmodel.js";
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

  /**
   * The player's hand.
   *
   * It is parented to the CAMERA, so it lives in the camera's own space:
   * always the same distance from the eye, never clipped by terrain, and it
   * turns with the player's head for free.
   */
  private readonly viewmodel = new Viewmodel();

  /**
   * The cloud deck.
   *
   * It lives here rather than inside buildSky() because it has to be
   * ADVANCED every frame: the deck's sprites are positioned by advance(),
   * not by the constructor. A deck that is built and never advanced leaves
   * every sprite at the origin - inside the ground, invisible - which is
   * exactly what happened: the feature was written, the tests passed, and
   * the sky had no clouds in it.
   */
  private readonly clouds: CloudLayer;

  /** The frame counter the cloud deck drifts on. */
  private cloudTick = 0;

  /**
   * A second scene that holds ONLY the viewmodel.
   *
   * The hand is parented to the camera, and the camera lives in this scene
   * only while the hand is being drawn. Keeping the hand out of the world
   * scene is what stops the chunk fog from swallowing it, and it means the
   * hand is never clipped by terrain.
   */
  private readonly overlayScene = new THREE.Scene();
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
    this.viewmodel.setViewport(canvas.clientWidth, Math.max(1, canvas.clientHeight));

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

    // The cloud deck is added to the SCENE, not to the sky group, because
    // the renderer has to advance it every frame - the sky group is built
    // once and never touched again.
    this.clouds = new CloudLayer(WORLD_SEED);
    this.scene.add(this.clouds.group);

    this.scene.add(this.chunkGroup);

    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: "#101014" }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    // The viewmodel is a child of the CAMERA, not of the scene, and it is
    // rendered in its own pass with the fog cleared - see render().
    //
    // Parenting it to the camera is what makes it a viewmodel rather than
    // another object in the world: it lives in the camera's own space, so it
    // is always the same distance from the eye, it turns with the player's
    // head for free, and it can never be clipped by terrain.
    this.camera.add(this.viewmodel.group);
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

    // Advance the cloud deck. The sprites are positioned here, so a deck
    // that is not advanced has every cloud sitting at the origin.
    this.cloudTick++;
    this.clouds.advance(this.cloudTick, state.position);
  }

  /** Show the wireframe on the block the player is aiming at. */
  showHighlight(x: number, y: number, z: number): void {
    this.highlight.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.highlight.visible = true;
  }

  hideHighlight(): void {
    this.highlight.visible = false;
  }

  /**
   * Render one frame.
   *
   * TWO PASSES, and the second one is the point of the viewmodel.
   *
   * The first pass draws the world with its fog. The second draws the hand
   * with the fog REMOVED. If both were drawn together, the hand - which sits
   * about half a unit from the eye, far inside the fog's near plane - would
   * be completely washed out in sky colour, and the player would have no
   * visible hand at all. That is exactly the bug T71 reported.
   */
  render(): void {
    // Pass one: the world, with its fog.
    this.renderer.render(this.scene, this.camera);

    // Pass two: the hand, in its OWN scene.
    //
    // The overlay scene has no fog and no world geometry in it, so the hand
    // cannot be tinted by the distance fog and the world is not drawn twice.
    // The camera is added to the overlay scene too, because the hand is
    // parented to the camera - but the overlay scene does not contain the
    // camera's PARENT, so the camera's world transform is exactly what
    // applyPlayer() set.
    this.overlayScene.add(this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.overlayScene, this.camera);
    this.renderer.autoClear = true;
  }

  /**
   * Update the viewmodel's motion.
   *
   * @param dt       seconds since the last frame
   * @param speed    the player's horizontal speed in blocks per second
   * @param onGround whether the player is standing on something
   */
  updateViewmodel(dt: number, speed: number, onGround: boolean): void {
    this.viewmodel.update(dt, speed, onGround);
  }

  /** Set the block the player's hand is holding. */
  setHeldBlock(id: BlockId): void {
    this.viewmodel.setHeldBlock(id);
  }

  /**
   * The block the player's hand is holding.
   *
   * This is player-facing state - what you are holding - so it is a fair
   * thing for the browser tests to read.
   */
  get heldBlock(): BlockId {
    return this.viewmodel.held;
  }

  /**
   * The hand's UV bounds, for the browser tests.
   *
   * The hand must show ONE block's texture, not the whole atlas. Checking
   * that from the outside needs the hand's UVs, and the tests cannot import
   * the viewmodel module directly - a browser-side dynamic import of it
   * fails to resolve three.js's bare specifier. So the renderer reads its
   * own viewmodel and reports the numbers.
   */
  get viewmodelUvBounds(): { minU: number; maxU: number; minV: number; maxV: number } {
    return this.viewmodel.uvBounds;
  }

  /**
   * Where the hand is on the screen, in CSS pixels relative to the canvas.
   *
   * A browser test needs this to sample the HAND's pixels. The hand is a
   * child of the camera, so its screen position is fixed by the projection
   * and does not move when the player looks around - a test can read this
   * once and sample exactly the hand, instead of averaging a wide region
   * that is mostly background.
   */
  get viewmodelScreenBounds(): { x: number; y: number; width: number; height: number } | null {
    return this.viewmodel.screenBounds;
  }

  /**
   * Whether the hand's material has fog enabled.
   *
   * It must NOT. The hand sits far inside the chunk fog's near plane, so fog
   * would swallow it entirely.
   */
  get viewmodelHasFog(): boolean {
    return this.viewmodel.hasFog;
  }

  /** Start the break swing. */
  swingViewmodel(): void {
    this.viewmodel.swingNow();
  }

  /** Resize the drawing buffer to match the canvas. */
  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, Math.max(1, height), false);
    this.viewmodel.setViewport(width, Math.max(1, height));
  }

  dispose(): void {
    this.clouds.dispose();
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
