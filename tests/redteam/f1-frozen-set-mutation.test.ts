/**
 * BlockForge — RED-TEAM finding F1: frozen Sets are not actually frozen.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/). Owner of the fix: ARCHITECT (opencode)
 * — src/core/types.ts is theirs.
 *
 * THE PROMISE
 * -----------
 * src/core/types.ts declares:
 *
 *     export const SOLID_BLOCKS: ReadonlySet<BlockId> = Object.freeze(
 *       new Set<BlockId>([...]),
 *     );
 *
 * `ReadonlySet` says "you may not mutate this" and `Object.freeze` says
 * "this object is frozen". Both are supposed to mean: the set of solid
 * blocks cannot change while the program runs.
 *
 * THE HOLE
 * --------
 * `Object.freeze` on a Set does NOT freeze the Set's contents. Object.freeze
 * makes an object's own PROPERTIES non-writable; a Set's members live in
 * internal slots ([[SetData]]) that Object.freeze cannot reach. Set.prototype
 * .add and .delete still work, and they still mutate the same shared instance
 * that every other module in the process holds a reference to.
 *
 * WHY IT MATTERS HERE
 * -------------------
 * This is shared mutable global state in the layer that is supposed to be
 * pure. A single stray `SOLID_BLOCKS.add(...)` anywhere in the codebase
 * changes collision behaviour for every other system, and the change is
 * invisible: Object.isFrozen() still reports true, so a reviewer's eye goes
 * straight past it. It is also a determinism hazard: world behaviour then
 * depends on the ORDER in which modules happened to run, which is exactly
 * the class of bug the project's single top invariant forbids.
 *
 * REPRO
 * -----
 *     SOLID_BLOCKS.add("air" as BlockId);   // no throw
 *     SOLID_BLOCKS.has("air");              // true — air is now solid
 *
 * FIX DIRECTION (for the owner, not for me — I do not edit implementation)
 * -------------------------------------------------------------------------
 * Options, cheapest first:
 *   1. Keep the Set but hand out a Proxy that throws on add/delete/clear.
 *   2. Export a frozen ARRAY (Object.freeze([...]) really does freeze) plus
 *      an `isSolid(block)` helper that does a lookup.
 *   3. Keep the Set but never export it — export only lookup functions.
 * Any of these makes the promise true. The frozen-SET idiom is the bug.
 *
 * NOTE ON THE ASSERTIONS
 * ----------------------
 * They are deliberately MECHANISM-AGNOSTIC: they assert that the published
 * set of solid blocks cannot change, not that a particular call throws. A
 * Proxy that throws, a frozen array, or a getter returning a copy all close
 * this finding. That way the test closes the finding when the owner picks
 * ANY of those routes, and cannot be satisfied by a cosmetic change.
 */

import { describe, expect, it } from "vitest";
import { BlockId, SOLID_BLOCKS, TRANSPARENT_BLOCKS } from "../../src/core/index.js";

/**
 * Try to mutate a set and report whether the published contents changed.
 * The mutation is attempted through a cast, because the TypeScript type
 * already forbids it — the hole is at RUNTIME, not in the type system.
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
  const mutable = target as Set<BlockId>;
  for (const id of [...target]) {
    if (!before.includes(id)) mutable.delete(id);
  }
  for (const id of before) {
    if (!target.has(id)) mutable.add(id);
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
    // Documented language behaviour, not a bug in the test.
    const frozen = Object.freeze(new Set(["a", "b"]));
    expect(Object.isFrozen(frozen)).toBe(true);
    frozen.add("c");
    expect(frozen.has("c")).toBe(true);
    frozen.delete("a");
    expect(frozen.has("a")).toBe(false);
  });

  it("control: the contract's sets report themselves as frozen", () => {
    expect(Object.isFrozen(SOLID_BLOCKS)).toBe(true);
    expect(Object.isFrozen(TRANSPARENT_BLOCKS)).toBe(true);
  });

  it("control: SOLID_BLOCKS is currently mutable at runtime (the hole)", () => {
    const result = tryMutate(SOLID_BLOCKS, (set) => set.add(BlockId.Air));
    expect(result.changed).toBe(true);
  });
});

describe("F1 — the published block sets must not be mutable at runtime", () => {
  it.fails("F1: SOLID_BLOCKS must not change when add() is attempted", () => {
    const result = tryMutate(SOLID_BLOCKS, (set) => set.add(BlockId.Air));
    expect(result.changed).toBe(false);
  });

  it.fails("F1: SOLID_BLOCKS must not change when delete() is attempted", () => {
    const result = tryMutate(SOLID_BLOCKS, (set) => set.delete(BlockId.Slate));
    expect(result.changed).toBe(false);
  });

  it.fails("F1: SOLID_BLOCKS must not change when clear() is attempted", () => {
    const result = tryMutate(SOLID_BLOCKS, (set) => set.clear());
    expect(result.changed).toBe(false);
  });

  it.fails("F1: TRANSPARENT_BLOCKS must not change when add() is attempted", () => {
    const result = tryMutate(TRANSPARENT_BLOCKS, (set) => set.add(BlockId.Slate));
    expect(result.changed).toBe(false);
  });

  it.fails("F1: TRANSPARENT_BLOCKS must not change when delete() is attempted", () => {
    const result = tryMutate(TRANSPARENT_BLOCKS, (set) => set.delete(BlockId.Air));
    expect(result.changed).toBe(false);
  });

  it.fails("F1: a consumer must not be able to rewrite collision rules for the process", () => {
    // The realistic accident: a module "helpfully" registers a new solid
    // block. With a genuinely immutable set this is impossible; with a
    // frozen Set it silently rewrites global game rules.
    const result = tryMutate(SOLID_BLOCKS, (set) => set.add(BlockId.Air));
    expect(result.changed).toBe(false);
    expect(SOLID_BLOCKS.has(BlockId.Air)).toBe(false);
  });
});
