/**
 * BlockForge — application entry point.
 *
 * M1 scope: a first-person voxel sandbox. The world comes from the ENGINE
 * agent (src/core + src/engine); the shell around it - camera, input, HUD,
 * block break/place - is the RENDER/UI layer.
 *
 * ORIGINALITY: nothing here uses a Mojang/Microsoft asset, name or texture.
 * Textures are generated procedurally (src/render/textures.ts) and sounds are
 * synthesised (src/render/audio.ts).
 */

import { BlockId, type ChunkKey, type PlayerState, type Vec3 } from "./core/types.js";
import { CHUNK_SIZE_Y } from "./core/constants.js";
import {
  moveWithCollisions,
  stepPhysics,
  type SolidWorld,
} from "./core/physics.js";
import { Hud, SoundBoard, TitleScreen, WorldRenderer, chunkKeyOf } from "./render/index.js";

/**
 * The shape the render layer needs from the engine.
 *
 * This is the renderer's own seam, NOT a change to the frozen contract. The
 * engine's ChunkStore satisfies it as it stands.
 */
export interface EngineBridge {
  /** The block at a world position, or BlockId.Air if unknown. */
  blockAt(x: number, y: number, z: number): BlockId;
  /** Replace a block at a world position. */
  setBlock(x: number, y: number, z: number, id: BlockId): void;
  /** True if the position is a solid block. */
  isSolid(x: number, y: number, z: number): boolean;
  /** Ask the engine to (re)build the mesh for a chunk and hand it to the renderer. */
  syncChunk(key: ChunkKey, renderer: WorldRenderer): void;
  /** The chunks that currently need syncing. */
  pendingChunks(): ChunkKey[];
  /**
   * Optional: tell the engine where the player is, so it can stream chunks.
   * The renderer calls this every frame; an engine that does not stream can
   * ignore it.
   */
  updateView?(playerX: number, playerZ: number, renderer: WorldRenderer): void;
}

/** How many hotbar slots the HUD shows. */
const HOTBAR_SLOTS = 9;
const EYE_HEIGHT = 1.62;
const WALK_SPEED = 4.5;
const JUMP_SPEED = 8.0;
const REACH = 6.0;

/** The running game. */
export class Game {
  private readonly renderer: WorldRenderer;
  private readonly hud: Hud;
  private readonly sound: SoundBoard;
  private readonly title: TitleScreen;
  private readonly engine: EngineBridge;

  private position: Vec3 = { x: 0.5, y: 90, z: 0.5 };
  private velocity: Vec3 = { x: 0, y: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private onGround = false;

  private readonly keys = new Set<string>();
  private selectedSlot = 0;
  private health = 20;
  private hunger = 20;
  private message: string | null = null;
  private readonly lookDelta = { x: 0, y: 0 };
  private dragging = false;
  private running = false;

  constructor(canvas: HTMLCanvasElement, engine: EngineBridge) {
    this.engine = engine;
    this.renderer = new WorldRenderer(canvas);
    this.hud = new Hud();
    this.sound = new SoundBoard();
    this.title = new TitleScreen();
    this.bindInput(canvas);

    // The title screen's "click to play" is what captures the pointer. The
    // operator reported that mouse-look felt broken on first use, and the
    // reason was that the game dropped the player in with the mouse NOT
    // captured and nothing told them to click. Now the first click is the
    // play button, so the first thing the player does visibly works.
    this.title.root.addEventListener("click", () => {
      this.sound.unlock();
      void canvas.requestPointerLock?.();
    });
  }

  /** The player's current state, in the frozen PlayerState shape. */
  get playerState(): PlayerState {
    return {
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      yaw: this.yaw,
      pitch: this.pitch,
      onGround: this.onGround,
      health: 20,
      hunger: 20,
    };
  }

  /** Start the render loop. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.syncChunks();
    this.title.setReady("world ready");
    const loop = (): void => {
      if (!this.running) {
        return;
      }
      this.step();
      this.renderer.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Stop the render loop. */
  stop(): void {
    this.running = false;
  }

  /** Advance the simulation by one frame. */
  step(): void {
    const dt = 1 / 60;

    // No movement or looking until the player has pressed play. The game
    // still renders, so the title screen has a live world behind it.
    if (this.title.hasStarted && !this.hud.menuOpen) {
      this.applyLook();
      this.applyMove(dt);
    }
    this.applyGravity(dt);

    this.renderer.applyPlayer(this.playerState);
    this.updateView();
    this.updateHud();
  }

  private applyLook(): void {
    const sensitivity = this.hud.sensitivity;
    if (this.lookDelta.x !== 0 || this.lookDelta.y !== 0) {
      this.yaw -= this.lookDelta.x * sensitivity * 0.002;
      this.pitch -= this.lookDelta.y * sensitivity * 0.002;
      const limit = Math.PI / 2 - 0.001;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
      this.lookDelta.x = 0;
      this.lookDelta.y = 0;
    }
  }

  private applyMove(dt: number): void {
    let forward = 0;
    let strafe = 0;
    if (this.keys.has("KeyW")) forward += 1;
    if (this.keys.has("KeyS")) forward -= 1;
    if (this.keys.has("KeyD")) strafe += 1;
    if (this.keys.has("KeyA")) strafe -= 1;

    const len = Math.hypot(forward, strafe);
    if (len === 0) {
      this.velocity = { ...this.velocity, x: 0, z: 0 };
      return;
    }
    forward /= len;
    strafe /= len;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const speed = this.keys.has("ShiftLeft") ? WALK_SPEED * 1.8 : WALK_SPEED;
    const vx = (-sin * forward + cos * strafe) * speed;
    const vz = (-cos * forward - sin * strafe) * speed;

    // Horizontal movement uses the engine's axis-separated move so the player
    // slides along walls instead of sticking to them.
    const world = this.solidWorld();
    const xResult = moveWithCollisions(
      this.position,
      this.velocity,
      { x: vx * dt, y: 0, z: 0 },
      world,
    );
    this.position = xResult.position;
    const zResult = moveWithCollisions(
      this.position,
      { ...xResult.velocity, x: vx, z: vz },
      { x: 0, y: 0, z: vz * dt },
      world,
    );
    this.position = zResult.position;
    this.velocity = { ...zResult.velocity, x: vx, z: vz };
  }

  /**
   * Apply gravity and advance the player.
   *
   * This uses the ENGINE's tested physics module, not a private copy. An
   * earlier version of this file carried its own collides()/moveWithCollisions
   * implementation, which meant the module that was designed, documented and
   * tested for this was not the code that actually moved the player - the two
   * drifted, and src/core/physics.ts sat at 5.68% coverage while the game ran.
   */
  private applyGravity(dt: number): void {
    if (this.keys.has("Space") && this.onGround) {
      this.velocity = { ...this.velocity, y: JUMP_SPEED };
      this.onGround = false;
    }
    const result = stepPhysics(this.position, this.velocity, dt, this.solidWorld());
    this.position = result.position;
    this.velocity = result.velocity;
    this.onGround = result.onGround;
  }

  /** The engine's physics needs a world to collide against. */
  private solidWorld(): SolidWorld {
    return {
      isSolid: (x: number, y: number, z: number): boolean => this.engine.isSolid(x, y, z),
    };
  }

  /** Break or place the block the player is aiming at. */
  private act(place: boolean): void {
    const hit = this.pickBlock();
    if (!hit) {
      this.sound.play("deny");
      return;
    }
    if (place) {
      this.engine.setBlock(hit.x, hit.y, hit.z, BlockId.Rubble);
      this.sound.play("place");
    } else {
      this.engine.setBlock(hit.x, hit.y, hit.z, BlockId.Air);
      this.sound.play("break");
    }
    this.engine.syncChunk(chunkKeyOf(hit.x, hit.y, hit.z), this.renderer);
  }

  /** Ray-march from the eye along the look direction and return the first solid block. */
  private pickBlock(): { x: number; y: number; z: number } | null {
    const dir = this.lookDirection();
    const ox = this.position.x;
    const oy = this.position.y + EYE_HEIGHT;
    const oz = this.position.z;
    const step = 0.05;
    for (let d = 0; d <= REACH; d += step) {
      const x = Math.floor(ox + dir.x * d);
      const y = Math.floor(oy + dir.y * d);
      const z = Math.floor(oz + dir.z * d);
      if (y < 0 || y >= CHUNK_SIZE_Y) {
        continue;
      }
      if (this.engine.isSolid(x, y, z)) {
        return { x, y, z };
      }
    }
    return null;
  }

  private lookDirection(): Vec3 {
    const cosPitch = Math.cos(this.pitch);
    return {
      x: -Math.sin(this.yaw) * cosPitch,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cosPitch,
    };
  }

  private updateHud(): void {
    const hit = this.pickBlock();
    if (hit) {
      this.renderer.showHighlight(hit.x, hit.y, hit.z);
    } else {
      this.renderer.hideHighlight();
    }
    this.hud.update({
      targetedBlock: hit ? this.engine.blockAt(hit.x, hit.y, hit.z) : null,
      targetedPosition: hit,
      // Nine slots, always. The ITEMS are M3 (GAMEPLAY) content and are empty
      // for now, but the hotbar SHELL is M1: the operator reported "no
      // inventory bar", and a bar made of nothing is not a bar. Empty slots
      // still read as slots.
      hotbar: Array.from({ length: HOTBAR_SLOTS }, () => ({ id: "", count: 0 })),
      selectedSlot: this.selectedSlot,
      health: this.health,
      hunger: this.hunger,
      message: this.message,
    });
  }

  /** Rebuild the meshes for every chunk the engine says is out of date. */
  private syncChunks(): void {
    for (const key of this.engine.pendingChunks()) {
      this.engine.syncChunk(key, this.renderer);
    }
  }

  /**
   * Keep the loaded region centred on the player.
   *
   * The world used to be a fixed five-chunk plus shape, so walking off it put
   * the player in empty space with no ground, no collision and therefore no
   * jump. The engine now streams chunks around the player instead.
   */
  private updateView(): void {
    this.engine.updateView?.(this.position.x, this.position.z, this.renderer);
    this.syncChunks();
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    window.addEventListener("keydown", (event) => {
      if (event.code === "Escape") {
        this.hud.setMenuOpen(!this.hud.menuOpen);
        return;
      }
      if (event.code === "KeyF" || event.code === "Enter") {
        this.act(false);
        return;
      }
      if (event.code === "KeyR") {
        this.act(true);
        return;
      }
      // Number keys select a hotbar slot.
      if (/^Digit[1-9]$/.test(event.code)) {
        this.selectedSlot = Number(event.code.slice(-1)) - 1;
        return;
      }
      this.keys.add(event.code);
    });
    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
    });
    canvas.addEventListener("mousedown", (event) => {
      if (event.button === 0) {
        this.dragging = true;
        this.sound.unlock();
        this.act(false);
      } else if (event.button === 2) {
        this.act(true);
      }
    });
    window.addEventListener("mouseup", () => {
      this.dragging = false;
    });
    window.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement) {
        this.lookDelta.x += event.movementX;
        this.lookDelta.y += event.movementY;
      }
    });
    canvas.addEventListener("click", () => {
      this.sound.unlock();
      if (document.pointerLockElement !== canvas) {
        void canvas.requestPointerLock?.();
      }
    });
    window.addEventListener("resize", () => {
      this.renderer.resize(canvas.clientWidth, canvas.clientHeight);
    });
  }

  /** True while the pointer is held down (used by the smoke test). */
  get isDragging(): boolean {
    return this.dragging;
  }

  /** Exposed for the smoke test and for debugging. */
  get debugPosition(): Vec3 {
    return { ...this.position };
  }
}

/** Mount the game onto a canvas. */
export function mountGame(canvas: HTMLCanvasElement, engine: EngineBridge): Game {
  const game = new Game(canvas, engine);
  game.start();
  return game;
}
