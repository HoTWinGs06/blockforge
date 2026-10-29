/**
 * BlockForge — the first-person viewmodel.
 *
 * T71: "no player hand visible". There was no viewmodel at all. This is it:
 * a small mesh parented to the CAMERA, textured with the procedural block
 * atlas, holding whatever the player has selected in the hotbar.
 *
 * TOOL VIEWMODELS (tools-in-hand, mining): a hand that can only show a block
 * is a hand that ignores the game's own identity — the whole point of the
 * frozen tool table is that a mattock, a billhook, a trowel and a maul are
 * DIFFERENT THINGS. Selecting one of them used to leave the previous block
 * hanging in the air, which read as broken. This module now builds a real 3D
 * tool out of Three.js primitives, one shape per kind, tinted by the SAME
 * tier palette the 2D hotbar icons use (TIER_PALETTES in toolIcons.ts), so
 * what the player holds in the world is the tool they see. Nothing here is
 * copied from any existing game's artwork: every part is a box, torus or
 * plain colour defined in this file.
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
 *    be a smear of sky colour. Every material here has `fog: false`, and
 *    the viewmodel is lit by its own lights rather than the world's.
 *
 * 3. IT DOES NOT CAST OR RECEIVE SHADOWS. Nothing in this project has
 *    shadow maps, but the flag is explicit so that adding them later does not
 *    suddenly give the player a shadow on their own hand.
 *
 * The motion: T72's walk bob driven by speed, and a swing. A single swing
 * fires when the act button is pressed or a block breaks; while a break hold
 * is RUNNING (main.ts calls setSwinging(true) every frame it is mining) the
 * swing repeats in a loop, so the player visibly keeps striking at the block
 * for as long as they hold the button — not one swing at the very end.
 * Everything is still perfectly STILL when the player is standing still: the
 * e2e hand guard reads the hand's pixels across two frames, and any idle
 * animation would make the hand indistinguishable from the moving world.
 */

import * as THREE from "three";
import { BlockId } from "../core/types.js";
import type { ToolSpec } from "../core/types.js";
import { getAtlasTexture, faceUv, TILE_PX } from "./textures.js";
import { TIER_PALETTES } from "./toolIcons.js";

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
 * Tools are held a little further out than the block cube, and one scale
 * shrinks every tool part.
 *
 * The tool parts are written in plain tool numbers - a handle is about a
 * unit tall - so the tables below stay readable. TOOL_SCALE turns those
 * into viewmodel units, where the held block cube is about 0.11 across.
 */
const TOOL_SCALE = 0.62;

/** The bare hand's skin colour: empty-hand mode, and the fist gripping a tool. */
const FIST_COLOR = "#c9a077";

/**
 * How long one swing takes, per tool kind.
 *
 * A maul is heavy and slow, a sabre is a light defensive blade. Numbers
 * chosen so each cadence FEELS like the tool's contract row: heavy kinds
 * break slowly, light ones quickly.
 */
const SWING_SECONDS_BY_KIND: Readonly<Record<string, number>> = {
  mattock: 0.3,
  billhook: 0.26,
  trowel: 0.24,
  maul: 0.4,
  sabre: 0.2,
};

/**
 * The eight corners of a box, offset at (ox, oy, oz) in group space.
 *
 * Used by the hand probe below, which reports where the HAND's pixels are.
 */
function boxCorners(
  hx: number,
  hy: number,
  hz: number,
  ox: number,
  oy: number,
  oz: number,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [-hx, hx]) {
    for (const y of [-hy, hy]) {
      for (const z of [-hz, hz]) {
        out.push(new THREE.Vector3(x + ox, y + oy, z + oz));
      }
    }
  }
  return out;
}

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

  /**
   * What the key light points at.
   *
   * It has to be a real object inside the viewmodel's own frame: a
   * DirectionalLight aims from its position at its target, and the default
   * target sits at the world origin - which would aim the hand's light at
   * the ground eighty blocks below the player.
   */
  private readonly keyTarget: THREE.Object3D;

  private readonly fillLight: THREE.AmbientLight;

  /** The block kind the hand is holding. */
  private heldBlock: BlockId = BlockId.Rubble;

  /**
   * What the hand is showing: the block cube, a tool model, or the bare
   * fist. Exactly ONE of those is on screen at a time; the old code left
   * the previous block hanging in the air whenever a tool was selected.
   */
  private mode: "block" | "tool" | "empty" = "block";

  /** The tool parts, in their own group so one visible flag switches them. */
  private readonly toolGroup: THREE.Group;

  /** Everything the tool build created, for disposal. */
  private toolGeometries: THREE.BufferGeometry[] = [];
  private toolMaterials: THREE.MeshLambertMaterial[] = [];

  /** The bare fist: also the hand that grips a tool. */
  private readonly fistMesh: THREE.Mesh;
  private readonly fistGeometry: THREE.BoxGeometry;
  private readonly fistMaterial: THREE.MeshLambertMaterial;

  /** Which tool the parts were built for, so selecting it twice is free. */
  private heldToolId: string | null = null;

  /** How long the current tool's swing takes, in seconds. */
  private swingSeconds = SWING_DURATION;

  /**
   * TRUE while a break hold is RUNNING: the swing then repeats in a loop.
   * FALSE always, when idle - the hand is perfectly still.
   */
  private swinging = false;

  /** The canvas size in CSS pixels, so the hand can report where it is. */
  private viewportWidth = 1;
  private viewportHeight = 1;

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

    // THE FIST: a hard-edged skin-coloured box. It shows when the player
    // holds nothing, and it is also the hand that wraps a tool's grip.
    // NOTE: it is a SEPARATE mesh from the atlas cube above, which keeps
    // its atlas material and geometry even while hidden - the browser
    // tests read that cube's UVs from outside this module, and a fist with
    // an atlas material would put the WHOLE ATLAS on the hand.
    this.fistGeometry = new THREE.BoxGeometry(0.11, 0.11, 0.11);
    this.fistMaterial = new THREE.MeshLambertMaterial({
      color: FIST_COLOR,
      // Same rule as the cube: no fog. This close to the eye, fog would
      // wash the fist out to the sky's colour (rule 2 in the header).
      fog: false,
    });
    this.fistMesh = new THREE.Mesh(this.fistGeometry, this.fistMaterial);
    this.fistMesh.castShadow = false;
    this.fistMesh.receiveShadow = false;
    this.fistMesh.frustumCulled = false;
    this.fistMesh.visible = false;
    this.group.add(this.fistMesh);

    // THE TOOL: its parts are built into this group by rebuildTool(), one
    // shape per kind, painted with the tier palette the hotbar icons use.
    // The group is scaled once so every part below is written in plain
    // tool numbers.
    this.toolGroup = new THREE.Group();
    this.toolGroup.scale.setScalar(TOOL_SCALE);
    this.toolGroup.visible = false;
    this.group.add(this.toolGroup);

    // The hand gets its own lights. Using the world's sun would make the
    // hand go dark when the player faces away from the sun, which looks
    // broken rather than atmospheric.
    this.keyLight = new THREE.DirectionalLight("#fff3d6", 2.4);
    this.keyLight.position.set(0.6, 1, 0.8);
    this.group.add(this.keyLight);

    // THE KEY LIGHT'S TARGET MUST LIVE IN THE VIEWMODEL'S OWN FRAME.
    //
    // A DirectionalLight points from its position at its target, and
    // three.js's default target is an Object3D that is never added to the
    // scene graph - so its world position stays at the WORLD ORIGIN.
    //
    // The light is a child of the camera, so its world position rides
    // along with the camera while the target stays at (0,0,0) - eighty-odd
    // blocks below the player. The light therefore shone almost straight
    // DOWN in world space, and the hand was re-lit every time the player
    // looked around. Measured on the broken tree: the face turned toward
    // the camera had N.L = 0.02 and rendered black ([30,30,30]), the same
    // face rendered [90,94,98] a moment later at another camera pitch,
    // and only 0.8% of the hand's pixels were unchanged between the two
    // poses. A first-person hand has to look the same wherever the player
    // is looking.
    //
    // Parenting the target to the viewmodel group fixes the direction in
    // the hand's own frame, so the lighting is constant from here on.
    this.keyTarget = new THREE.Object3D();
    this.keyTarget.position.set(0, 0, 0);
    this.group.add(this.keyTarget);
    this.keyLight.target = this.keyTarget;

    // THE FILL MUST NOT DEPEND ON WHERE THE HAND IS IN THE WORLD.
    //
    // A HemisphereLight gets its sky/ground axis from its own WORLD
    // POSITION, so a fill parented to the camera swings as the camera
    // turns: the same face of the hand came out [93,96,100] at one camera
    // pitch and [96,101,107] at another. A viewmodel has to look the same
    // wherever the player is looking.
    //
    // An AmbientLight has no direction at all, so it cannot leak the
    // camera's pose into the hand's shading. The modelling comes from the
    // key light, whose N.L across the three visible faces is 0.57, 0.42
    // and 0.71 - the cube still reads as a solid block.
    this.fillLight = new THREE.AmbientLight("#b9c7d6", 1.5);
    this.group.add(this.fillLight);

    this.group.position.copy(this.basePosition);
    this.group.rotation.set(0.25, -0.55, 0.1);
  }

  /**
   * The hand's screen-space bounding box, in CSS pixels.
   *
   * The hand is a child of the CAMERA, so its place on the screen depends
   * only on the projection and the viewmodel's fixed camera-space
   * transform - NOT on where the player is looking. A test can therefore
   * ask where the hand actually is and sample ITS pixels, instead of
   * guessing at a region that is mostly background.
   *
   * The box covers a HAND PROBE, not the whole model (see screenCorners):
   * a box's worth of pixels has to be MOSTLY static hand pixels, and a
   * whole-tool box would be mostly background.
   *
   * Returned in CSS pixels relative to the canvas, which is what
   * page.screenshot() and Playwright's boundingBox() both use.
   */
  get screenBounds(): { x: number; y: number; width: number; height: number } | null {
    const parent = this.group.parent;
    if (!parent || !(parent instanceof THREE.Camera)) {
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of this.screenCorners()) {
      // The group is a child of the camera, so the group's LOCAL matrix
      // takes a corner straight into camera space - and camera space IS
      // view space, which is what the projection matrix expects. Going
      // through the world matrix instead would read a matrixWorld that
      // the renderer may not have refreshed yet.
      const p = corner.applyMatrix4(this.group.matrix).applyMatrix4(parent.projectionMatrix);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    // NDC (-1..1) to pixels.
    const toX = (v: number): number => ((v + 1) / 2) * this.viewportWidth;
    const toY = (v: number): number => ((1 - v) / 2) * this.viewportHeight;
    const x = toX(minX);
    const y = toY(maxY);
    return {
      x: Math.floor(x),
      y: Math.floor(y),
      width: Math.ceil(toX(maxX) - x),
      height: Math.ceil(toY(minY) - y),
    };
  }

  /**
   * The hand's eight corners, in the viewmodel group's own frame.
   *
   * The cube's size is fixed, so this is the same shape every frame.
   */
  private handCorners(): THREE.Vector3[] {
    const h = this.size / 2;
    const corners: THREE.Vector3[] = [];
    for (const x of [-h, h]) {
      for (const y of [-h, h]) {
        for (const z of [-h, h]) {
          corners.push(new THREE.Vector3(x, y, z));
        }
      }
    }
    return corners;
  }

  /**
   * The corners the reported screen-box must cover, for the CURRENT mode.
   *
   * Block mode: the block cube itself. Tool and empty mode: a HAND PROBE -
   * the fist box plus a stub of the grip, NOT the full tool.
   *
   * WHY NOT THE FULL TOOL: the e2e guard samples the reported box and
   * checks that it is mostly stationary hand pixels (> 0.5 of the box).
   * A whole tool's bounds are a tall thin shape - head high up there,
   * fist down here - whose corners and sides are mostly BACKGROUND, so
   * the guard would fail its own density check against a model that is
   * doing nothing wrong. The probe is where the hand pixels actually
   * cluster, which keeps the guard measuring the hand while the full
   * model is free to sweep across the screen.
   */
  private screenCorners(): THREE.Vector3[] {
    if (this.mode === "block") {
      return this.handCorners();
    }
    return this.probeCorners();
  }

  /**
   * The fist + grip-stub probe, in the group's own frame.
   *
   * The fist sits at the origin; the stub rises from inside it to the top
   * of the wrapped grip. Their projected union is a dense block: the
   * corner pixels are background (the guard expects that), the interior
   * is fist and handle wood.
   */
  private probeCorners(): THREE.Vector3[] {
    if (this.mode === "empty") {
      return boxCorners(0.055, 0.055, 0.055, 0, 0, 0);
    }
    return [
      ...boxCorners(0.055, 0.055, 0.055, 0, 0, 0),
      ...boxCorners(0.03, 0.13, 0.03, 0, 0.065, 0),
    ];
  }

  /**
   * The size of the canvas the hand is drawn on, in CSS pixels.
   *
   * Set by the renderer, which owns the canvas.
   */
  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  /**
   * Set the block the hand is holding.
   *
   * The UVs are set to the atlas cell for that block's side face, so the
   * hand shows the texture of the thing it is holding. Switching INTO
   * block mode first makes the routing total: whatever was on screen
   * before (a tool, the fist), the cube is the one thing that shows now.
   */
  setHeldBlock(id: BlockId): void {
    this.mode = "block";
    this.mesh.visible = true;
    this.toolGroup.visible = false;
    this.fistMesh.visible = false;
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

  /**
   * Hold a tool: the fist grips a 3D model built for its kind and tier.
   *
   * main.ts calls this with the session's held stack translated into the
   * frozen contract's ToolSpec. Selecting the SAME tool twice is free (no
   * rebuild); a different one tears the old parts down and builds fresh.
   * Nothing here copies any existing game's model: every part is a box,
   * a torus or a plain colour defined in rebuildTool().
   */
  setHeldTool(spec: ToolSpec): void {
    this.mode = "tool";
    this.mesh.visible = false;
    this.toolGroup.visible = true;
    this.fistMesh.visible = true;
    this.swingSeconds = SWING_SECONDS_BY_KIND[spec.kind] ?? SWING_DURATION;
    if (spec.id === this.heldToolId) {
      return;
    }
    this.heldToolId = spec.id;
    this.rebuildTool(spec);
  }

  /**
   * Hold nothing: the bare fist.
   *
   * An empty selected slot used to leave the last block floating in the
   * air. A hand that cannot be empty is not a hand.
   */
  setHeldEmpty(): void {
    this.mode = "empty";
    this.mesh.visible = false;
    this.toolGroup.visible = false;
    this.fistMesh.visible = true;
  }

  /**
   * Rebuild the tool parts for one spec.
   *
   * THE SHAPES AND WHERE THEY SIT: all parts are written in TOOL-LOCAL
   * coordinates - Y up, the fist at the origin, the handle rising out of
   * it - and the whole toolGroup is scaled by TOOL_SCALE. The pal colours
   * are the SAME tier palette the 2D hotbar icons use (TIER_PALETTES in
   * toolIcons.ts), so the tool in the hand is the tier the player sees in
   * the hotbar. A lumencrystal head carries the palette's glow as its
   * emissive, which is what "lumencrystal" means.
   *
   *   grip:   a short box the fist wraps (height 0.3, half-width 0.105)
   *   shaft:  a thinner box rising to the head (top at Y≈0.95)
   *   head:   kind-specific, at the shaft top:
   *     mattock   - a CROSSBAR through the top plus two pick prongs
   *     billhook  - a curved blade: a torus arc swept up from the top
   *     trowel    - a broad flat plate tilted forward
   *     maul      - one heavy striking head, crosswise
   *     sabre     - a light defensive blade with a crossguard (there is
   *                 no sabre in TOOL_SPECS; the shape is a fallback for
   *                 whatever a dropped sabre item turns out to be)
   */
  private rebuildTool(spec: ToolSpec): void {
    for (const geometry of this.toolGeometries) {
      geometry.dispose();
    }
    for (const material of this.toolMaterials) {
      material.dispose();
    }
    this.toolGeometries.length = 0;
    this.toolMaterials.length = 0;
    const old = [...this.toolGroup.children];
    for (const part of old) {
      this.toolGroup.remove(part);
    }

    const pal = TIER_PALETTES[spec.tier] ?? TIER_PALETTES.timber;
    if (!pal) {
      return;
    }
    const headMat = this.toolMaterial(pal.head, pal.glow);
    const handleMat = this.toolMaterial(pal.handle);
    const shineMat = this.toolMaterial(pal.highlight);

    // The grip (the fist wraps this) and the shaft out of it. Every kind
    // shares this handle; the tier decides its colours.
    this.addBox(0.105, 0.3, 0.105, handleMat, 0, 0, 0);
    this.addBox(0.075, 0.9, 0.075, handleMat, 0, 0.5, 0);
    // A highlight stripe flush on the shaft's front face.
    this.addBox(0.05, 0.55, 0.025, shineMat, 0, 0.52, 0.045);

    if (spec.kind === "mattock") {
      // Crossbar: through the shaft top, wide ahead. Prongs: the pick's
      // two points, one each end, angled down and out.
      this.addBox(0.95, 0.14, 0.11, headMat, 0, 0.92, 0);
      this.addBox(0.1, 0.26, 0.11, headMat, -0.42, 1.13, 0, 0, 0, 0.35);
      this.addBox(0.1, 0.26, 0.11, headMat, 0.42, 1.13, 0, 0, 0, -0.35);
    } else if (spec.kind === "billhook") {
      // The hook: an arc swept up and over from the shaft top. A small
      // crossguard under the arc reads as the blade's shoulder.
      const arc = new THREE.TorusGeometry(0.5, 0.07, 8, 16, 2.6);
      this.addPart(arc, headMat, 0.06, 0.78, 0, 0, 0, 0.55);
      this.addBox(0.3, 0.08, 0.09, headMat, 0, 0.88, 0);
    } else if (spec.kind === "trowel") {
      // The plate: broad, flat, tilted forward to scoop. A narrow lip
      // along its leading edge gives the plate a real edge to catch light.
      this.addBox(0.5, 0.05, 0.42, headMat, 0, 0.98, 0.04, 0.5);
      this.addBox(0.5, 0.07, 0.05, headMat, 0, 0.98, -0.2);
    } else if (spec.kind === "maul") {
      // The head: one heavy block crosswise, close to the shaft top. The
      // striking faces get the shine stripe so the weight reads forward.
      this.addBox(0.34, 0.34, 0.62, headMat, 0, 0.95, 0);
      this.addBox(0.36, 0.36, 0.06, shineMat, 0, 0.95, 0.31);
      this.addBox(0.36, 0.36, 0.06, shineMat, 0, 0.95, -0.31);
    } else {
      // Defensive default (a sabre). A light blade standing proud of the
      // handle with a crossguard and a pommel.
      this.addBox(0.09, 0.8, 0.14, shineMat, 0.03, 1.05, 0, 0, 0, 0.18);
      this.addBox(0.3, 0.07, 0.1, headMat, 0, 0.86, 0);
      this.addBox(0.12, 0.1, 0.12, headMat, 0, 0.08, 0);
    }
  }

  /** One tool material, pushed onto the disposal list. `glow` = emissive. */
  private toolMaterial(color: string, glow?: string): THREE.MeshLambertMaterial {
    const material = new THREE.MeshLambertMaterial({
      color,
      // Same rule as the atlas cube: no fog, ever.
      fog: false,
    });
    if (glow !== undefined) {
      material.emissive = new THREE.Color(glow);
      material.emissiveIntensity = 0.85;
    }
    this.toolMaterials.push(material);
    return material;
  }

  /**
   * Add one part mesh in TOOL-LOCAL coordinates, optionally rotated.
   *
   * The part's geometry goes on the disposal list; every tool build owns
   * its own geometries, so a tier change cannot leak.
   */
  private addPart(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): THREE.Mesh {
    this.toolGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    this.toolGroup.add(mesh);
    return mesh;
  }

  /** Add one box part: width/height/depth in tool-local units. */
  private addBox(
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): void {
    this.addPart(new THREE.BoxGeometry(w, h, d), material, x, y, z, rx, ry, rz);
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
   * Start one break swing.
   *
   * Called when a block breaks and when the act (place/use) button fires:
   * the hand swings forward and comes back.
   */
  swingNow(): void {
    this.swing = 0;
  }

  /**
   * Drive the swing LOOP.
   *
   * main.ts calls this with TRUE for every frame a break hold is running
   * and FALSE when it stops (button released, looked away, block broke).
   * TRUE keeps the hand striking until the hold ends; FALSE lets the
   * current swing settle and then the hand is perfectly still, which is
   * what the e2e guard requires when the player is idle.
   */
  setSwinging(active: boolean): void {
    this.swinging = active;
    if (active && this.swing >= 1) {
      this.swing = 0;
    }
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

    // The swing: a quick arc forward and back, easing out. While a break
    // hold is running (setSwinging), every completed swing immediately
    // restarts: the player keeps striking for as long as they hold the
    // button, not once at the very end. The arc's length is per tool -
    // SWING_SECONDS_BY_KIND gives a maul its weighted cadence.
    let swingZ = 0;
    let swingPitch = 0;
    if (this.swinging && this.swing >= 1) {
      this.swing = 0;
    }
    if (this.swing < 1) {
      this.swing = Math.min(1, this.swing + dt / this.swingSeconds);
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
    // The tool build and the fist own their own geometries and materials.
    for (const geometry of this.toolGeometries) {
      geometry.dispose();
    }
    for (const material of this.toolMaterials) {
      material.dispose();
    }
    this.toolGeometries.length = 0;
    this.toolMaterials.length = 0;
    this.fistGeometry.dispose();
    this.fistMaterial.dispose();
  }
}
