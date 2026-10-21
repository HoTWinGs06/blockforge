/**
 * BlockForge — clouds.
 *
 * A deck of large, soft billboards drifting above the player.
 *
 * DETERMINISM: every cloud's placement comes from the WORLD SEED through
 * the engine's seeded PRNG (src/core/rng.ts) - never Math.random() - and
 * the placement is a function of the WORLD CELL the cloud sits in, not of
 * the observer. So two players in the same world see the same clouds at the
 * same world positions, and a recorded world looks the same twice. The
 * clouds DRIFT, but the drift is a function of a TICK COUNTER, not a fresh
 * random draw, and it is bounded, so a cloud never wanders out of its cell.
 *
 * FOG: the cloud material is fogged by the scene's fog, like the terrain,
 * so a cloud sitting at the fog distance dissolves into the haze instead of
 * floating in front of it as a flat decal. The material is unlit, so the
 * sun's shadow can never touch a cloud, and a sprite casts no shadow.
 */

import * as THREE from "three";
import { createRng } from "../core/index.js";
import { FOG_FAR, FOG_NEAR } from "./viewDistance.js";

/** Nominal frames per second of the render loop; the game steps at 1/60 s. */
const FRAMES_PER_SECOND = 60;

/** The side of a world cell, in blocks. */
const CELL = 32;

/** How many cells around the observer are populated. */
const CELL_RADIUS = 1;

/** The world altitude the cloud deck sits at, in blocks. */
/**
 * The altitude band the clouds drift in.
 *
 * The player stands at about y=68, so the deck is 20 to 32 blocks above their
 * head. It is deliberately ABOVE the world's fog far plane (60): the cloud
 * material has fog DISABLED and does its own distance fade, so the deck is
 * not swallowed by the scene fog. See the material in populate().
 */
const ALTITUDE_MIN = 88;
const ALTITUDE_MAX = 100;

/** How wide one cloud is, in blocks. */
const WIDTH_MIN = 18;
const WIDTH_MAX = 34;

/** How far a cloud wanders from its anchor, and how long a wander takes. */
const AMPLITUDE_MIN = 4;
const AMPLITUDE_MAX = 12;
const PERIOD_MIN = 70;
const PERIOD_MAX = 150;

/** The base opacity of a cloud. */
const CLOUD_OPACITY = 0.9;

/** One cloud: the billboard, where it belongs, and how it drifts. */
interface Cloud {
  readonly sprite: THREE.Sprite;
  readonly material: THREE.SpriteMaterial;
  readonly anchor: THREE.Vector3;
  readonly amplitude: number;
  readonly period: number;
  readonly phase: number;
}

/**
 * A stable integer hash, so the puff shape is the same on every load.
 * The texture layer uses the same trick; nothing here is random.
 */
function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

/**
 * Draw one soft cloud puff.
 *
 * A cluster of overlapping radial gradients, placed by a stable hash so the
 * shape never changes between loads and nothing is random.
 *
 * Exported so a test can assert it produced real pixels: a cloud texture
 * that is empty is a bug that is very hard to see in a screenshot.
 */
export function buildCloudCanvas(): HTMLCanvasElement {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable - cannot build the clouds");
  }
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 7; i++) {
    const x = size * (0.16 + hash2(i, 0, 0x51ed) * 0.68);
    const y = size * (0.28 + hash2(i, 1, 0x51ed) * 0.44);
    const r = size * (0.14 + hash2(i, 2, 0x51ed) * 0.22);
    const puff = ctx.createRadialGradient(x, y, 0, x, y, r);
    puff.addColorStop(0, "rgba(255,255,255,0.92)");
    puff.addColorStop(0.5, "rgba(255,255,255,0.42)");
    puff.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = puff;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return canvas;
}

/** A drifting deck of soft cloud billboards. */
export class CloudLayer {
  /** The group to add to the scene. */
  readonly group: THREE.Group;

  private readonly seed: number;
  private readonly texture: THREE.Texture;
  private readonly clouds: Cloud[] = [];
  private cellX = 0;
  private cellZ = 0;
  private tick = 0;

  constructor(seed: number) {
    this.seed = seed;
    this.group = new THREE.Group();
    this.group.name = "clouds";

    this.texture = new THREE.CanvasTexture(buildCloudCanvas());
    this.texture.colorSpace = THREE.SRGBColorSpace;

    // Start with the cell the world begins in, so the deck exists on the
    // very first frame. The first advance() moves it if the player is
    // somewhere else.
    this.populate(0, 0);

  }

  /**
   * Fill the cells around a world position.
   *
   * Each cell gets its own child stream of the world seed, forked by the
   * cell's coordinates, so the clouds in a cell are the same in every
   * client and in every replay, whatever order the cells are visited in.
   */
  private populate(cellX: number, cellZ: number): void {
    for (const cloud of this.clouds) {
      this.group.remove(cloud.sprite);
      cloud.material.dispose();
    }
    this.clouds.length = 0;

    for (let dz = -CELL_RADIUS; dz <= CELL_RADIUS; dz++) {
      for (let dx = -CELL_RADIUS; dx <= CELL_RADIUS; dx++) {
        const cx = cellX + dx;
        const cz = cellZ + dz;
        const rng = createRng(this.seed).fork(`clouds:${cx},${cz}`);
        const count = 1 + Math.floor(rng.nextFloat() * 2);
        for (let i = 0; i < count; i++) {
          const width = WIDTH_MIN + rng.nextFloat() * (WIDTH_MAX - WIDTH_MIN);
          const material = new THREE.SpriteMaterial({
            map: this.texture,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            // THE SCENE FOG MUST NOT TOUCH THE CLOUDS.
            //
            // The world's fog runs from FOG_NEAR (28) to FOG_FAR (60), and a
            // cloud deck at 88 to 100 is well beyond the far plane. With fog
            // enabled, the scene fog blends the cloud's colour all the way to
            // the sky colour, so the clouds render as nothing at all - a
            // perfectly clear sky, and a feature that looked broken.
            //
            // The deck does its OWN distance fade in advance(), which sets
            // the opacity on the same curve the fog uses. So a cloud reaches
            // zero opacity exactly at the fog distance and vanishes into the
            // sky cleanly, rather than being a flat decal of fog colour
            // sitting on the sky.
            fog: false,
            opacity: CLOUD_OPACITY,
          });
          const sprite = new THREE.Sprite(material);
          sprite.name = `cloud-${cx},${cz}-${i}`;
          sprite.scale.set(width, width * (0.42 + rng.nextFloat() * 0.26), 1);
          // The deck is always overhead, so a billboard must not be culled
          // out of existence when it leaves the frustum.
          sprite.frustumCulled = false;
          sprite.castShadow = false;
          sprite.receiveShadow = false;
          this.clouds.push({
            sprite,
            material,
            anchor: new THREE.Vector3(
              cx * CELL + rng.nextFloat() * CELL,
              ALTITUDE_MIN + rng.nextFloat() * (ALTITUDE_MAX - ALTITUDE_MIN),
              cz * CELL + rng.nextFloat() * CELL,
            ),
            amplitude: AMPLITUDE_MIN + rng.nextFloat() * (AMPLITUDE_MAX - AMPLITUDE_MIN),
            period: PERIOD_MIN + rng.nextFloat() * (PERIOD_MAX - PERIOD_MIN),
            phase: rng.nextFloat() * Math.PI * 2,
          });
          this.group.add(sprite);
        }
      }
    }

    // The renderer calls this for every object it draws, so the deck can
    // advance itself without the game loop knowing anything about clouds.
    const driver = this.clouds[0];
    if (driver) {
      driver.sprite.onBeforeRender = (_renderer, _scene, camera) => {
        this.tick += 1;
        this.advance(this.tick, camera.position);
      };
    }
  }

  /**
   * Place the deck for an observer at a given tick.
   *
   * The drift is a slow orbit around each cloud's anchor, driven by the
   * tick counter: no randomness is involved, so the sky is the same every
   * time the same world is played.
   */
  advance(
    tick: number,
    observer: { readonly x: number; readonly y: number; readonly z: number },
  ): void {
    const cellX = Math.floor(observer.x / CELL);
    const cellZ = Math.floor(observer.z / CELL);
    if (cellX !== this.cellX || cellZ !== this.cellZ) {
      this.cellX = cellX;
      this.cellZ = cellZ;
      this.populate(cellX, cellZ);
    }
    for (const cloud of this.clouds) {
      const phase = (tick / (cloud.period * FRAMES_PER_SECOND)) * Math.PI * 2 + cloud.phase;
      const x = cloud.anchor.x + Math.cos(phase) * cloud.amplitude;
      const y = cloud.anchor.y + Math.sin(phase * 0.6) * cloud.amplitude * 0.3;
      const z = cloud.anchor.z + Math.sin(phase) * cloud.amplitude;
      cloud.sprite.position.set(x, y, z);

      // The cloud's own distance fade.
      //
      // The HORIZONTAL distance, not the 3D one. The deck is 20 to 32 blocks
      // above the player's head, so the 3D distance is always at least 20 -
      // and using it meant every cloud started already half faded, and the
      // ones overhead were past the far plane and fully invisible. That is
      // why the sky had no clouds in it: the fade was killing them.
      //
      // The horizontal distance is what the player actually judges distance
      // by when they look at the sky, and it is what the world's fog is
      // tuned for.
      const horizontal = Math.hypot(x - observer.x, z - observer.z);
      const fog = (horizontal - FOG_NEAR) / (FOG_FAR - FOG_NEAR);
      cloud.material.opacity = CLOUD_OPACITY * (1 - Math.min(1, Math.max(0, fog)));
    }
  }

  /** Release the GPU resources the deck holds. */
  dispose(): void {
    for (const cloud of this.clouds) {
      this.group.remove(cloud.sprite);
      cloud.material.dispose();
    }
    this.clouds.length = 0;
    this.texture.dispose();
  }
}
