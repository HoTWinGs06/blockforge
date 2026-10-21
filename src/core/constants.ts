/**
 * BlockForge — frozen world geometry constants.
 *
 * OWNERSHIP: ARCHITECT. Part of the M1 contract. These values are FROZEN.
 *
 * CHUNK LAYOUT
 * ────────────
 * A chunk is 16 x 256 x 16, split vertically into 16 sections of 16 blocks.
 * Meshing operates per section so a mesh build never has to touch more than
 * 16 y-layers at a time.
 *
 * STORAGE ORDER (frozen)
 * ──────────────────────
 * Blocks are stored y-major: for a given y, all (x, z) pairs are contiguous.
 *
 *     index = x + CHUNK_SIZE_X * (z + CHUNK_SIZE_Z * y)
 *
 * This ordering is part of the serialisation format and of the
 * byte-identical determinism guarantee. Changing it invalidates saved worlds
 * and every recorded world hash.
 */

/** Blocks along X in a chunk. */
import type {
  DayPhase,
  Season,
  ToolKind,
  ToolSpec,
  ToolTier,
} from "./types.js";

export const CHUNK_SIZE_X = 16;
/** Blocks along Y in a chunk (full world height). */
export const CHUNK_SIZE_Y = 256;
/** Blocks along Z in a chunk. */
export const CHUNK_SIZE_Z = 16;

/** Height of one meshing section. */
export const SECTION_HEIGHT = 16;
/** Number of sections in a chunk. */
export const SECTIONS_PER_CHUNK = CHUNK_SIZE_Y / SECTION_HEIGHT;

/** Total blocks in a chunk: 16 * 256 * 16 = 65536. */
export const CHUNK_VOLUME = CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z;

/** Lowest world Y (inclusive). */
export const WORLD_MIN_Y = 0;
/** Highest world Y (exclusive). */
export const WORLD_MAX_Y = CHUNK_SIZE_Y;

/**
 * Index of a block inside a chunk's block array.
 *
 * FROZEN storage order, y-major. Throws on out-of-range coordinates so that
 * a mistake fails loudly at the boundary instead of silently corrupting
 * neighbouring blocks.
 */
export function blockIndex(x: number, y: number, z: number): number {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    !Number.isInteger(z) ||
    x < 0 ||
    x >= CHUNK_SIZE_X ||
    y < 0 ||
    y >= CHUNK_SIZE_Y ||
    z < 0 ||
    z >= CHUNK_SIZE_Z
  ) {
    throw new RangeError(
      `blockIndex out of range: (${x}, ${y}, ${z}) for chunk 16x256x16`,
    );
  }
  return x + CHUNK_SIZE_X * (z + CHUNK_SIZE_Z * y);
}

/**
 * Stable string form of a chunk key. Used for map keys and save files.
 *
 * Validates both components: a key that cannot be read back is not a key, so
 * serialising a fractional, NaN or infinite coordinate would produce a string
 * that this module's own inverse rejects.
 */
export function chunkKeyToString(key: { cx: number; cz: number }): string {
  const cx = requireSafeInteger(key.cx, "cx");
  const cz = requireSafeInteger(key.cz, "cz");
  return `${cx},${cz}`;
}

/**
 * Inverse of {@link chunkKeyToString}.
 *
 * Parses STRICTLY: only a canonical decimal integer literal is accepted.
 * `Number()` alone is far too permissive - it yields 0 for "" and " ", 16 for
 * "0x10", 1000 for "1e3", 5 for "+5" and "0b101", and 1 for "1.0" - so "1,"
 * and "1,0" would address the same chunk. This is the canonical form
 * {@link chunkKeyToString} emits, so round-tripping is exact.
 */
export function chunkKeyFromString(text: string): { cx: number; cz: number } {
  const parts = text.split(",");
  if (parts.length !== 2) {
    throw new Error(`invalid chunk key: ${JSON.stringify(text)}`);
  }
  const cx = parseIntegerLiteral(parts[0] as string);
  const cz = parseIntegerLiteral(parts[1] as string);
  if (cx === null || cz === null) {
    throw new Error(`invalid chunk key: ${JSON.stringify(text)}`);
  }
  return { cx, cz };
}

/** Canonical decimal integer literal only: no sign-plus, hex, exponent, or dot. */
const INTEGER_LITERAL = /^-?(?:0|[1-9][0-9]*)$/;

function parseIntegerLiteral(text: string): number | null {
  if (!INTEGER_LITERAL.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function requireSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `chunk key ${name} must be a safe integer, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * Version of the save-file schema written by M2. Bump on any breaking change
 * to the on-disk format; readers must tolerate older versions.
 */
export const SAVE_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Break times (frozen)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seconds to break each block with a bare hand.
 *
 * Every block has its own value - no two break at the same rate - and the
 * table is FROZEN. A tool multiplies or divides these numbers; the contract
 * fixes only the baseline. Values are tuned so the common blocks near spawn
 * break in well under a second and the rare ones are a real commitment.
 */
export const BREAK_TIME_SECONDS: Readonly<Record<string, number>> = Object.freeze({
  air: 0,
  foliage: 0.1,
  emberlamp: 0.12,
  crystpane: 0.2,
  tidewater: 0.25,
  emberflow: 0.3,
  sand: 0.35,
  gravel: 0.4,
  clay: 0.45,
  regolith: 0.55,
  loam: 0.6,
  millplank: 0.7,
  timber: 0.9,
  masonry: 1.1,
  rubble: 1.3,
  slate: 1.7,
  smeltforge: 2.2,
  craftbench: 2.5,
  anthracite: 3.2,
  ironveil: 4.0,
  gildenseam: 5.0,
  lumencrystal: 6.5,
  voidstone: 9.0,
});

/** Seconds to break a block with a bare hand. Unknown kinds take the slowest. */
export function breakSeconds(id: string): number {
  const seconds = BREAK_TIME_SECONDS[id];
  return seconds === undefined ? 9.0 : seconds;
}

// ─────────────────────────────────────────────────────────────────────────────
// Day and season (frozen)
// ─────────────────────────────────────────────────────────────────────────────

/** Ticks in one full day. At 20 ticks per second, a day is 12 minutes. */
export const TICKS_PER_DAY = 14400;

/** Ticks in one full season. A year is four of these. */
export const TICKS_PER_SEASON = 57600;

/** The four seasons, in order. */
export const SEASONS: readonly Season[] = Object.freeze([
  "thaw",
  "green",
  "harvest",
  "frost",
]);

/** The four phases of a day, in order. */
export const DAY_PHASES: readonly DayPhase[] = Object.freeze([
  "dawn",
  "day",
  "dusk",
  "night",
]);

/**
 * The season at a given tick. A pure function of the tick - never the clock.
 */
export function seasonAt(tick: number): Season {
  const index = Math.floor(tick / TICKS_PER_SEASON) % SEASONS.length;
  return SEASONS[index] as Season;
}

/**
 * The day phase at a given tick. A pure function of the tick - never the clock.
 */
export function dayPhaseAt(tick: number): DayPhase {
  const index = Math.floor(tick / (TICKS_PER_DAY / DAY_PHASES.length)) % DAY_PHASES.length;
  return DAY_PHASES[index] as DayPhase;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tools (frozen)
// ─────────────────────────────────────────────────────────────────────────────

/** Every tool kind. */
export const TOOL_KINDS: readonly ToolKind[] = Object.freeze([
  "mattock",
  "billhook",
  "trowel",
  "maul",
  "sabre",
]);

/** Tool tiers, weakest first. */
export const TOOL_TIERS: readonly ToolTier[] = Object.freeze([
  "timber",
  "slate",
  "ironveil",
  "lumencrystal",
]);

/**
 * The tool table: one entry per kind and tier.
 *
 * `multiplier` scales the bare-hand break time, so a tier-1 mattock on slate
 * is 1.0 (the same as hands) and a lumencrystal mattock is 0.25 (four times
 * faster). `durability` is how many uses it survives.
 *
 * FROZEN. The crafting recipe for each of these is GAMEPLAY's; the numbers
 * here are the contract.
 */
export const TOOL_SPECS: readonly ToolSpec[] = Object.freeze([
  { id: "mattock_timber", kind: "mattock", tier: "timber", multiplier: 1.6, durability: 60 },
  { id: "mattock_slate", kind: "mattock", tier: "slate", multiplier: 1.0, durability: 130 },
  { id: "mattock_ironveil", kind: "mattock", tier: "ironveil", multiplier: 0.5, durability: 260 },
  { id: "mattock_lumencrystal", kind: "mattock", tier: "lumencrystal", multiplier: 0.25, durability: 520 },
  { id: "billhook_timber", kind: "billhook", tier: "timber", multiplier: 1.4, durability: 60 },
  { id: "billhook_slate", kind: "billhook", tier: "slate", multiplier: 1.2, durability: 130 },
  { id: "billhook_ironveil", kind: "billhook", tier: "ironveil", multiplier: 0.8, durability: 260 },
  { id: "billhook_lumencrystal", kind: "billhook", tier: "lumencrystal", multiplier: 0.5, durability: 520 },
  { id: "trowel_timber", kind: "trowel", tier: "timber", multiplier: 1.5, durability: 60 },
  { id: "trowel_slate", kind: "trowel", tier: "slate", multiplier: 1.3, durability: 130 },
  { id: "trowel_ironveil", kind: "trowel", tier: "ironveil", multiplier: 0.9, durability: 260 },
  { id: "trowel_lumencrystal", kind: "trowel", tier: "lumencrystal", multiplier: 0.6, durability: 520 },
  { id: "maul_timber", kind: "maul", tier: "timber", multiplier: 2.0, durability: 60 },
  { id: "maul_slate", kind: "maul", tier: "slate", multiplier: 1.4, durability: 130 },
  { id: "maul_ironveil", kind: "maul", tier: "ironveil", multiplier: 0.9, durability: 260 },
  { id: "maul_lumencrystal", kind: "maul", tier: "lumencrystal", multiplier: 0.55, durability: 520 },
]);

/** The tool spec for an item id, if that item is a tool. */
export function toolSpec(itemId: string): ToolSpec | undefined {
  return TOOL_SPECS.find((spec) => spec.id === itemId);
}

/**
 * The tool kind a block needs, or null if bare hands can break it.
 *
 * A block with a required kind CANNOT be broken by the wrong tool, or by
 * hands at all. That is the "wrong tool" rule, and it is what makes tools
 * worth crafting.
 */
export function requiredToolFor(id: string): ToolKind | null {
  if (
    id === "foliage" ||
    id === "timber" ||
    id === "millplank"
  ) {
    return "billhook";
  }
  if (
    id === "regolith" ||
    id === "loam" ||
    id === "sand" ||
    id === "gravel" ||
    id === "clay"
  ) {
    return "trowel";
  }
  if (
    id === "slate" ||
    id === "rubble" ||
    id === "anthracite" ||
    id === "ironveil" ||
    id === "gildenseam" ||
    id === "lumencrystal" ||
    id === "voidstone"
  ) {
    return "mattock";
  }
  if (id === "masonry" || id === "smeltforge" || id === "craftbench" || id === "crystpane") {
    return "maul";
  }
  return null;
}

/** True when this tool (or bare hands) can break the block at all. */
export function canBreak(id: string, tool: ToolSpec | null): boolean {
  const required = requiredToolFor(id);
  if (required === null) return true;
  return tool !== null && tool.kind === required;
}

/**
 * Seconds to break a block with this tool, or -1 when the tool cannot break
 * it at all. A tool of the right kind scales the bare-hand time by its
 * multiplier; a tool of the wrong kind is -1.
 */
export function breakSecondsWith(id: string, tool: ToolSpec | null): number {
  if (!canBreak(id, tool)) return -1;
  const bare = breakSeconds(id);
  if (tool === null) return bare;
  return bare * tool.multiplier;
}
