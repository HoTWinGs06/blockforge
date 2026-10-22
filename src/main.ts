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

import {
  ALL_BLOCK_IDS,
  BlockId,
  type ChunkKey,
  type PlayerState,
  type ToolSpec,
  type Vec3,
} from "./core/types.js";
import { CHUNK_SIZE_Y, breakSecondsWith, requiredToolFor, toolSpec } from "./core/constants.js";
import {
  aabbIntersects,
  bodyAabb,
  createJumpState,
  moveWithCollisions,
  stepJumpAssist,
  stepPhysics,
  type JumpState,
  type SolidWorld,
} from "./core/physics.js";
import { placementCell, raycast, type RaycastHit } from "./core/raycast.js";
import { GameplaySession } from "./gameplay/index.js";
import type { Activity } from "./gameplay/index.js";
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

/**
 * Where the player starts, and where they wake up after dying.
 *
 * High in the air, so the world is visible on the first frame, and the
 * player falls onto the terrain. The drop into the world is not a fall
 * the player took, so it does not hurt them.
 */
const SPAWN_POSITION: Vec3 = { x: 0.5, y: 90, z: 0.5 };

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

  /**
   * The ENGINE's jump assist state: coyote time and jump buffering.
   *
   * The assist is the engine's (src/core/physics.ts) and it decides WHEN a
   * jump fires. This file only feeds it the input and applies the velocity
   * it asks for.
   */
  private jumpState: JumpState = createJumpState();

  private readonly keys = new Set<string>();
  private selectedSlot = 0;

  /**
   * What the player is carrying, and what is lying on the ground.
   *
   * The player starts with a TIMBER MATTOCK and some blocks. That is not a
   * convenience: the contract froze a tool rule, so a player with an empty
   * hotbar cannot mine a single thing, and the operator reported exactly
   * that - "the blocks require tools to break but there is no way to get
   * tools or build them". A basic tool in the starting kit is what makes
   * the world playable at all; the crafting chain that makes BETTER tools
   * is the gameplay role's work and is tracked on the board.
   *
   * ALL FOUR timber-tier tools, because the contract's tool rule is by KIND
   * and not by tier: canBreak() returns true only when the tool's kind is
   * the kind the block needs. A mattock alone is not enough - the ground
   * the player stands on is clay, and clay needs a TROWEL; timber and
   * foliage need a BILLHOOK; slate and rubble need a MATTOCK; crafted
   * blocks need a MAUL. With only a mattock the player could not mine the
   * ground under their own feet, which is exactly what the operator
   * reported: "no tools yet". The timber tier is the entry tier; better
   * tools are the crafting chain (T81, T82, T84).
   *
   * T80: the inventory is a real thing now. Breaking a block LEAVES AN ITEM
   * on the ground, the player walks over it to collect it, and the hotbar
   * counts what they carry - the operator reported "not able to collect
   * broken blocks no inventory", and both halves are in this session.
   */
  private readonly session = new GameplaySession();
  /** True while the player is holding the break button. */
  private breaking = false;
  /** The in-progress break, or null. */
  private breakState: { key: string; elapsed: number; total: number } | null = null;
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
      // T83: the real numbers, not two decorative twenties. The session
      // owns the survival state; the HUD and the renderer read it from
      // here.
      health: this.session.health,
      hunger: this.session.hunger,
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

    // T80: collect whatever the player walked over. The session owns the
    // inventory, the items on the ground and the player's survival state;
    // the loop just tells it the player moved and how long has passed.
    //
    // T83: the same call advances the survival rules - hunger drains on
    // the tick counter, faster while the player is moving, and a fall
    // hurts when the player lands.
    //
    // T96: the pack is read on BOTH sides of this call, because it is the
    // only place the pickup is visible: an item that is collected is
    // removed from the ground AND added to the pack, and the pack grows
    // ONLY there (placing a block takes one out, but that happens
    // elsewhere). So a pack that grew during this call means the player
    // just picked something up.
    const carriedBefore = this.carriedCount();
    this.session.update(dt, this.position, this.activity(), this.onGround);
    if (this.carriedCount() > carriedBefore) {
      this.sound.play("pickup");
    }
    this.checkDeath();

    this.updateBreaking(dt);
    // T96: draw the items lying on the ground. Without this the player
    // walked over an INVISIBLE item - the mechanic worked and nothing was
    // ever on screen. The renderer diffs the list by id, so this is cheap
    // on a frame where nothing changed.
    this.renderer.setDroppedItems(this.session.droppedItems());
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
   *
   * The JUMP is the ENGINE's too: stepJumpAssist() decides WHEN a jump
   * fires, and this file applies the velocity it asks for. The old code
   * jumped only on `keys.has("Space") && onGround`, which DROPPED a press
   * that arrived a fraction of a second too late (the body had already
   * left the ground) or too early (the body had not landed yet) - that was
   * the operator's "the jump does not work in all areas".
   */
  private applyGravity(dt: number): void {
    // The assist is stepped ONCE per tick and reads the ground state at the
    // END of the previous tick, which is what this.onGround holds here.
    const assist = stepJumpAssist(this.jumpState, {
      jumpHeld: this.keys.has("Space"),
      onGround: this.onGround,
    });
    this.jumpState = assist.state;
    if (assist.jumped) {
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

  /**
   * Place a block NEXT TO the one the player is looking at.
   *
   * The old version wrote into the hit block itself, so right-clicking
   * EXCHANGED the block you were aiming at for a different one. A placement
   * goes in the empty cell on the face the ray came in through, which is
   * exactly what placementCell() computes from the face normal.
   */
  private placeBlock(hit: RaycastHit): void {
    const cell = placementCell(hit);
    if (cell.y < 0 || cell.y >= CHUNK_SIZE_Y || this.engine.isSolid(cell.x, cell.y, cell.z)) {
      this.sound.play("deny");
      return;
    }
    // Never place a block inside the player.
    const cube = {
      minX: cell.x,
      minY: cell.y,
      minZ: cell.z,
      maxX: cell.x + 1,
      maxY: cell.y + 1,
      maxZ: cell.z + 1,
    };
    if (aabbIntersects(bodyAabb(this.position), cube)) {
      this.message = "There is no room to place a block there";
      this.sound.play("deny");
      return;
    }
    const block = this.heldBlockId();
    if (block === null) {
      this.message = "You are not holding a block";
      this.sound.play("deny");
      return;
    }
    this.engine.setBlock(cell.x, cell.y, cell.z, block);
    // T80: placing a block TAKES IT OUT OF THE PACK. Before this, the
    // hotbar was a decoration: the player could place blocks forever and
    // the count never moved. Now the count is the truth, and a player who
    // has run out of a block cannot place any more of it.
    this.session.consumeHeld();
    this.sound.play("place");
    this.engine.syncChunk(chunkKeyOf(cell.x, cell.y, cell.z), this.renderer);
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
      const broken = this.engine.blockAt(hit.x, hit.y, hit.z);
      this.engine.setBlock(hit.x, hit.y, hit.z, BlockId.Air);
      // T80: the block does not simply vanish - it LEAVES AN ITEM on the
      // ground, and the player collects it by walking over it. The drop
      // table decides what it leaves, and the wrong-tool rule is applied
      // there: a block broken with the wrong tool drops NOTHING, which is
      // what makes tools worth crafting.
      this.session.breakBlock(broken, this.heldTool(), hit.x, hit.y, hit.z, this.solidWorld());
      this.sound.play("break");
      this.engine.syncChunk(chunkKeyOf(hit.x, hit.y, hit.z), this.renderer);
      // The hand swings when the block breaks.
      this.renderer.swingViewmodel();
      this.breakState = null;
    }
  }

  /**
   * How hard the player is working, which is how fast hunger drains.
   *
   * Sprinting burns the most, walking some, standing still least. The
   * survival rules are what turn this into a drain rate.
   */
  private activity(): Activity {
    if (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) {
      return "sprinting";
    }
    return this.horizontalSpeed() > 0.1 ? "moving" : "idle";
  }

  /**
   * The player died: put them back on their feet.
   *
   * The world is NOT reset. The blocks the player broke stay broken, the
   * items they dropped stay where they fell, and the player comes back
   * at the top of the world with a full belly. Only the player is put
   * back together.
   */
  private checkDeath(): void {
    if (!this.session.dead) {
      return;
    }
    this.session.respawn();
    this.position = { ...SPAWN_POSITION };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.onGround = false;
    this.message = "You died. You wake at the top of the world, hungry and whole.";
  }

  /**
   * Eat the food in hand.
   *
   * The key is the shell's business; the rule is the session's: the item
   * in hand has to be food, and the player has to be hungry.
   */
  private eat(): void {
    // The name is read BEFORE the meal: eating takes the item out of the
    // pack, so the hand may be empty by the time the message is written.
    const name = this.session.held()?.id ?? "";
    const outcome = this.session.eat();
    if (outcome.ate) {
      this.message = `You eat the ${blockLabel(name as BlockId)} (+${outcome.restored} hunger)`;
      this.sound.play("place");
      return;
    }
    this.message =
      outcome.reason === "not-hungry"
        ? "You are not hungry"
        : outcome.reason === "not-food"
          ? "That is not food"
          : outcome.reason === "dead"
            ? "You are dead"
            : "You have nothing in your hand";
    this.sound.play("deny");
  }

  /** Ray-march from the eye along the look direction and return the first solid block. */
  /**
   * The block the player is aiming at, WITH the face it was hit on.
   *
   * This used to be a hand-rolled ray march that returned only the block's
   * coordinates, so the game never knew which FACE the player was looking
   * at. That is why placing a block wrote into the block that was looked
   * at: without a face there is nowhere else to put it, so it EXCHANGED
   * the block instead of placing a new one next to it.
   *
   * The core already has a proper voxel raycast (src/core/raycast.ts) that
   * returns the face normal, and placementCell() turns that normal into the
   * empty cell next to the hit. The game now uses the core's, so there is
   * ONE implementation of "what am I looking at", and it is the tested one.
   */
  private pickBlock(): RaycastHit | null {
    const dir = this.lookDirection();
    const origin = { x: this.position.x, y: this.position.y + EYE_HEIGHT, z: this.position.z };
    const world = {
      blockAt: (x: number, y: number, z: number): BlockId =>
        this.engine.isSolid(x, y, z) ? this.engine.blockAt(x, y, z) : BlockId.Air,
    };
    return raycast({ origin, direction: dir }, world, REACH, (block) => block !== BlockId.Air);
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
    // The hand holds the selected hotbar item. When the player selects a
    // block, the hand shows that block's texture; when they select a tool
    // there is no block texture for it yet, so the hand keeps the last
    // block it had.
    const heldBlock = this.heldBlockId();
    if (heldBlock !== null) {
      this.renderer.setHeldBlock(heldBlock);
    }

    this.hud.update({
      targetedBlock: hit ? this.engine.blockAt(hit.x, hit.y, hit.z) : null,
      targetedPosition: hit,
      // Nine slots, always. The hotbar SHELL is M1: the operator reported
      // "no inventory bar", and a bar made of nothing is not a bar. The
      // ITEMS are real now (T80): the slots carry what the player actually
      // holds, with the count of each.
      hotbar: this.session.carried.slots.map((item) => ({
        id: item.id,
        count: item.count,
        ...(item.durability === undefined ? {} : { durability: item.durability }),
      })),
      selectedSlot: this.selectedSlot,
      health: this.session.health,
      hunger: this.session.hunger,
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
   * How many items the player is carrying, over every slot.
   *
   * This is the count that GROWS when the player picks something up, and
   * it is how the loop knows a pickup happened without the gameplay layer
   * having to report it: the pack only grows inside session.update().
   */
  private carriedCount(): number {
    let total = 0;
    for (const slot of this.session.carried.slots) {
      total += slot.count;
    }
    return total;
  }

  /**
   * The tool in the selected hotbar slot, or null for bare hands.
   *
   * This returned null unconditionally, which meant the player could never
   * satisfy the contract's tool rule. breakSecondsWith() returns -1 for a
   * block that needs a tool you do not have, so an empty hotbar made the
   * whole world unmineable - "the blocks require tools to break but there
   * is no way to get tools".
   */
  private heldTool(): ToolSpec | null {
    const item = this.session.held();
    if (item === null) {
      return null;
    }
    return toolSpec(item.id) ?? null;
  }

  /**
   * The block in the selected hotbar slot, or null when it is not a block.
   *
   * A tool is not a block, so it cannot be placed. The ids are the
   * contract's own: a tool id (mattock_timber) for a tool, a BlockId
   * (loam, timber, rubble) for a block.
   */
  private heldBlockId(): BlockId | null {
    const item = this.session.held();
    if (item === null) {
      return null;
    }
    return ALL_BLOCK_IDS.includes(item.id as BlockId) ? (item.id as BlockId) : null;
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
      // T83: eat what is in hand.
      if (event.code === "KeyG") {
        this.eat();
        return;
      }
      // Number keys select a hotbar slot.
      if (/^Digit[1-9]$/.test(event.code)) {
        this.selectedSlot = Number(event.code.slice(-1)) - 1;
        this.session.select(this.selectedSlot);
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
      // The held keys must go too. A keyup is not delivered when the window
      // loses focus, so a key held at that moment stays down forever - and
      // the jump assist only fires on the RISING edge, so a stuck Space key
      // would leave the player unable to jump at all.
      this.keys.clear();
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
      carried: () =>
        this.session.carried.slots.map((slot) => ({ id: slot.id, count: slot.count })),
      dropped: () => this.session.droppedItems().length,
      // T96: the drops the RENDERER has actually drawn. The session's
      // count above is the logic; this is the visual. They must agree -
      // an item the session knows about that the renderer never drew is
      // the invisible-item bug this task exists to close.
      drawnDrops: () =>
        this.renderer.droppedItems.map((drop) => ({
          id: drop.id,
          x: drop.x,
          y: drop.y,
          z: drop.z,
          size: drop.size,
          minU: drop.minU,
          maxU: drop.maxU,
          minV: drop.minV,
          maxV: drop.maxV,
          // Where the drop should be ON THE SCREEN. A browser test
          // samples these pixels, which is the only check that cannot
          // pass on a mesh nobody can see.
          screen: this.renderer.dropScreenBounds(drop),
        })),
      // The session's own view of the items on the ground, so a test can
      // compare WHERE the renderer drew them with where they are.
      droppedItems: () =>
        this.session.droppedItems().map((item) => ({
          id: item.id,
          x: item.x,
          y: item.y,
          z: item.z,
        })),
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
      viewmodelScreenBounds: () => this.renderer.viewmodelScreenBounds,
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
  /**
   * What the player is carrying, as the hotbar shows it.
   *
   * This is player-facing state - the same thing the hotbar draws - so it
   * is a fair thing for the browser tests to read. It is how a test checks
   * that a broken block really became a collectable item.
   */
  carried(): readonly { id: string; count: number }[];
  /** How many items are lying on the ground right now. */
  dropped(): number;
  /**
   * The items the RENDERER has actually drawn on the ground.
   *
   * `dropped()` is the gameplay layer's count; this is the renderer's.
   * They must agree - an item the session knows about that the renderer
   * never drew is the invisible-item bug, and a browser test that only
   * reads the logic cannot see it.
   */
  drawnDrops(): readonly {
    id: number;
    x: number;
    y: number;
    z: number;
    size: number;
    minU: number;
    maxU: number;
    minV: number;
    maxV: number;
    /** Where the drop should be on the screen, in CSS pixels. */
    screen: { x: number; y: number; width: number; height: number } | null;
  }[];
  /**
   * The session's own view of the items on the ground.
   *
   * `dropped()` counts them; this says where they are, so a test can
   * check that the renderer drew them in the right place.
   */
  droppedItems(): readonly { id: number; x: number; y: number; z: number }[];
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
  /**
   * Where the hand is on the screen, in CSS pixels relative to the canvas.
   *
   * The hand is parented to the camera, so this box does not move when the
   * player looks around. A browser test that wants to look at the HAND's
   * pixels - rather than at a wide region that is mostly background - reads
   * this and samples exactly the hand.
   */
  viewmodelScreenBounds(): { x: number; y: number; width: number; height: number } | null;
}

/** The handle for the game running in this page, if there is one. */
export let gameHandle: GameHandle | null = null;
