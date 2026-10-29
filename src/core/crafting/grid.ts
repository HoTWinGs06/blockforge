/**
 * Grid geometry helpers for crafting.
 *
 * Pure and deterministic: derived entirely from the given grid.
 */

import type { CraftingGrid, ItemStack } from "./types.ts";

/** A minimal axis-aligned rectangle holding every non-empty grid cell. */
export interface OccupiedBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

/** Grid slot at a row-major index; out-of-range reads read as empty. */
export function slotAt(grid: CraftingGrid, index: number): ItemStack | null {
  const slot = grid.slots[index];
  return slot === undefined ? null : slot;
}

/** Indices (row-major) of every non-empty slot, in ascending order. */
export function nonEmptySlots(grid: CraftingGrid): readonly number[] {
  const indices: number[] = [];
  for (const [index, slot] of grid.slots.entries()) {
    if (slot !== null) {
      indices.push(index);
    }
  }
  return indices;
}

/**
 * The bounding box of all non-empty cells, or null when the grid is empty.
 * Shaped recipe matching is translation-invariant thanks to this box.
 */
export function occupiedBox(grid: CraftingGrid): OccupiedBox | null {
  let minX = Number.MAX_SAFE_INTEGER;
  let minY = Number.MAX_SAFE_INTEGER;
  let maxX = -1;
  let maxY = -1;
  for (const [index, slot] of grid.slots.entries()) {
    if (slot === null) {
      continue;
    }
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (maxX === -1) {
    return null;
  }
  return {
    minX,
    minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}
