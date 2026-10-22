/**
 * BlockForge — RED-TEAM finding F1: frozen Sets are not actually frozen.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/). Owner of the fix: ARCHITECT (opencode)
 * — src/core/types.ts is theirs.
 *
 * STATUS: FIXED (T40). The architect's contract hardening now ships
 * `immutableSet()`, which hands out a Set whose mutating methods THROW. The
 * armed `it.fails` stubs have been converted to plain `it` regression guards
 * that assert the FIXED behaviour, so a future regression of the guard fails
 * loudly instead of silently re-arming a stale alarm.
 *
 * THE PROMISE
 * -----------
 * src/core/types.ts declares:
 *
 *     export const SOLID_BLOCKS: ReadonlySet<BlockId> = ...
 *
 * `ReadonlySet` says "you may not mutate this", and the fix makes that
 * true: the published set of solid blocks cannot change while the program
 * runs.
 *
 * THE HOLE (as it was)
 * --------------------
 * The original code was `Object.freeze(new Set<BlockId>([...]))`.
 * `Object.freeze` on a Set does NOT freeze the Set's contents. Object.freeze
 * makes an object's own PROPERTIES non-writable; a Set's members live in
 * internal slots ([[SetData]]) that Object.freeze cannot reach.
 * Set.prototype.add and .delete still work, and they still mutate the same
 * shared instance that every other module in the process holds a reference
 * to.
 *
 * WHY IT MATTERED
 * ---------------
 * Shared mutable global state in the layer that is supposed to be pure. A
 * single stray `SOLID_BLOCKS.add(...)` anywhere in the codebase changed
 * collision behaviour for every other system, invisibly: `Object.isFrozen()`
 * still reported true. It was also a determinism hazard: world behaviour then
 * depended on the ORDER in which modules happened to run, which is exactly
 * the class of bug the project's single top invariant forbids.
 *
 * REPRO (against the old code)
 * -----------------------------
 *     SOLID_BLOCKS.add("air" as BlockId);   // no throw
 *     SOLID_BLOCKS.has("air");              // true — air is now solid
 *
 * NOTE ON THE ASSERTIONS
 * ----------------------
 * They are deliberately MECHANISM-AGNOSTIC: they assert that the published
 * set of solid blocks cannot change, not that a particular call throws. A
 * Proxy that throws, a frozen array, or a getter returning a copy all
 * satisfy them. That way the test closes the finding when the owner picks
 * ANY of those routes, and cannot be satisfied by a cosmetic change.
 */

import { describe, expect, it } from "vitest";
import { BlockId, SOLID_BLOCKS, TRANSPARENT_BLOCKS } from "../../src/core/index.js";

/**
 * Try to mutate a set and report whether the published contents changed.
 * The mutation is attempted through a cast, because the TypeScript type
 * already forbids it — the hole was at RUNTIME, not in the type system.
 *
 * The original contents are restored afterwards. A red-team test must never
 * leave the contract's global state damaged for the next test in the file.
 */
function tryMutate(
  target: ReadonlySet<BlockId>,
  mutate: (set: Set<BlockId>) => void,
): { threw: boolean; changed: boolean } {
  const before = [...target];
  const beforeText = before.join(",");
  let threw = false;
  try {
    mutate(target as Set<BlockId>);
  } catch {
    threw = true;
  }
  const changed = [...target].join(",") !== beforeText;

  // Restore: put back exactly what was there, and remove anything added.
  // The guard may itself reject the write, so the restore is best-effort —
  // if the set rejected the mutation there is nothing to restore.
  try {
    const mutable = target as Set<BlockId>;
    for (const id of [...target]) {
      if (!before.includes(id)) mutable.delete(id);
    }
    for (const id of before) {
      if (!target.has(id)) mutable.add(id);
    }
  } catch {
    // The set refused the restore too: it is immutable, so it never changed.
  }

  return { threw, changed };
}

describe("F1 — control: what Object.freeze actually guarantees", () => {
  it("control: Object.freeze on an array does prevent mutation", () => {
    const frozen = Object.freeze(["a", "b"] as string[]);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(() => {
      (frozen as string[]).push("c");
    }).toThrow();
  });

  it("control: Object.freeze on a Set does NOT prevent mutation", () => {
    // Documented language behaviour, not a bug in the test. This is WHY
    // freezing a Set was never a guard.
    const frozen = Object.freeze(new Set(["a", "b"]));
    expect(Object.isFrozen(frozen)).toBe(true);
    frozen.add("c");
    expect(frozen.has("c")).toBe(true);
    frozen.delete("a");
    expect(frozen.has("a")).toBe(false);
  });

  it("control: the contract's sets are no longer published as frozen Sets", () => {
    // The fix replaced `Object.freeze(new Set(...))` with a guard that
    // rejects the mutating methods outright, so the published object is no
    // longer a frozen Set — Object.isFrozen() is now false and immutability
    // comes from the guard instead. This control pins that shape so the
    // regression guards below are known to be testing the real thing.
    expect(Object.isFrozen(SOLID_BLOCKS)).toBe(false);
  });

  it("control: SOLID_BLOCKS is immutable at runtime (the hole is closed)", () => {
    const result = tryMutate(SOLID_BLOCKS, (set) => set.add(BlockId.Air));
    expect(result.changed).toBe(false);
  });
});

describe("F1 — the published block sets must not be mutable at runtime", () => {
  it("F1: SOLID_BLOCKS must not change when add() is attempted", () => {
    const result = tryMutate(SOLID_BLOCKS, (set) => set.add(BlockId.Air));
    expect(result.changed).toBe(false);
  });

  it("F1: SOLID_BLOCKS must not change when delete() is attempted", () => {
    const result = tryMutate(SOLID_BLOCKS, (set) => set.delete(BlockId.Slate));
    expect(result.changed).toBe(false);
  });

  it("F1: SOLID_BLOCKS must not change when clear() is attempted", () => {
    const result = tryMutate(SOLID_BLOCKS, (set) => set.clear());
    expect(result.changed).toBe(false);
  });

  it("F1: TRANSPARENT_BLOCKS must not change when add() is attempted", () => {
    const result = tryMutate(TRANSPARENT_BLOCKS, (set) => set.add(BlockId.Slate));
    expect(result.changed).toBe(false);
  });

  it("F1: TRANSPARENT_BLOCKS must not change when delete() is attempted", () => {
    const result = tryMutate(TRANSPARENT_BLOCKS, (set) => set.delete(BlockId.Air));
    expect(result.changed).toBe(false);
  });

  it("F1: a consumer must not be able to rewrite collision rules for the process", () => {
    // The realistic accident: a module "helpfully" registers a new solid
    // block. With a genuinely immutable set this is impossible; with a
    // frozen Set it silently rewrites global game rules.
    const result = tryMutate(SOLID_BLOCKS, (set) => set.add(BlockId.Air));
    expect(result.changed).toBe(false);
    expect(SOLID_BLOCKS.has(BlockId.Air)).toBe(false);
  });

  it("F1: the published sets must still be usable as sets (regression guard)", () => {
    // The guard must not break the read side: consumers keep using .has(),
    // .size and iteration exactly as before.
    expect(SOLID_BLOCKS.has(BlockId.Voidstone)).toBe(true);
    expect(TRANSPARENT_BLOCKS.has(BlockId.Air)).toBe(true);
    expect(SOLID_BLOCKS.size).toBeGreaterThan(0);
    expect([...SOLID_BLOCKS].length).toBe(SOLID_BLOCKS.size);
  });
});
