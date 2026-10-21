/**
 * BlockForge — the crafting grid.
 *
 * OWNERSHIP: GAMEPLAY. Pure: no DOM, no clock, no randomness.
 *
 * A grid is a fixed square of cells. Two sizes exist and they are NOT
 * cosmetic: the inventory grid is 2x2 and the craftbench grid is 3x3, so a
 * recipe that needs three slots cannot be made in the inventory at all.
 * That is the whole reason a craftbench exists.
 *
 * Cells are indexed row-major, index = row * width + column, so the index
 * of a cell is a stable thing for the UI to hold on to.
 */

import type { ItemStack } from "../types.js";

/** A grid is either the 2x2 inventory grid or the 3x3 craftbench grid. */
export type GridSize = 2 | 3;

/** One crafting grid. `cells` has `width * width` entries, row-major. */
export interface CraftingGrid {
  readonly width: GridSize;
  readonly cells: readonly (ItemStack | null)[];
}

/** An empty grid of the given size. */
export function createGrid(width: GridSize): CraftingGrid {
  return { width, cells: new Array<ItemStack | null>(width * width).fill(null) };
}

/** The stack in a cell, or null when the cell is empty or out of range. */
export function gridAt(grid: CraftingGrid, index: number): ItemStack | null {
  return grid.cells[index] ?? null;
}

/** The same grid with one cell replaced. The input is never mutated. */
export function gridWith(
  grid: CraftingGrid,
  index: number,
  stack: ItemStack | null,
): CraftingGrid {
  const cells = grid.cells.slice();
  cells[index] = stack;
  return { width: grid.width, cells };
}

/**
 * The same grid with one item taken out of every cell in `indices`.
 *
 * A cell holding one item becomes empty; a cell holding a stack of several
 * loses exactly one. Crafting consumes ingredients, it does not swallow a
 * whole pile of them, and the count is what makes that true.
 */
export function gridWithout(
  grid: CraftingGrid,
  indices: readonly number[],
): CraftingGrid {
  const cells = grid.cells.slice();
  for (const index of indices) {
    const cell = cells[index];
    if (cell === undefined || cell === null) {
      continue;
    }
    cells[index] = cell.count > 1 ? { ...cell, count: cell.count - 1 } : null;
  }
  return { width: grid.width, cells };
}

/** The indices of the cells that hold something, ascending. */
export function occupiedCells(grid: CraftingGrid): readonly number[] {
  const out: number[] = [];
  for (let index = 0; index < grid.cells.length; index++) {
    if (grid.cells[index] !== null) {
      out.push(index);
    }
  }
  return out;
}
