/**
 * Shared helpers for crafting tests.
 *
 * Grids are authored as ASCII rows: `.` and spaces are empty slots; any
 * other character maps through a legend of item ids. Legend values may
 * include a stack count after `@` (default 1), e.g. "oak_planks@4".
 */

import type { CraftingGrid, ItemStack } from "../../src/core/crafting/index.ts";

/** Convenience stack constructor (count defaults to 1). */
export function stack(item: string, count = 1): ItemStack {
  return { item, count };
}

/** Build a crafting grid from readable ASCII rows plus a symbol legend. */
export function gridFromStrings(
  rows: readonly string[],
  legend: Readonly<Record<string, string>>,
): CraftingGrid {
  const firstRow = rows[0];
  const width = firstRow?.length ?? 0;
  const slots: Array<ItemStack | null> = [];
  for (const [rowIndex, row] of rows.entries()) {
    if (row.length !== width) {
      throw new Error(`test grid row ${rowIndex} has length ${row.length}, expected ${width}`);
    }
    for (const char of row) {
      if (char === " " || char === ".") {
        slots.push(null);
        continue;
      }
      const spec = legend[char];
      if (spec === undefined) {
        throw new Error(`no legend entry for grid char "${char}"`);
      }
      const at = spec.indexOf("@");
      const item = at === -1 ? spec : spec.slice(0, at);
      const count = at === -1 ? 1 : Number.parseInt(spec.slice(at + 1), 10);
      slots.push(stack(item, count));
    }
  }
  return { width, height: rows.length, slots };
}
