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
 * T117 / M3: THE MOBS LIVE HERE TOO. The session owns them: it decides when
 * each chunk near the player plays its spawn share, steps the AI once per
 * tick in id order, hands combat to hurtByMob() and damageMob(), and lets
 * the renderer and the netcode read the result through mobViews().
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
import { canBreak, CHUNK_SIZE_X, CHUNK_SIZE_Z, WORLD_MIN_Y, WORLD_MAX_Y } from "../core/constants.js";
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
  mobDropTable,
  spawnMob,
  updateMobAI,
  DEATH_TIMER_MAX,
  type MobWorldView,
} from "./mobs.js";
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

/** Ticks in one second. The world clock runs at twenty, and so does this. */
export const TICKS_PER_SECOND = 20;

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

/**
 * One mob, as the renderer and the netcode are allowed to see it.
 *
 * A slice of the full mob state, read-only: who it is, what it is doing,
 * where it stands and how hurt it is. Outside layers never reach the
 * internals through this - the timers, the home chunk and the id
 * bookkeeping stay inside the session.
 */
export interface MobView {
  readonly id: number;
  readonly kind: MobKind;
  readonly state: MobStateKind;
  readonly position: Vec3;
  readonly yaw: number;
  readonly health: number;
}

/* ------------------------------------------------------------------ */
/*  Mob pacing (T117). The session owns WHEN mobs appear and how      */
/*  often they may land a blow; the pure layer (mobs.ts) owns WHAT    */
/*  they do.                                                          */
/* ------------------------------------------------------------------ */

/** Chunks whose spawn share may be claimed around the player. */
const SPAWN_RING = 2;

/** A chunk farther away than this may hand its mobs back to the world. */
const DESPAWN_RING = 3;

/** The most mobs the world holds at once, however far the player walks. */
const MOB_CAP = 48;

/** Ticks a mob must wait between two blows on the player. */
const MOB_HIT_REPEAT_TICKS = 20;

/** The chunk a position falls in. */
function chunkOf(p: Vec3): ChunkKey {
  return {
    cx: Math.floor(p.x / CHUNK_SIZE_X),
    cz: Math.floor(p.z / CHUNK_SIZE_Z),
  };
}

/** Chebyshev (king-move) distance between two chunks, in chunk units. */
function chunkDistance(a: ChunkKey, b: ChunkKey): number {
  return Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cz - b.cz));
}

/**
 * Ring offsets out from a centre chunk, innermost first, ties broken by
 * cx then cz. A fixed order the plans settle in is what makes the spawn
 * set reproducible: the same seed ever builds the same mob set.
 */
const RING_OFFSETS: readonly ChunkKey[] = (() => {
  const offsets: ChunkKey[] = [];
  for (let cx = -SPAWN_RING; cx <= SPAWN_RING; cx += 1) {
    for (let cz = -SPAWN_RING; cz <= SPAWN_RING; cz += 1) {
      offsets.push({ cx, cz });
    }
  }
  const origin: ChunkKey = { cx: 0, cz: 0 };
  return offsets.sort(
    (a, b) =>
      chunkDistance(a, origin) - chunkDistance(b, origin) ||
      a.cx - b.cx ||
      a.cz - b.cz,
  );
})();

/** Mix a chunk into the session salt, so every chunk streams its own roll. */
function chunkSpawnSeed(seed: number, chunk: ChunkKey): number {
  return (
    Math.imul(chunk.cx, 0x85ebca6b) ^
    Math.imul(chunk.cz, 0xc2b2ae35) ^
    Math.imul(seed, 0x27d4eb2f)
  );
}

/**
 * Which kind a chunk's pick holds: a passive kind anywhere, and the two
 * hostile kinds only at the edge of the spawn ring - so the walk in is a
 * calm one and the danger builds up as the player pushes outward.
 */
function plannedKind(
  rng: ReturnType<typeof createRng>,
  outerRing: boolean,
): MobKind {
  const first = rng.nextFloat();
  if (outerRing && first >= 0.7) {
    return first < 0.85 ? "lurker" : "snarler";
  }
  const second = rng.nextFloat();
  if (second < 1 / 3) return "grazer";
  if (second < 2 / 3) return "flutter";
  return "shellback";
}

/** A probe that reports nothing solid: the no-world fallback. */
const EMPTY_PROBE: SolidProbe = { isSolid: () => false };

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
  /** The mobs alive, in id order - the push order is never disturbed. */
  private mobs: MobState[] = [];
  /** Chunks that have already played their spawn share. */
  private readonly mobSpawnedChunks = new Set<string>();
  /** The counter that names the next mob. */
  private nextMobId = 1;
  /** Per-mob blow cooldowns: the tick each mob's next blow may land. */
  private readonly mobCooldown = new Map<number, number>();
  /** The salt the whole mob set is derived from. */
  private readonly spawnSeed: number;

  constructor(spawnSeed = 0) {
    const { inventory } = createInventory(STARTING_KIT);
    this.inventory = inventory;
    this.spawnSeed = spawnSeed;
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
   * T117: THE MOBS TICK IN THE SAME LOOP. `world` is optional so the
   * existing callers keep compiling: with a probe the mobs walk on real
   * ground and stand on the surface; without one they run on the
   * no-refuse stub and take spawnMob's plain y.
   */
  update(
    dt: number,
    feet: Vec3,
    activity: Activity = "idle",
    onGround = true,
    world: SolidProbe | null = null,
  ): void {
    this.tickCarry += dt;
    while (this.tickCarry >= 1 / TICKS_PER_SECOND) {
      this.tickCarry -= 1 / TICKS_PER_SECOND;
      this.tick += 1;
      this.survival = advanceSurvival(this.survival, 1, activity);
      this.tickMobs(world, feet);
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
   * Step every mob one tick, then let the world keep its promise.
   *
   * Order is id order, and each mob is stepped exactly once, so the same
   * seed and the same ticks ever build the same mob set, whatever the
   * frame rate did this second.
   *
   * The blow rate is paced HERE, not in the pure layer: the AI announces
   * "attack" every tick the target is in reach, and the blows would land
   * flat-out if the session did not say no - so a mob needs
   * MOB_HIT_REPEAT_TICKS ticks between two, and a dead player takes none.
   */
  private tickMobs(world: SolidProbe | null, feet: Vec3): void {
    this.planSpawns(world, feet);
    const view: MobWorldView = {
      tick: this.tick,
      playerPos: { x: feet.x, y: feet.y, z: feet.z },
      solidAt: world
        ? (p) => world.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
        : () => false,
    };
    let stepped = this.mobs.map((mob) => updateMobAI(mob, view));
    for (const mob of stepped) {
      if (mob.state === "attack" && !this.survival.dead) {
        const at = this.mobCooldown.get(mob.id) ?? 0;
        if (this.tick >= at) {
          this.hurtByMob(mob.kind);
          this.mobCooldown.set(mob.id, this.tick + MOB_HIT_REPEAT_TICKS);
        }
      }
    }
    // A chunk that slid out of reach hands its mobs back to the world,
    // and a corpse whose linger has run out is swept away: nothing mourns
    // either, and the sweep never touches the loot on the ground.
    const origin = chunkOf(feet);
    stepped = stepped.filter((mob) => {
      if (mob.state === "dead") {
        return mob.deathTimer > 0;
      }
      return chunkDistance(mob.home, origin) <= DESPAWN_RING;
    });
    this.mobs = stepped;
  }

  /**
   * Give every near chunk its one share of mobs.
   *
   * A chunk is claimed exactly once - its claim carries whichever tick
   * it fell on, and after that it never plays again - so the same seed
   * and the same walk ever end with the same mob set. Each claim holds
   * one to three mobs, and the share stops short at the cap: a full
   * world is a full world, and it stays a full world.
   */
  private planSpawns(world: SolidProbe | null, feet: Vec3): void {
    if (this.mobs.length >= MOB_CAP) {
      return;
    }
    const origin = chunkOf(feet);
    for (const offset of RING_OFFSETS) {
      if (this.mobs.length >= MOB_CAP) {
        return;
      }
      const chunk: ChunkKey = { cx: origin.cx + offset.cx, cz: origin.cz + offset.cz };
      const key = `${chunk.cx}:${chunk.cz}`;
      if (this.mobSpawnedChunks.has(key)) {
        continue;
      }
      this.mobSpawnedChunks.add(key);
      const rng = createRng(chunkSpawnSeed(this.spawnSeed, chunk));
      const share = 1 + Math.floor(rng.nextFloat() * 3);
      const outerRing = chunkDistance(chunk, origin) >= SPAWN_RING;
      for (let n = 0; n < share; n += 1) {
        if (this.mobs.length >= MOB_CAP) {
          return;
        }
        const kind = plannedKind(rng, outerRing);
        const mob = spawnMob(this.spawnSeed, kind, chunk, this.nextMobId++);
        this.mobs.push(world === null ? mob : this.standMobOnGround(mob, world));
      }
    }
  }

  /**
   * The ground decides where a mob stands, not the pure layer's guess.
   *
   * spawnMob's plain y is a starts-somewhere square; with a probe the
   * session walks the column and puts the mob on the first solid block
   * under open sky, in the cell it already found itself in.
   */
  private standMobOnGround(mob: MobState, world: SolidProbe): MobState {
    const column = Math.floor(mob.position.x);
    const row = Math.floor(mob.position.z);
    return {
      ...mob,
      position: {
        x: mob.position.x,
        y: this.surfaceY(column, row, world),
        z: mob.position.z,
      },
    };
  }

  /** First y from the sky down that is solid with air above it. */
  private surfaceY(x: number, z: number, world: SolidProbe): number {
    for (let y = WORLD_MAX_Y - 1; y > WORLD_MIN_Y; y -= 1) {
      if (world.isSolid(x, y, z) && !world.isSolid(x, y + 1, z)) {
        return y + 1;
      }
    }
    return 2; // nothing in the column: keep spawnMob's plain spawn height
  }

  /**
   * Drop a dead mob's share where it fell.
   *
   * The loot lands at death, not when the corpse is swept away, so the
   * player watches their prize hit the ground while the body still lies
   * there.
   */
  private dropMobLoot(mob: MobState, world: SolidProbe | null): void {
    const probe = world ?? EMPTY_PROBE;
    for (const stack of mobDropTable(mob.kind)) {
      this.items = [
        ...this.items,
        spawnItem(
          this.nextItemId++,
          stack,
          Math.floor(mob.position.x),
          Math.floor(mob.position.y),
          Math.floor(mob.position.z),
          this.tick,
          probe,
        ),
      ];
    }
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
   * A blow from the player's weapon lands on a mob.
   *
   * The mob takes the damage; reaching zero health flips it to dead,
   * starts its death linger and drops its share of loot right where it
   * fell. The caller learns whether it was the killing blow.
   */
  damageMob(id: number, amount: number, world: SolidProbe | null = null): boolean {
    const target = this.mobs.find((mob) => mob.id === id);
    if (target === undefined || target.state === "dead") {
      return false;
    }
    const health = Math.max(0, target.health - amount);
    const next: MobState =
      health <= 0
        ? {
            ...target,
            health,
            state: "dead",
            deathTimer: DEATH_TIMER_MAX,
            velocity: { x: 0, y: 0, z: 0 },
          }
        : { ...target, health };
    this.mobs = this.mobs.map((mob) => (mob.id === id ? next : mob));
    if (health <= 0) {
      this.dropMobLoot(next, world);
    }
    return health <= 0;
  }

  /**
   * The mobs the outside may look at, in id order.
   *
   * The renderer draws them from this and the netcode sends it; neither
   * one sees anything it could turn into a state change.
   */
  mobViews(): readonly MobView[] {
    return this.mobs.map((mob) => ({
      id: mob.id,
      kind: mob.kind,
      state: mob.state,
      position: { ...mob.position },
      yaw: mob.yaw,
      health: mob.health,
    }));
  }

  /** How many mobs the world is holding right now. */
  mobCount(): number {
    return this.mobs.length;
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
