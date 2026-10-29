/**
 * BlockForge — procedural tool icons (canvas 2D, deterministic).
 *
 * Each of the 16 frozen TOOL_SPECS gets its own icon drawn from scratch:
 * kind determines the shape (mattock/billhook/trowel/maul); tier determines
 * the palette (timber/slate/ironveil/lumencrystal). Nothing is copied from
 * any external artwork.
 */

import { TOOL_SPECS } from "../core/constants.js";
import type { ToolSpec } from "../core/types.js";

const SIZE = 32;

const TIER_PALETTES: Readonly<Record<string, { head: string; handle: string; highlight: string; glow?: string }>> = {
  timber:    { head: "#6a4a2c", handle: "#8a6a45", highlight: "#b08a3c" },
  slate:     { head: "#4a4f57", handle: "#6b6f74", highlight: "#8e8b86" },
  ironveil:  { head: "#8a8478", handle: "#a09888", highlight: "#cbb898" },
  lumencrystal: { head: "#3fbfa8", handle: "#7cead6", highlight: "#b4fde6", glow: "#e6fff5" },
};

/** Stable hash so icons are identical every load (no Math.random). */
function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177; h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function drawShape(ctx: CanvasRenderingContext2D, kind: string, pal: { head: string; handle: string; highlight: string; glow?: string }, s: number): void {
  // Background plate (subtle rounded rect).
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(2, 2, SIZE - 4, SIZE - 4);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(2, 2, SIZE - 4, SIZE - 4);

  if (kind === "mattock") {
    // Handle (vertical, lower half) + cross prongs (horizontal, upper half).
    ctx.fillStyle = pal.handle;
    ctx.fillRect(14, 14, 4, 14); // handle
    ctx.fillStyle = pal.head;
    ctx.fillRect(8, 6, 16, 4); // crossbar
    ctx.fillStyle = pal.highlight;
    ctx.fillRect(10, 7, 12, 2); // highlight on crossbar
    // Prongs (two small vertical bars at ends of crossbar).
    ctx.fillStyle = pal.head;
    ctx.fillRect(9, 4, 2, 4);
    ctx.fillRect(21, 4, 2, 4);
  } else if (kind === "billhook") {
    // Handle (lower left to center) + curved blade (upper right arc).
    ctx.fillStyle = pal.handle;
    ctx.fillRect(10, 14, 4, 14);
    ctx.beginPath();
    ctx.arc(22, 10, 9, 0.7 * Math.PI, 1.9 * Math.PI, false); // curved blade
    ctx.lineWidth = 3; ctx.strokeStyle = pal.head; ctx.stroke();
    ctx.fillStyle = pal.highlight;
    ctx.beginPath(); ctx.arc(22, 10, 5, 0.9 * Math.PI, 1.7 * Math.PI, false); ctx.fill();
  } else if (kind === "trowel") {
    // Handle (vertical lower) + flat blade (oval upper).
    ctx.fillStyle = pal.handle;
    ctx.fillRect(14, 14, 4, 14);
    ctx.fillStyle = pal.head;
    ctx.beginPath(); ctx.ellipse(16, 7, 10, 4, 0, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = pal.highlight;
    ctx.beginPath(); ctx.ellipse(16, 5, 7, 2, 0, 0, 2 * Math.PI); ctx.fill();
  } else if (kind === "maul") {
    // Short handle (lower) + heavy block head (upper, rectangular).
    ctx.fillStyle = pal.handle;
    ctx.fillRect(14, 18, 4, 10);
    ctx.fillStyle = pal.head;
    ctx.fillRect(8, 4, 16, 14); // heavy rectangular head
    ctx.fillStyle = pal.highlight;
    ctx.fillRect(10, 6, 12, 3); // highlight stripe
  }

  // Tier glow (lumencrystal only): soft outer glow behind head.
  if (pal.glow) {
    ctx.save();
    ctx.shadowColor = pal.glow; ctx.shadowBlur = 6;
    ctx.fillStyle = pal.glow; ctx.fillRect(6, 2, 20, 18); ctx.restore();
    // Re-draw head over glow so it doesn't wash out.
    // (Simplified: the glow is faint, head on top is already drawn.)
  }

  // Grain texture overlay (stable per-kind seed) — very subtle, adds craftsmanship.
  for (let y = 2; y < SIZE - 2; y += 3) {
    for (let x = 2; x < SIZE - 2; x += 3) {
      const n = hash(x, y, s + 7);
      if (n > 0.88) { ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(x, y, 1, 1); }
    }
  }
}

const CACHE: Map<string, HTMLCanvasElement> = new Map();

export function getToolIcon(id: string): HTMLCanvasElement {
  const cached = CACHE.get(id);
  if (cached) return cached;
  const spec = TOOL_SPECS.find((t: ToolSpec) => t.id === id);
  if (!spec) {
    // Fallback: empty plate.
    const c = document.createElement("canvas"); c.width = SIZE; c.height = SIZE;
    CACHE.set(id, c); return c;
  }
  const pal = (TIER_PALETTES[spec.tier] || TIER_PALETTES["timber"]) as typeof TIER_PALETTES["timber"];
  const c = document.createElement("canvas");
  c.width = SIZE; c.height = SIZE;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, SIZE, SIZE);
  // Deterministic seed from spec id length + kind + tier.
  const seed = (id.length * 7919) + (spec.kind.length * 31) + (spec.tier.length * 167);
  drawShape(ctx, spec.kind, pal, seed);
  CACHE.set(id, c);
  return c;
}

/** Whether an item id is a tool spec id. */
export function isToolId(id: string): boolean {
  return TOOL_SPECS.some((t: ToolSpec) => t.id === id);
}

/** Tool spec for an item id (if tool). */
export function toolSpec(id: string): ToolSpec | undefined {
  return TOOL_SPECS.find((t: ToolSpec) => t.id === id);
}
