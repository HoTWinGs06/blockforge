/**
 * BlockForge — the first-person viewmodel.
 *
 * T71: "no player hand visible". There was no viewmodel at all. This is it:
 * a small mesh parented to the CAMERA, textured with the procedural block
 * atlas, holding whatever the player has selected in the hotbar.
 *
 * Three rules, and each one is a bug it would otherwise have:
 *
 * 1. IT IS A SEPARATE SCENE OBJECT FROM THE WORLD. A viewmodel that lives in
 *    the world gets clipped by terrain - you walk into a wall and the hand
 *    disappears into it. Parenting it to the camera puts it in the camera's
 *    own space, always the same distance away, never inside geometry.
 *
 * 2. IT IS NOT AFFECTED BY THE CHUNK FOG. The world's fog starts at FOG_NEAR
 *    and ends at FOG_FAR, but the viewmodel sits about half a unit from the
 *    eye, so it would be swallowed by the fog immediately and the hand would
 *    be a smear of sky colour. The material therefore has `fog: false`, and
 *    the viewmodel is lit by its own lights rather than the world's.
 *
 * 3. IT DOES NOT CAST OR RECEIVE SHADOWS. Nothing in this project has
 *    shadow maps, but the flag is explicit so that adding them later does not
 *    suddenly give the player a shadow on their own hand.
 *
 * The motion is T72's walk animation: a bob driven by how fast the player is
 * moving, and a swing when a block breaks.
 */

import * as THREE from "three";
import { BlockId } from "../core/types.js";
import { getAtlasTexture, faceUv, TILE_PX } from "./textures.js";

/**
 * How far in front of the eye the viewmodel sits, in world units.
 *
 * 0.55 put the hand in the lower-right corner but it filled a quarter of
 * the screen. 0.8 puts it where a first-person hand belongs: visible, but
 * not the main event.
 */
const VIEWMODEL_DISTANCE = 0.8;

/** The bob's amplitude and speed while walking. */
const BOB_AMPLITUDE = 0.035;
const BOB_FREQUENCY = 1.9;

/** How far the swing travels, and how long it takes. */
const SWING_DISTANCE = 0.16;
const SWING_DURATION = 0.28;

/**
 * The player's hand.
 *
 * Add it to a scene and parent it to the camera. It renders itself in its own
 * pass so the fog cannot touch it.
 */
export class Viewmodel {
  readonly group: THREE.Group;

  /** The mesh: a cube textured with the block atlas. */
  private readonly mesh: THREE.Mesh;

  /** The material, with fog disabled. */
  private readonly material: THREE.MeshLambertMaterial;

  /** The light that lights the hand, so it does not depend on the sun. */
  private readonly keyLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.HemisphereLight;

  /** The block kind the hand is holding. */
  private heldBlock: BlockId = BlockId.Rubble;

  /** 0..1, how far through a swing the hand is. */
  private swing = 0;

  /** The bob's phase, in radians. */
  private bobPhase = 0;

  /**
   * The edge length of the hand cube, in world units.
   *
   * A third of a tile. Bigger than that and the hand dominates the screen.
   */
  private readonly size = TILE_PX / 150;

  /** The base position, so the bob and the swing can be applied on top. */
  private readonly basePosition = new THREE.Vector3(
    VIEWMODEL_DISTANCE * 0.52,
    -VIEWMODEL_DISTANCE * 0.46,
    -VIEWMODEL_DISTANCE,
  );

  constructor() {
    this.group = new THREE.Group();
    this.group.name = "blockforge-viewmodel";
    // The viewmodel must not be culled when the camera turns away from it.
    this.group.frustumCulled = false;
    this.group.renderOrder = 10;

    // The hand is a cube using the same atlas the world uses, so the block
    // the player is holding looks like the block it came from.
    //
    // It is NOT a BoxGeometry. BoxGeometry's UV attribute is laid out by
    // vertex GROUP rather than by face, so writing "four corners per face"
    // into it scatters the four UVs of one tile across four different faces -
    // and the result is the hand wearing the WHOLE ATLAS, one tile per
    // face. A purpose-built cube below gets the UVs right by construction:
    // six quads, each with four vertices, each vertex taking its corner from
    // faceUv(id).
    const geometry = this.buildHandGeometry();

    this.material = new THREE.MeshLambertMaterial({
      map: getAtlasTexture(),
      // THE POINT: the chunk fog would swallow the hand at this distance.
      fog: false,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    // The hand gets its own lights. Using the world's sun would make the
    // hand go dark when the player faces away from the sun, which looks
    // broken rather than atmospheric.
    this.keyLight = new THREE.DirectionalLight("#fff3d6", 2.4);
    this.keyLight.position.set(0.6, 1, 0.8);
    this.group.add(this.keyLight);

    this.fillLight = new THREE.HemisphereLight("#cfe3ff", "#8a7d68", 1.6);
    this.group.add(this.fillLight);

    this.group.position.copy(this.basePosition);
    this.group.rotation.set(0.25, -0.55, 0.1);
  }

  /**
   * Set the block the hand is holding.
   *
   * The UVs are set to the atlas cell for that block's side face, so the
   * hand shows the texture of the thing it is holding.
   */
  setHeldBlock(id: BlockId): void {
    if (id === this.heldBlock) {
      return;
    }
    this.heldBlock = id;

    // Rebuild the cube with the new block's UVs. The geometry is cheap -
    // 24 vertices - and doing it this way means the UVs are correct by
    // construction rather than by a guess about the layout.
    const geometry = this.buildHandGeometry();
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
  }

  /** The block the hand is holding. */
  get held(): BlockId {
    return this.heldBlock;
  }

  /**
   * The hand's UV bounds.
   *
   * The hand must show ONE block's texture, not the whole atlas - and the
   * browser tests need to check that from the outside, because they cannot
   * import this module directly (a browser-side dynamic import of it fails
   * to resolve three.js's bare specifier).
   */
  get hasFog(): boolean {
    return this.material.fog;
  }

  get uvBounds(): { minU: number; maxU: number; minV: number; maxV: number } {
    const attribute = this.mesh.geometry.getAttribute("uv");
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < attribute.count; i++) {
      minU = Math.min(minU, attribute.getX(i));
      maxU = Math.max(maxU, attribute.getX(i));
      minV = Math.min(minV, attribute.getY(i));
      maxV = Math.max(maxV, attribute.getY(i));
    }
    return { minU, maxU, minV, maxV };
  }

  /**
   * Build the hand's cube: six quads, each four vertices, each face textured
   * with the held block's atlas cell.
   *
   * The UV corners come from faceUv(id), the same function the world meshes
   * use, so the hand shows exactly the texture the block it holds has.
   */
  private buildHandGeometry(): THREE.BufferGeometry {
    const h = this.size / 2;
    const corners = faceUv(this.heldBlock);

    // The six faces of a cube: [normal, four corner positions].
    const faces: Array<{
      n: [number, number, number];
      v: Array<[number, number, number]>;
    }> = [
      { n: [0, 0, 1], v: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },
      { n: [0, 0, -1], v: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] },
      { n: [1, 0, 0], v: [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]] },
      { n: [-1, 0, 0], v: [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]] },
      { n: [0, 1, 0], v: [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]] },
      { n: [0, -1, 0], v: [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]] },
    ];

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    faces.forEach((face, faceIndex) => {
      const base = faceIndex * 4;
      for (let corner = 0; corner < 4; corner++) {
        const p = face.v[corner];
        const n = face.n;
        if (!p) {
          continue;
        }
        positions.push(p[0], p[1], p[2]);
        normals.push(n[0], n[1], n[2]);
        const c = corners[corner];
        if (c) {
          uvs.push(c[0], c[1]);
        } else {
          uvs.push(0, 0);
        }
      }
      // Two triangles per quad, wound counter-clockwise.
      indices.push(base + 0, base + 1, base + 2, base + 0, base + 2, base + 3);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    return geometry;
  }

  /**
   * Start a break swing.
   *
   * Called when a block breaks. The hand swings forward and comes back.
   */
  swingNow(): void {
    this.swing = 0;
  }

  /**
   * Advance the viewmodel's motion.
   *
   * @param dt       seconds since the last frame
   * @param speed    the player's horizontal speed, in blocks per second
   * @param onGround whether the player is standing on something
   */
  update(dt: number, speed: number, onGround: boolean): void {
    // The bob only happens while actually moving and grounded. A bob while
    // falling looks like the player is shaking.
    if (speed > 0.15 && onGround) {
      this.bobPhase += dt * BOB_FREQUENCY * Math.PI * 2 * Math.min(1, speed / 4);
    } else {
      // Ease the phase back so the bob settles rather than freezing at an
      // arbitrary angle.
      this.bobPhase += dt * 0.5;
    }

    const bobAmount = speed > 0.15 && onGround ? Math.min(1, speed / 4) : 0;
    const bobY = Math.sin(this.bobPhase) * BOB_AMPLITUDE * bobAmount;
    const bobX = Math.cos(this.bobPhase * 0.5) * BOB_AMPLITUDE * 0.6 * bobAmount;
    const bobRoll = Math.cos(this.bobPhase) * 0.035 * bobAmount;

    // The swing: a quick arc forward and back, easing out.
    let swingZ = 0;
    let swingPitch = 0;
    if (this.swing < 1) {
      this.swing = Math.min(1, this.swing + dt / SWING_DURATION);
      // A fast ease-in, slow ease-out: the strike is quick, the recovery is
      // not. A linear ramp reads as a machine.
      const t = this.swing;
      const eased = t < 0.35 ? (t / 0.35) * 0.35 : 0.35 + ((t - 0.35) / 0.65) * 0.65;
      swingZ = -Math.sin(eased * Math.PI) * SWING_DISTANCE;
      swingPitch = -Math.sin(eased * Math.PI) * 0.9;
    }

    this.group.position.set(
      this.basePosition.x + bobX,
      this.basePosition.y + bobY,
      this.basePosition.z + swingZ,
    );
    this.group.rotation.set(
      0.25 + swingPitch,
      -0.55,
      0.1 + bobRoll,
    );
  }

  /**
   * Render the viewmodel.
   *
   * It is drawn in its own pass with the world's fog cleared, so the hand
   * is never tinted by the distance fog. Without this, the hand sits inside
   * the fog's near plane and disappears.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const fog = scene.fog;
    scene.fog = null;
    renderer.render(scene, camera);
    scene.fog = fog;
  }

  /** Release the GPU resources. */
  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
