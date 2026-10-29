/**
 * BlockForge — the gameplay session: what the player carries and what is
 * lying on the ground.
 *
 * OWNERSHIP: GAMEPLAY. Pure logic: no DOM, no clock, no randomness.
 *
 * This is the one object the game loop talks to. It holds the player's
 * inventory, the items dropped in the world, and the tick counter, and it
 * answers the three questions the loop asks:
 *
 *   "the player broke a block"   -> breakBlock() spawns the drops
 *   "the world moved on"         -> update() ages the items and collects
 *                                    whatever the player walked over
 *   "what is the player holding"  -> held(), via the inventory
 *
 * THE TICK IS THE CLOCK. Time comes from a tick counter, never from the
 * wall clock, so the same inputs always produce the same world - the same
 * rule the core contract follows.
 *
 * DETERMINISM: an item's position is a pure function of the tick (see
 * itemEntities.ts), so the same break at the same tick always leaves the
 * item in the same place, whatever order the world was updated in.
 */

import type {
  BlockId,
  ChunkKey,
  Inventory,
  ItemStack,
  MobKind,
  MobState,
  MobStateKind,
  ToolSpec,
  Vec3,
} from "../core/types.js";
import { canBreak, CHUNK_SIZE_X, CHUNK_SIZE_Z } from "../core/constants.js";
import { createRng } from "../core/rng.js";
import { dropFor } from "./drops.js";
import {
  addItem,
  createInventory,
  heldItem,
  removeItem,
  selectSlot,
  type AddResult,
} from "./inventory.js";
import {
  collectItems,
  itemPosition,
  spawnItem,
  type ItemEntity,
  type SolidProbe,
} from "./itemEntities.js";
import {
  advanceSurvival,
  createSurvival,
  damageSurvival,
  eatSurvival,
  fallDamage,
  foodValue,
  respawnSurvival,
  MOB_DAMAGE,
  MAX_HUNGER,
  type Activity,
  type SurvivalState,
} from "./survival.js";
import { wearTool } from "./tools.js";
import {
  mobDropTable,
  spawnMob,
  updateMobAI,
  AI_TIMER_DEFAULT,
  type MobWorldView,
} from "./mobs.js";

/** Ticks in one second. The world clock runs at twenty, and so does this. */
export const TICKS_PER_SECOND = 20;

// ── M3: the mob population (T117) ─────────────────────────────────────────

/** Ticks between two mob population checks. Only a check that passes every
 *  rule spawns, and even then exactly one mob, so the per-tick cost is a
 *  constant the loop can afford. */
export const MOB_SPAWN_INTERVAL_TICKS = 40;

/** The most mobs the session keeps alive at once. */
export const MAX_MOBS = 24;

/** How far, in chunks, the spawn search reaches around the player's chunk
 *  (Chebyshev distance): ring 1 first, then ring 2. */
export const MOB_SPAWN_RING_RADIUS = 2;

/** How far, horizontally, a mob has to spawn from the player: a spawn on
 *  the player's own block would look like teleporting into them. */
export const MOB_MIN_SPAWN_DISTANCE = 12;

/** The vertical band, in block cells, the surface scan walks. Below the
 *  band there is mostly bedrock and stone; above it nothing stands. */
export const MOB_SPAWN_SEARCH_TOP = 128;
export const MOB_SPAWN_SEARCH_BOTTOM = 32;

/** Ticks one hostile mob must wait between two attacks. The AI re-decides
 *  often; this is the throttle that keeps a bite from landing every tick.
 *  The AI's own re-evaluation pace is a comfortable default. */
export const MOB_ATTACK_COOLDOWN_TICKS = AI_TIMER_DEFAULT;

/**
 * A mob, as the renderer needs to see it.
 *
 * The position is the mob's feet, exactly as the player's `feet` is; the
 * renderer draws its model above this. `state` is the mob's own behaviour
 * word, so the screen can show an attack or a wobble without reaching into
 * the session's internals.
 */
export interface MobView {
  readonly id: number;
  readonly kind: MobKind;
  readonly state: MobStateKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly health: number;
}

/** One chunk offset from the player's chunk. */
interface ChunkOffset {
  readonly cx: number;
  readonly cz: number;
}

/**
 * The candidate chunk offsets, in ring order.
 *
 * Rings 1..MOB_SPAWN_RING_RADIUS around the player's chunk, sorted outward
 * then clockwise, so the search looks at the same offsets in the same order
 * every tick — a small habit of determinism that costs nothing.
 */
const MOB_SPAWN_RING_OFFSETS: readonly ChunkOffset[] = (() => {
  const offsets: ChunkOffset[] = [];
  for (let ring = 1; ring <= MOB_SPAWN_RING_RADIUS; ring++) {
    for (let cx = -ring; cx <= ring; cx++) {
      for (let cz = -ring; cz <= ring; cz++) {
        if (Math.max(Math.abs(cx), Math.abs(cz)) === ring) {
          offsets.push({ cx, cz });
        }
      }
    }
  }
  return offsets;
})();

/** The passive kinds, in pick order: meek, winged, shelled. */
const MOB_PASSIVE_KINDS = ["grazer", "flutter", "shellback"] as const;

/** The hostile kinds, in pick order: the lurker, then the snarler. */
const MOB_HOSTILE_KINDS = ["lurker", "snarler"] as const;

/**
 * Pick a mob kind from one roll of the dice: 60% passive, else hostile.
 *
 * The roll decides the slot inside each group with an even share, so the
 * same roll always picks the same kind.
 */
function pickMobKind(roll: number): MobKind {
  if (roll < 0.6) {
    const index = Math.floor((roll / 0.6) * MOB_PASSIVE_KINDS.length);
    return MOB_PASSIVE_KINDS[index] ?? "grazer";
  }
  const index = Math.floor(((roll - 0.6) / 0.4) * MOB_HOSTILE_KINDS.length);
  return MOB_HOSTILE_KINDS[index] ?? "lurker";
}

/**
 * The cell a mob's feet would stand in, at the column (x,z).
 *
 * The scan walks down from the top of the search band and takes the first
 * solid cell; the mob stands on top of it, provided the two cells above it
 * are free (room for a body and a head). A column with no standable spot
 * in the band gets null, and the spawn is refused.
 */
function surfaceCellForSpawn(
  x: number,
  z: number,
  world: SolidProbe,
): number | null {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  for (let y = MOB_SPAWN_SEARCH_TOP; y >= MOB_SPAWN_SEARCH_BOTTOM; y--) {
    if (!world.isSolid(bx, y, bz)) {
      continue;
    }
    if (!world.isSolid(bx, y + 1, bz) && !world.isSolid(bx, y + 2, bz)) {
      return y + 1;
    }
  }
  return null;
}

/** A dropped item, as the renderer needs to see it. */
export interface DroppedItemView {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly block: BlockId;
}

/**
 * What a break did to the tool that made it.
 *
 * `toolBroke` is the id of the tool that used up its last use and left the
 * pack, or null when nothing broke. The screen shows "your mattock broke"
 * from it, so the player is not left wondering where the tool in their hand
 * went.
 */
export interface BreakOutcome {
  readonly toolBroke: string | null;
}

/**
 * What happened when the player tried to eat.
 *
 * `ate` is the answer to "did that work". `restored` is how much hunger
 * the meal put back, and `reason` says why nothing happened - so the
 * screen can tell the player instead of swallowing the food silently.
 */
export interface EatOutcome {
  readonly ate: boolean;
  readonly restored: number;
  readonly reason: "nothing-held" | "not-food" | "not-hungry" | "dead" | null;
}

/** The player's starting kit: the four timber tools and some blocks. */
const STARTING_KIT: readonly ItemStack[] = [
  { id: "mattock_timber", count: 1, durability: 60 },
  { id: "trowel_timber", count: 1, durability: 60 },
  { id: "billhook_timber", count: 1, durability: 60 },
  { id: "maul_timber", count: 1, durability: 60 },
  { id: "loam", count: 16 },
  { id: "timber", count: 16 },
  { id: "rubble", count: 16 },
  { id: "sand", count: 16 },
];

/**
 * The player's stuff: their inventory, the items lying in the world, and
 * their survival state.
 */
export class GameplaySession {
  private inventory: Inventory;
  private items: ItemEntity[] = [];
  private nextItemId = 1;
  private tick = 0;
  private tickCarry = 0;
  private survival: SurvivalState = createSurvival();
  /** The highest point of the current fall, or null when there is none. */
  private fallTop: number | null = null;
  /**
   * True once the player has landed at least once.
   *
   * The drop into the world at spawn is not a fall the player took, so
   * it does not hurt. This arms the rule after the first landing.
   */
  private fallArmed = false;
  /**
   * The seed the mob population draws from.
   *
   * Null means the session runs empty: no mob appears until the caller
   * seeds one with startMobs(). Whatever else happens, the same seed and
   * the same ticks always produce the same set of mobs in the same order.
   */
  private mobSeed: number | null = null;
  /** The mobs alive in the world, always in id order. */
  private mobList: MobState[] = [];
  /** The id the next spawn will carry. */
  private nextMobId = 1;
  /** The tick each mob may land its next attack on, by mob id. */
  private nextAttackTick: Map<number, number> = new Map();

  constructor() {
    const { inventory } = createInventory(STARTING_KIT);
    this.inventory = inventory;
  }

  /** What the player is carrying. */
  get carried(): Inventory {
    return this.inventory;
  }

  /** The player's health, on the 0..20 scale the HUD draws. */
  get health(): number {
    return this.survival.health;
  }

  /** The player's hunger, on the 0..20 scale the HUD draws. */
  get hunger(): number {
    return this.survival.hunger;
  }

  /** True when the player has died and has not respawned yet. */
  get dead(): boolean {
    return this.survival.dead;
  }

  /** The whole survival state, for the rules that act on it. */
  get survivalState(): SurvivalState {
    return this.survival;
  }

  /** The stack in the selected slot, or null when that slot is empty. */
  held(): ItemStack | null {
    return heldItem(this.inventory);
  }

  /** Move the hotbar selection. */
  select(index: number): void {
    this.inventory = selectSlot(this.inventory, index);
  }

  /**
   * The player broke a block: leave what it drops on the ground, and pay
   * for it with the tool.
   *
   * The tool matters. A block that needs a tool and was not broken with one
   * drops NOTHING, which is what makes tools worth crafting.
   *
   * T82: THE TOOL WEARS. Breaking a block with a tool costs that tool one
   * use of its durability, and when the last use is gone the tool BREAKS
   * and leaves the pack. The wear is gated on the same `canBreak` the drop
   * table uses, so a block that dropped nothing (because the wrong tool was
   * used) costs the tool nothing either - the two can never disagree.
   *
   * The wear lands in this class, so the caller does not have to know about
   * it: a break is a break, and the tool that made it paid for it.
   */
  breakBlock(
    block: BlockId,
    tool: ToolSpec | null,
    x: number,
    y: number,
    z: number,
    world: SolidProbe,
  ): BreakOutcome {
    for (const stack of dropFor(block, tool)) {
      this.items = [
        ...this.items,
        spawnItem(this.nextItemId++, stack, x, y, z, this.tick, world),
      ];
    }
    if (tool === null || !canBreak(block, tool)) {
      return { toolBroke: null };
    }
    const wear = wearTool(this.inventory, tool);
    this.inventory = wear.inventory;
    return { toolBroke: wear.broke ? tool.id : null };
  }

  /**
   * Advance the world and collect whatever the player walked over.
   *
   * `dt` is the elapsed time in seconds. The tick counter advances in
   * fixed fifths of a second, so the session's clock is the world's clock
   * and never the wall clock.
   *
   * T83: THE SURVIVAL RULES LIVE HERE. The same tick that ages the
   * dropped items also drains hunger and applies starvation, and the
   * fall damage is measured from the player's own height. `activity` is
   * what the player is doing - it decides how fast the belly empties -
   * and `onGround` is what says whether they are standing on something.
   *
   * T117: THE MOBS LIVE HERE TOO, when the caller can answer the world.
   * Passing `world` turns the mob population on: the same ticks that age
   * the items and the player now spawn, steer, wound and pay out the mobs.
   * A caller that passes nothing keeps the old behaviour exactly - the
   * mobs simply do not exist - so nobody is forced to seed them.
   */
  update(
    dt: number,
    feet: Vec3,
    activity: Activity = "idle",
    onGround = true,
    world?: SolidProbe,
  ): void {
    this.tickCarry += dt;
    while (this.tickCarry >= 1 / TICKS_PER_SECOND) {
      this.tickCarry -= 1 / TICKS_PER_SECOND;
      this.tick += 1;
      this.survival = advanceSurvival(this.survival, 1, activity);
      if (world !== undefined) {
        this.stepMobs(feet, world);
      }
    }
    this.trackFall(feet, onGround);
    const result = collectItems(this.items, this.inventory, feet, this.tick);
    this.items = [...result.items];
    this.inventory = result.inventory;
  }

  /**
   * Watch the player's height and take the fall damage.
   *
   * A fall is the distance from the highest point of the drop to where
   * the player lands. The damage is the game's rule, not the shell's.
   *
   * THE SPAWN DROP IS NOT A FALL. The player starts in the air and lands
   * when the world is built, and that landing is not something they did,
   * so it does not hurt. The first landing arms the rule and every fall
   * after it counts.
   */
  private trackFall(feet: Vec3, onGround: boolean): void {
    if (!onGround) {
      this.fallTop = this.fallTop === null ? feet.y : Math.max(this.fallTop, feet.y);
      return;
    }
    if (this.fallTop !== null) {
      const distance = this.fallTop - feet.y;
      if (this.fallArmed) {
        this.survival = damageSurvival(this.survival, fallDamage(distance));
      }
      this.fallTop = null;
    }
    this.fallArmed = true;
  }

  /**
   * Take damage - from a mob, from a fall, from anything.
   *
   * The amount is the game's business; this is where it lands. Zero
   * health is death, and a dead player stays dead until they respawn.
   */
  damage(amount: number): void {
    this.survival = damageSurvival(this.survival, amount);
  }

  /**
   * The damage a mob of the given kind does when it attacks.
   *
   * The passive kinds do none - a grazer is not a threat - and the two
   * hostile kinds do. The mob AI calls this when it lands a blow.
   */
  hurtByMob(kind: MobKind): void {
    this.damage(MOB_DAMAGE[kind]);
  }

  /**
   * Seed the mob population: without a seed, no mob ever appears.
   *
   * Calling this again re-seeds from scratch - the mobs alive now are
   * cleared and the id counter restarts - so the same seed always leads
   * to the same set of mobs from the beginning, whatever had come before.
   */
  startMobs(seed: number): void {
    this.mobSeed = seed;
    this.mobList = [];
    this.nextMobId = 1;
    this.nextAttackTick = new Map();
  }

  /**
   * The mobs alive in the world, for the renderer to draw.
   *
   * Always in id order - the order the ticks created them - so a renderer
   * that draws them from first to last also draws the world the same way
   * every frame.
   */
  mobs(): readonly MobView[] {
    return this.mobList.map((mob) => ({
      id: mob.id,
      kind: mob.kind,
      state: mob.state,
      x: mob.position.x,
      y: mob.position.y,
      z: mob.position.z,
      yaw: mob.yaw,
      health: mob.health,
    }));
  }

  /**
   * The player wounded a mob.
   *
   * The amount is the caller's business (a tool's damage is one); the
   * wound lands here and the death, if it is one, is confirmed on the
   * mob's next tick of AI, where its drops come out and its heart stops.
   * Unknown or already-dead mobs take nothing and answer kind null, so
   * a stale id can never pay out twice.
   */
  hitMob(id: number, amount: number): { kind: MobKind | null; killed: boolean } {
    const target = this.mobList.find((mob) => mob.id === id);
    if (target === undefined || target.state === "dead") {
      return { kind: null, killed: false };
    }
    const hit = target.health - amount;
    if (hit > 0) {
      this.mobList = this.mobList.map((mob) =>
        mob.id === id ? { ...mob, health: hit } : mob,
      );
      return { kind: target.kind, killed: false };
    }
    this.mobList = this.mobList.map((mob) =>
      mob.id === id ? { ...mob, health: 0 } : mob,
    );
    return { kind: target.kind, killed: true };
  }

  /**
   * One tick of the mob world: spawn, steer, wound, pay out, bury.
   *
   * Everything happens in strict id order, and every number a mob reads
   * comes from (seed, tick) - the same recipe the items follow - so two
   * sessions with the same seed see the same mobs do the same things.
   *
   * THE SOLID PROBE FLOORS. The world answers block cells, but mobs live
   * at fractional positions, and a probe with fractions reads empty air at
   * every floor's edge (the core contract rejects non-integer coordinates).
   * The floor here is the whole difference between mobs walking into walls
   * and walking through them.
   */
  private stepMobs(feet: Vec3, world: SolidProbe): void {
    this.spawnMobForTick(feet, world);

    // A dead player is no mob's business: the view hides them, so nothing
    // hunts, and the damage rule below does not fire either.
    const view: MobWorldView = {
      tick: this.tick,
      playerPos: this.dead ? null : feet,
      solidAt: (p: Vec3): boolean =>
        world.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)),
    };

    const survivors: MobState[] = [];
    // this.mobList is maintained in id order, so this is the tick's order.
    for (const mob of this.mobList) {
      const next = updateMobAI(mob, view);

      // A death that happened this tick pays out once, into the same item
      // chain the broken blocks use.
      if (mob.state !== "dead" && next.state === "dead") {
        for (const stack of mobDropTable(next.kind)) {
          this.items = [
            ...this.items,
            spawnItem(
              this.nextItemId++,
              stack,
              Math.floor(next.position.x),
              Math.floor(next.position.y),
              Math.floor(next.position.z),
              this.tick,
              world,
            ),
          ];
        }
        this.nextAttackTick.delete(next.id);
      }

      // An attack lands at most once per cooldown, and never on a corpse.
      if (
        next.state === "attack" &&
        !this.dead &&
        !((this.nextAttackTick.get(next.id) ?? 0) > this.tick)
      ) {
        this.hurtByMob(next.kind);
        this.nextAttackTick.set(next.id, this.tick + MOB_ATTACK_COOLDOWN_TICKS);
      }

      // A corpse lingers for its timer and is then taken away.
      if (next.state === "dead" && next.deathTimer <= 0) {
        continue;
      }
      survivors.push(next);
    }
    this.mobList = survivors;
  }

  /**
   * The population check: at most one mob may join per check, and only
   * when every rule agrees.
   *
   * The rules: a seed exists, the cap is not full, the picked chunk is far
   * enough from the player, the spot is not inside a block, and the column
   * has a surface to stand on. Refuse and nothing spawned - the next check
   * throws the dice again, with the tick in the recipe, so a refused spawn
   * does not leave a stuck hole.
   */
  private spawnMobForTick(feet: Vec3, world: SolidProbe): void {
    if (this.mobSeed === null || this.tick % MOB_SPAWN_INTERVAL_TICKS !== 0) {
      return;
    }
    if (this.mobList.length >= MAX_MOBS) {
      return;
    }

    const seed = this.mobSeed;
    const rng = createRng(seed ^ Math.imul(this.tick, 0x2545f491));

    // Pick a chunk from the ring, then a kind, both from the same stream.
    const which = Math.floor(rng.nextFloat() * MOB_SPAWN_RING_OFFSETS.length);
    const offset = MOB_SPAWN_RING_OFFSETS[which];
    if (offset === undefined) {
      return;
    }
    const playerChunk = {
      cx: Math.floor(feet.x / CHUNK_SIZE_X),
      cz: Math.floor(feet.z / CHUNK_SIZE_Z),
    };
    const home: ChunkKey = {
      cx: playerChunk.cx + offset.cx,
      cz: playerChunk.cz + offset.cz,
    };
    const kind = pickMobKind(rng.nextFloat());

    // The id goes into the mob's own seed, so two mobs of the same kind in
    // the same chunk never share a spawn roll.
    const id = this.nextMobId;
    const mob = spawnMob(seed ^ Math.imul(id, 0x45d9f3b), kind, home, id);

    // Too close is indistinguishable from a jump scare.
    const dx = mob.position.x - feet.x;
    const dz = mob.position.z - feet.z;
    if (dx * dx + dz * dz < MOB_MIN_SPAWN_DISTANCE * MOB_MIN_SPAWN_DISTANCE) {
      return;
    }
    // And there must be ground to stand on: the column's real surface
    // replaces the layer's placeholder height.
    const surface = surfaceCellForSpawn(mob.position.x, mob.position.z, world);
    if (surface === null) {
      return;
    }

    this.nextMobId = id + 1;
    this.mobList = [
      ...this.mobList,
      { ...mob, position: { x: mob.position.x, y: surface, z: mob.position.z } },
    ];
  }

  /**
   * Eat the food in hand, if there is any and the player is hungry.
   *
   * Returns what happened, so the screen can say so: "ate" and how much
   * hunger it put back, or why it did not.
   */
  eat(): EatOutcome {
    const held = this.held();
    if (held === null) {
      return { ate: false, restored: 0, reason: "nothing-held" };
    }
    const value = foodValue(held.id);
    if (value <= 0) {
      return { ate: false, restored: 0, reason: "not-food" };
    }
    if (this.survival.dead) {
      return { ate: false, restored: 0, reason: "dead" };
    }
    if (this.survival.hunger >= MAX_HUNGER) {
      return { ate: false, restored: 0, reason: "not-hungry" };
    }
    const before = this.survival.hunger;
    this.survival = eatSurvival(this.survival, held.id);
    this.inventory = removeItem(this.inventory, held.id, 1);
    return { ate: true, restored: this.survival.hunger - before, reason: null };
  }

  /**
   * Come back to life.
   *
   * The world is NOT touched: the blocks the player broke stay broken
   * and the items they dropped stay where they fell. Only the player
   * is put back together, and the next drop they take does not count as
   * a fall until they have landed again.
   */
  respawn(): void {
    this.survival = respawnSurvival();
    this.fallTop = null;
    this.fallArmed = false;
  }

  /**
   * Take one of the held item out of the pack, for placing a block.
   *
   * Returns false when there was nothing to take, so the caller can refuse
   * the placement instead of placing blocks out of thin air.
   */
  consumeHeld(): boolean {
    const held = this.held();
    if (held === null) {
      return false;
    }
    this.inventory = removeItem(this.inventory, held.id, 1);
    return true;
  }

  /** Put an item straight into the pack, without a walk over a dropped one. */
  give(stack: ItemStack): AddResult {
    const result = addItem(this.inventory, stack);
    this.inventory = result.inventory;
    return result;
  }

  /** The items lying in the world, for the renderer to draw. */
  droppedItems(): readonly DroppedItemView[] {
    return this.items.map((item) => {
      const position = itemPosition(item, this.tick);
      return {
        id: item.id,
        x: position.x,
        y: position.y,
        z: position.z,
        block: item.stack.id as BlockId,
      };
    });
  }
}
