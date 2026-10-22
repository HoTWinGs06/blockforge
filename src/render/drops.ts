/**
 * BlockForge — the items lying on the ground.
 *
 * OWNERSHIP: RENDER/UI.
 *
 * When a block is broken it does not vanish: it becomes an item on the
 * ground that the player walks over to collect. The GAMEPLAY layer owns
 * that item - where it is, how long it lives, when it is picked up - and
 * this module DRAWS it. Without this, the mechanic was half-finished: the
 * player walked over an invisible item and the hotbar count went up, and
 * nothing was ever on screen.
 *
 * WHERE THE DATA COMES FROM
 * The gameplay layer's session hands out a list of views:
 * { id, x, y, z, block }. This module mirrors that shape as its OWN type
 * rather than importing it, because src/render/ must not import from
 * src/gameplay/ (the layering rule in docs/ARCHITECTURE.md). The two are
 * structurally identical, so the session's list is passed straight in.
 *
 * THE MESHES ARE REBUILT ON CHANGE, NOT EVERY FRAME
 * The list only changes when a block breaks or an item is collected, so
 * the meshes are created and destroyed on a DIFF of the ids - the id is
 * stable for the item's whole life, so it is the right key. The item's
 * POSITION still moves while it falls into the hole it was broken out of
 * (that animation is the gameplay layer's), so the position is written
 * every frame; only the geometry is rebuilt on a change.
 *
 * DETERMINISM
 * Nothing here reads a clock. The position comes from the session, which
 * derives it from the tick, and the spin runs off the renderer's frame
 * counter - which advances with the SAME fixed dt the session's tick runs
 * on, so it is in lockstep with the world clock rather than the wall
 * clock.
 */

import * as THREE from "three";
import type { BlockId } from "../core/types.js";
import { faceUv, getAtlasTexture } from "./textures.js";

/**
 * The edge length of a dropped item's cube, in blocks.
 *
 * A quarter of a block: big enough to read as an object on the ground,
 * small enough that the player can see the ground around it. The
 * gameplay layer's ITEM_SIZE is the same number - the item's centre rests
 * half of it above the surface it landed on.
 */
export const DROP_SIZE = 0.25;

/**
 * A dropped item, as the renderer sees it.
 *
 * This mirrors the gameplay layer's DroppedItemView field for field. It is
 * declared here rather than imported so that src/render/ keeps no import
 * edge to src/gameplay/; the shapes are identical, so the session's list
 * is assignable to this one.
 */
export interface DroppedItemView {
  /** The item's own id. Stable for the item's whole life. */
  readonly id: number;
  /** The item's centre in world space. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The block whose item this is. */
  readonly block: BlockId;
}

/** What the renderer can report about a drop it has drawn. */
export interface DropView {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The cube's edge length in blocks. */
  readonly size: number;
  /** The atlas cell the cube's texture comes from. */
  readonly minU: number;
  readonly maxU: number;
  readonly minV: number;
  readonly maxV: number;
}

/** How fast a drop spins, in radians per frame-counter step. */
const SPIN_STEP = 0.06;

/**
 * The dropped items in the world.
 *
 * Owns one mesh per item and one geometry per BLOCK KIND - two rubble
 * drops share the same cube, because the cube's UVs are the block's tile.
 */
export class DropRenderer {
  /** The group the drop meshes live in. Add it to the world scene. */
  readonly group = new THREE.Group();

  /** One material for every drop: the atlas, lit like the world. */
  private readonly material: THREE.MeshStandardMaterial;

  /** The cube geometry per block kind, built once and shared. */
  private readonly geometries = new Map<BlockId, THREE.BufferGeometry>();

  /** The live drop meshes, by item id. */
  private readonly meshes = new Map<number, THREE.Mesh>();

  constructor() {
    this.group.name = "blockforge-drops";
    // The same material the chunk meshes use, so a drop on the ground is
    // lit by the same sun and sits in the same fog as the world.
    this.material = new THREE.MeshStandardMaterial({
      map: getAtlasTexture(),
      roughness: 0.95,
      metalness: 0.0,
    });
  }

  /**
   * Show the items that are lying on the ground right now.
   *
   * The MESHES are created and destroyed only when the SET of item ids
   * changes - which is when a block breaks or an item is collected - and
   * the id is stable for the item's whole life, so it is the right key.
   * The POSITION is written on every call, because an item's position is
   * a pure function of the tick and it FALLS into the hole it was broken
   * out of: a drop that was placed at its first frame's position and
   * never moved would hang in mid-air for ever.
   */
  setItems(items: readonly DroppedItemView[]): void {
    const live = new Set<number>();
    for (const item of items) {
      live.add(item.id);
      let mesh = this.meshes.get(item.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.geometryFor(item.block), this.material);
        mesh.name = `drop:${item.id}`;
        this.group.add(mesh);
        this.meshes.set(item.id, mesh);
      }
      // The view's x/y/z is the item's CENTRE, so it is the mesh's origin.
      mesh.position.set(item.x, item.y, item.z);
    }
    // Anything that is no longer on the ground leaves the scene with it.
    for (const [id, mesh] of this.meshes) {
      if (live.has(id)) {
        continue;
      }
      this.group.remove(mesh);
      this.meshes.delete(id);
    }
  }

  /**
   * Spin the drops.
   *
   * `tick` is the renderer's frame counter, which advances once per
   * frame of the fixed-step game loop - the same clock the clouds drift
   * on. It is deliberately NOT a wall clock: the spin is a function of
   * how far the game has advanced, never of how long the tab has been
   * open.
   */
  update(tick: number): void {
    for (const [id, mesh] of this.meshes) {
      // Each drop starts at its own angle, so two items side by side do
      // not spin in lockstep like a pair of clock hands.
      mesh.rotation.y = tick * SPIN_STEP + id * 0.7;
    }
  }

  /** The drops that are drawn, for the browser tests to read. */
  views(): DropView[] {
    const out: DropView[] = [];
    for (const [id, mesh] of this.meshes) {
      const uv = this.uvBounds(mesh.geometry);
      out.push({
        id,
        x: mesh.position.x,
        y: mesh.position.y,
        z: mesh.position.z,
        size: DROP_SIZE,
        minU: uv.minU,
        maxU: uv.maxU,
        minV: uv.minV,
        maxV: uv.maxV,
      });
    }
    return out;
  }

  /** Release the GPU resources. */
  dispose(): void {
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh);
    }
    this.meshes.clear();
    for (const geometry of this.geometries.values()) {
      geometry.dispose();
    }
    this.geometries.clear();
    this.material.dispose();
  }

  /**
   * The cube for a block kind, built once.
   *
   * It is NOT a BoxGeometry. BoxGeometry lays its UVs out by vertex GROUP
   * rather than by face, so writing "four corners per face" into it
   * scatters one tile's four UVs across four different faces - and the
   * result is a cube wearing the WHOLE ATLAS, one tile per face. A
   * purpose-built cube gets the UVs right by construction: six quads,
   * each with four vertices, each vertex taking its corner from
   * faceUv(block) - the same function the world meshes use, so a drop
   * shows exactly the texture the block it came from has.
   */
  private geometryFor(block: BlockId): THREE.BufferGeometry {
    const cached = this.geometries.get(block);
    if (cached) {
      return cached;
    }
    const h = DROP_SIZE / 2;
    const corners = faceUv(block);

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
        if (!p) {
          continue;
        }
        positions.push(p[0], p[1], p[2]);
        normals.push(face.n[0], face.n[1], face.n[2]);
        const c = corners[corner];
        uvs.push(c ? c[0] : 0, c ? c[1] : 0);
      }
      // Two triangles per quad, wound counter-clockwise.
      indices.push(base + 0, base + 1, base + 2, base + 0, base + 2, base + 3);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    this.geometries.set(block, geometry);
    return geometry;
  }

  /** The atlas cell a geometry's texture comes from. */
  private uvBounds(geometry: THREE.BufferGeometry): {
    minU: number;
    maxU: number;
    minV: number;
    maxV: number;
  } {
    const attribute = geometry.getAttribute("uv");
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
}
