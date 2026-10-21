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

import { BlockId, type ChunkKey, type PlayerState, type ToolSpec, type Vec3 } from "./core/types.js";
import { CHUNK_SIZE_Y, breakSecondsWith, requiredToolFor } from "./core/constants.js";
import {
  moveWithCollisions,
  stepPhysics,
  type SolidWorld,
} from "./core/physics.js";
import { Hud, SoundBoard, TitleScreen, WorldRenderer, blockLabel, chunkKeyOf } from "./render/index.js";

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
/**
 * Walking speed, in blocks per second.
 *
 * The operator said "make the player speed slower". 4.5 was too fast - it is
 * quicker than most first-person games feel, and it made the camera look
 * twitchy. 3.2 is the number the architect picked and it is right: it still
 * covers ground at a decent clip, but the camera settles instead of skating.
 * Shift multiplies it by SPRINT_MULTIPLIER so sprinting still reads as a
 * sprint.
 */
const WALK_SPEED = 3.2;

/** How much faster the player moves while sprinting. */
const SPRINT_MULTIPLIER = 1.8;
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
  /** True while the player is holding the break button. */
  private breaking = false;
  /** The in-progress break, or null. */
  private breakState: { key: string; elapsed: number; total: number } | null = null;
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

    this.updateBreaking(dt);
    this.renderer.applyPlayer(this.playerState);
    this.renderer.updateViewmodel(dt, this.horizontalSpeed(), this.onGround);
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
    const speed = this.keys.has("ShiftLeft") ? WALK_SPEED * SPRINT_MULTIPLIER : WALK_SPEED;
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
  /**
   * Break or place the block the player is aiming at.
   *
   * T70: breaking is a HOLD, not a click. The block has a hardness - the times
   * are frozen in the core contract as BREAK_TIME_SECONDS / breakSeconds() -
   * so the player holds the button and a timer runs, and the block only
   * breaks when the timer completes. Every block has its own time, from a
   * tenth of a second for foliage to nine seconds for voidstone, which is what
   * makes the world feel like it has weight.
   *
   * Placing stays a single action: it is not a hold.
   */
  private act(place: boolean): void {
    const hit = this.pickBlock();
    if (!hit) {
      this.sound.play("deny");
      this.breakState = null;
      return;
    }
    if (place) {
      this.placeBlock(hit);
      return;
    }
    // A fresh press starts the hold. The block's HARDNESS comes from the
    // frozen core table, keyed by the block kind at that position.
    //
    // breakSecondsWith(), NOT breakSeconds(): the contract froze a TOOL
    // rule alongside the break times. Some blocks cannot be broken by bare
    // hands at all - they need a mattock, a billhook, a trowel or a maul -
    // and breakSecondsWith() returns -1 for those, and applies the tool's
    // multiplier when there is a tool. Using the bare breakSeconds() would
    // quietly let the player break ironveil with their fists, which is
    // exactly the kind of contract violation this project exists to prevent.
    const kind = this.engine.blockAt(hit.x, hit.y, hit.z);
    const total = breakSecondsWith(String(kind), this.heldTool());
    if (total < 0) {
      // The block cannot be broken with what the player is holding. Say so
      // rather than starting a timer that will never finish.
      this.message = `${blockLabel(kind)} needs a ${requiredToolFor(String(kind))}`;
      this.breakState = null;
      this.sound.play("deny");
      return;
    }
    this.message = null;
    if (!this.breakState || this.breakState.key !== this.keyOf(hit)) {
      this.breakState = {
        key: this.keyOf(hit),
        elapsed: 0,
        total,
      };
    }
  }

  private placeBlock(hit: { x: number; y: number; z: number }): void {
    this.engine.setBlock(hit.x, hit.y, hit.z, BlockId.Rubble);
    this.sound.play("place");
    this.engine.syncChunk(chunkKeyOf(hit.x, hit.y, hit.z), this.renderer);
  }

  private keyOf(hit: { x: number; y: number; z: number }): string {
    return `${hit.x},${hit.y},${hit.z}`;
  }

  /**
   * Advance the break timer.
   *
   * Called every frame while the player is holding the break button. When the
   * timer completes, the block breaks.
   */
  private updateBreaking(dt: number): void {
    if (!this.breaking) {
      this.breakState = null;
      return;
    }
    const state = this.breakState;
    if (!state) {
      return;
    }
    // If the player looked away, the hold resets.
    const hit = this.pickBlock();
    if (!hit || this.keyOf(hit) !== state.key) {
      this.breakState = null;
      return;
    }
    state.elapsed += dt;
    if (state.elapsed >= state.total) {
      this.engine.setBlock(hit.x, hit.y, hit.z, BlockId.Air);
      this.sound.play("break");
      this.engine.syncChunk(chunkKeyOf(hit.x, hit.y, hit.z), this.renderer);
      // The hand swings when the block breaks.
      this.renderer.swingViewmodel();
      this.breakState = null;
    }
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
    // The hand holds the selected hotbar item. The ITEMS are M3 content and
    // the hotbar is still empty, so the hand holds rubble - but the wiring
    // is real, and when the inventory lands the hand will pick up whatever
    // the player has selected.
    this.renderer.setHeldBlock(BlockId.Rubble);

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
      breakProgress: this.breakProgress(),
      breakingBlock: this.breakBlock(),
    });
  }

  /**
   * The player's horizontal speed, in blocks per second.
   *
   * This drives the walk bob, so it must be the speed the player is ACTUALLY
   * moving at, not the speed they are trying to move at. A player pushing
   * into a wall is trying to run and is not moving, and a bob that keeps
   * going while they are stuck against a wall looks broken.
   */
  private horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /**
   * The tool the player is holding, or null for bare hands.
   *
   * The INVENTORY is M3 content and does not exist yet, so this is always
   * null - which means only the blocks the contract lets bare hands break
   * are breakable. That is the honest state: the tool rule is real, and the
   * tools to satisfy it have not been crafted yet. When the inventory lands,
   * this reads the selected hotbar slot.
   */
  private heldTool(): ToolSpec | null {
    return null;
  }

  /** How far through the break the player is, from 0 to 1, or null. */
  private breakProgress(): number | null {
    const state = this.breakState;
    if (!state || state.total <= 0) {
      return null;
    }
    return Math.max(0, Math.min(1, state.elapsed / state.total));
  }

  /** The kind of block being broken, or null. */
  private breakBlock(): BlockId | null {
    const state = this.breakState;
    if (!state) {
      return null;
    }
    const hit = this.pickBlock();
    return hit ? this.engine.blockAt(hit.x, hit.y, hit.z) : null;
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
        this.breaking = true;
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
      if (event.code === "KeyF" || event.code === "Enter") {
        this.breaking = false;
      }
    });
    canvas.addEventListener("mousedown", (event) => {
      if (event.button === 0) {
        // HOLD to break. The timer runs while the button is down, and the
        // block only breaks when its hardness timer completes.
        this.dragging = true;
        this.breaking = true;
        this.sound.unlock();
        this.act(false);
      } else if (event.button === 2) {
        this.act(true);
      }
    });
    window.addEventListener("mouseup", () => {
      this.dragging = false;
      this.breaking = false;
    });
    // Releasing the button outside the canvas must also end the hold, or the
    // player would keep mining after dragging off the window.
    window.addEventListener("blur", () => {
      this.dragging = false;
      this.breaking = false;
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

  /**
   * The handle the browser tests drive.
   *
   * ARROW FUNCTIONS, not method shorthand: an object literal's `get state()`
   * binds `this` to the LITERAL, not to the Game, so the getters would read
   * the wrong object. The obvious fix - `const game = this` - trips the
   * repo's own no-this-alias rule, so the arrow functions capture the
   * enclosing `this` lexically, which is both correct and lint-clean.
   */
  get handle(): GameHandle {
    return {
      state: () => this.playerState,
      view: () => ({ yaw: this.yaw, pitch: this.pitch }),
      look: (pitchDelta: number, yawDelta = 0): void => {
        const limit = Math.PI / 2 - 0.001;
        this.pitch = Math.max(-limit, Math.min(limit, this.pitch + pitchDelta));
        this.yaw += yawDelta;
      },
      targeted: () => this.pickBlock(),
      targetedKind: () => {
        const at = this.pickBlock();
        return at ? this.engine.blockAt(at.x, at.y, at.z) : null;
      },
      setBreaking: (holding: boolean): void => {
        this.breaking = holding;
        if (holding) {
          this.act(false);
        }
      },
      breakProgress: () => this.breakProgress(),
      breakingBlock: () => this.breakBlock(),
      heldBlock: () => this.renderer.heldBlock,
      viewmodelUvBounds: () => this.renderer.viewmodelUvBounds,
      viewmodelHasFog: () => this.renderer.viewmodelHasFog,
    };
  }
}

/** Mount the game onto a canvas. */
export function mountGame(canvas: HTMLCanvasElement, engine: EngineBridge): Game {
  const game = new Game(canvas, engine);
  game.start();
  gameHandle = game.handle;
  return game;
}

/**
 * A handle on the running game, for the browser tests.
 *
 * THIS IS A TESTING SEAM. The invariants it exposes are the SAME ones the
 * input handlers use, so a test drives the game the way a player does rather
 * than reaching into private state - and so the seam cannot drift away from
 * the real input path.
 *
 * It is published on window only in the dev build (see src/entry.ts), so the
 * shipped game carries no debug backdoor. It is documented in docs/API.md,
 * so it is an interface with an owner rather than a private field the tests
 * happen to know about.
 *
 * KEEP IT SMALL. It exposes the player-facing actions the tests need NOW. If
 * a new test wants to drive something else, the question to ask is "what is
 * the PLAYER-FACING ACTION here, and can the test perform that action
 * through the same code path the player uses?" - because if it can, the test
 * should be performing that action rather than adding another method here.
 * A handle with twenty members is a second, undocumented control surface
 * that nobody knows the state of.
 */
export interface GameHandle {
  /** The current player state. */
  state(): PlayerState;
  /** Where the player is looking, in radians. */
  view(): { yaw: number; pitch: number };
  /** Look down (positive) or up (negative) by a number of radians. */
  look(pitchDelta: number, yawDelta?: number): void;
  /** The block the player is currently aiming at, if any. */
  targeted(): { x: number; y: number; z: number } | null;
  /**
   * The KIND of block the player is aiming at, as the contract's id.
   *
   * The HUD shows a capitalised label for the player, but the contract's
   * ids are lower case, and the contract's functions are case-sensitive -
   * so a test that reads the label and passes it to canBreak() would get
   * the wrong answer. This is the real id.
   */
  targetedKind(): BlockId | null;
  /** Start or stop holding the break button. */
  setBreaking(holding: boolean): void;
  /** How far through the current break the player is, 0..1, or null. */
  breakProgress(): number | null;
  /** The kind of block being broken, if any. */
  breakingBlock(): BlockId | null;
  /** The block the player's hand is holding. */
  heldBlock(): BlockId;
  /**
   * The hand's UV bounds, so a test can check that the hand shows one
   * block's texture rather than the whole atlas.
   */
  viewmodelUvBounds(): { minU: number; maxU: number; minV: number; maxV: number };
  /** Whether the hand's material has fog enabled. It must not. */
  viewmodelHasFog(): boolean;
}

/** The handle for the game running in this page, if there is one. */
export let gameHandle: GameHandle | null = null;
