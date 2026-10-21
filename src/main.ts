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

import { BlockId, type ChunkKey, type PlayerState } from "./core/types.js";
import { CHUNK_SIZE_Y } from "./core/constants.js";
import { Hud, SoundBoard, WorldRenderer, chunkKeyOf } from "./render/index.js";

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
}

const PLAYER_RADIUS = 0.3;
const PLAYER_HEIGHT = 1.8;
const EYE_HEIGHT = 1.62;
const WALK_SPEED = 4.5;
const JUMP_SPEED = 8.0;
const GRAVITY = 24.0;
const REACH = 6.0;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The running game. */
export class Game {
  private readonly renderer: WorldRenderer;
  private readonly hud: Hud;
  private readonly sound: SoundBoard;
  private readonly engine: EngineBridge;

  private readonly position: Vec3 = { x: 0.5, y: 90, z: 0.5 };
  private readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private onGround = false;

  private readonly keys = new Set<string>();
  private readonly lookDelta = { x: 0, y: 0 };
  private dragging = false;
  private running = false;

  constructor(canvas: HTMLCanvasElement, engine: EngineBridge) {
    this.engine = engine;
    this.renderer = new WorldRenderer(canvas);
    this.hud = new Hud();
    this.sound = new SoundBoard();
    this.bindInput(canvas);
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

    if (!this.hud.menuOpen) {
      this.applyLook();
      this.applyMove(dt);
    }
    this.applyGravity(dt);

    this.renderer.applyPlayer(this.playerState);
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
      this.velocity.x = 0;
      this.velocity.z = 0;
      return;
    }
    forward /= len;
    strafe /= len;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const speed = this.keys.has("ShiftLeft") ? WALK_SPEED * 1.8 : WALK_SPEED;
    this.velocity.x = (-sin * forward + cos * strafe) * speed;
    this.velocity.z = (-cos * forward - sin * strafe) * speed;

    this.moveWithCollision(this.velocity.x * dt, 0, 0);
    this.moveWithCollision(0, 0, this.velocity.z * dt);
  }

  private applyGravity(dt: number): void {
    this.velocity.y -= GRAVITY * dt;
    if (this.keys.has("Space") && this.onGround) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
    }
    this.moveWithCollision(0, this.velocity.y * dt, 0);
    if (this.velocity.y < -40) {
      this.velocity.y = 0;
    }
  }

  /**
   * Move on one axis and stop at the first solid block. Axis-separated so the
   * player slides along walls instead of sticking.
   */
  private moveWithCollision(dx: number, dy: number, dz: number): void {
    const next = { x: this.position.x + dx, y: this.position.y + dy, z: this.position.z + dz };
    if (this.collides(next)) {
      if (dy < 0) {
        this.onGround = true;
      }
      // Only the axis that actually collided may have its velocity zeroed.
      // Zeroing the vertical velocity on a HORIZONTAL collision cancelled
      // the jump the moment the player touched a wall: the jump set
      // velocity.y, the horizontal move then hit the wall and cleared it
      // in the same frame, so the player rose by one frame's worth and
      // stopped. That is why the jump only worked in open ground.
      if (dy !== 0) {
        this.velocity.y = 0;
        return;
      }
      if (dx !== 0) {
        this.velocity.x = 0;
      }
      if (dz !== 0) {
        this.velocity.z = 0;
      }
      return;
    }
    this.position.x = next.x;
    this.position.y = next.y;
    this.position.z = next.z;
    if (dy < 0) {
      this.onGround = false;
    }
  }

  private collides(at: Vec3): boolean {
    const minX = Math.floor(at.x - PLAYER_RADIUS);
    const maxX = Math.floor(at.x + PLAYER_RADIUS);
    const minY = Math.floor(at.y);
    const maxY = Math.floor(at.y + PLAYER_HEIGHT);
    const minZ = Math.floor(at.z - PLAYER_RADIUS);
    const maxZ = Math.floor(at.z + PLAYER_RADIUS);
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (this.engine.isSolid(x, y, z)) {
            return true;
          }
        }
      }
    }
    return false;
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
      hotbar: [],
      selectedSlot: 0,
      health: 20,
      hunger: 20,
      message: null,
    });
  }

  /** Rebuild the meshes for every chunk the engine says is out of date. */
  private syncChunks(): void {
    for (const key of this.engine.pendingChunks()) {
      this.engine.syncChunk(key, this.renderer);
    }
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
