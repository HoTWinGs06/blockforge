/**
 * BlockForge — procedural texture atlas.
 *
 * ORIGINALITY: every pixel here is generated from scratch at runtime with
 * canvas 2D. No image file is committed to this repository, and nothing here
 * is copied, traced, or approximated from any existing game's artwork. The
 * palette and the noise below are BlockForge's own.
 *
 * The atlas is a 2D grid of 16x16 tiles, one per block kind, generated on
 * demand and cached. Tiles are deliberately low-contrast and grainy so the
 * world reads as hand-made stone/earth rather than anything imitative.
 */

import * as THREE from "three";
import { BlockId } from "../core/types.js";

export const TILE_PX = 16;
export const ATLAS_COLUMNS = 8;

/** Block kinds that get a solid tile, in a fixed order (index == atlas slot). */
const TILE_ORDER: readonly BlockId[] = [
  BlockId.Voidstone,
  BlockId.Slate,
  BlockId.Rubble,
  BlockId.Regolith,
  BlockId.Loam,
  BlockId.Sand,
  BlockId.Gravel,
  BlockId.Clay,
  BlockId.Timber,
  BlockId.Foliage,
  BlockId.Tidewater,
  BlockId.Emberflow,
  BlockId.Crystpane,
  BlockId.Masonry,
  BlockId.Anthracite,
  BlockId.Ironveil,
  BlockId.Gildenseam,
  BlockId.Lumencrystal,
  BlockId.Emberlamp,
  BlockId.Smeltforge,
  BlockId.Craftbench,
  BlockId.Millplank,
];

interface Palette {
  readonly base: string;
  readonly speck: string;
  readonly dark: string;
  readonly light: string;
}

/**
 * BlockForge's own palette. Warm, desaturated earth tones for the ground
 * family, cool greys for stone, and saturated accents for the rare kinds.
 */
const PALETTES: Readonly<Record<BlockId, Palette>> = {
  [BlockId.Air]:            { base: "#00000000", speck: "#00000000", dark: "#00000000", light: "#00000000" },
  [BlockId.Voidstone]:      { base: "#17151f", speck: "#221f2e", dark: "#0d0c12", light: "#2b2739" },
  [BlockId.Slate]:          { base: "#4a4f57", speck: "#575d66", dark: "#383c43", light: "#666d77" },
  [BlockId.Rubble]:         { base: "#6b6f74", speck: "#7d8288", dark: "#54575b", light: "#9096 9c".replace(" ", "") },
  [BlockId.Regolith]:       { base: "#8a6a4a", speck: "#9a7854", dark: "#6e5238", light: "#ac8962" },
  [BlockId.Loam]:           { base: "#5f4630", speck: "#6d5239", dark: "#4a3625", light: "#7d6043" },
  [BlockId.Sand]:           { base: "#cbb98c", speck: "#d8c79b", dark: "#b0a078", light: "#e4d6af" },
  [BlockId.Gravel]:         { base: "#8a8880", speck: "#9b998f", dark: "#6e6c65", light: "#aeaca1" },
  [BlockId.Clay]:           { base: "#9a6a63", speck: "#ab7a72", dark: "#7d544e", light: "#bb8d85" },
  [BlockId.Timber]:         { base: "#6a4a2c", speck: "#7a5836", dark: "#513923", light: "#8a6a44" },
  [BlockId.Foliage]:        { base: "#3f6b34", speck: "#4b7b3e", dark: "#315329", light: "#5a8f4b" },
  [BlockId.Tidewater]:      { base: "#2f5a8c", speck: "#3a6a9f", dark: "#244673", light: "#4f81b3" },
  [BlockId.Emberflow]:      { base: "#a64b28", speck: "#c25c33", dark: "#843c1f", light: "#dc7443" },
  [BlockId.Crystpane]:      { base: "#7d8fa0", speck: "#94a6b8", dark: "#62737f", light: "#b4c6d8" },
  [BlockId.Masonry]:        { base: "#6d6a66", speck: "#7c7975", dark: "#575450", light: "#8e8b86" },
  [BlockId.Anthracite]:     { base: "#26262a", speck: "#313138", dark: "#1a1a1d", light: "#40404a" },
  [BlockId.Ironveil]:       { base: "#8a8478", speck: "#9a9487", dark: "#6f6a60", light: "#aba598" },
  [BlockId.Gildenseam]:     { base: "#b08a3c", speck: "#c49c47", dark: "#8e6e2f", light: "#d9b364" },
  [BlockId.Lumencrystal]:   { base: "#3fbfa8", speck: "#4fd6bd", dark: "#2f9a87", light: "#7cead6" },
  [BlockId.Emberlamp]:      { base: "#d08a3a", speck: "#e5a052", dark: "#a86c2c", light: "#f6c47c" },
  [BlockId.Smeltforge]:     { base: "#5a4a48", speck: "#6a5854", dark: "#473a38", light: "#7d6a66" },
  [BlockId.Craftbench]:     { base: "#7a5c3a", speck: "#8d6c45", dark: "#614a2f", light: "#a17f53" },
  [BlockId.Millplank]:      { base: "#8a6a45", speck: "#9c7950", dark: "#6e5438", light: "#b08c60" },
};

/**
 * Deterministic per-tile noise. The texture must look the same every time
 * the page loads, so this uses a small integer hash rather than Math.random.
 */
function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function drawTile(ctx: CanvasRenderingContext2D, ox: number, oy: number, id: BlockId): void {
  const pal = PALETTES[id];
  ctx.fillStyle = pal.base;
  ctx.fillRect(ox, oy, TILE_PX, TILE_PX);

  // A stable seed per block kind keeps each kind's grain consistent.
  const seed = id.length * 7919;

  // Grain speckle.
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const n = hash2(x, y, seed);
      if (n > 0.86) {
        ctx.fillStyle = pal.light;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      } else if (n < 0.14) {
        ctx.fillStyle = pal.dark;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      } else if (n > 0.74) {
        ctx.fillStyle = pal.speck;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }

  // Kind-specific structure, drawn with a stable hash so it never shimmers.
  if (id === BlockId.Timber || id === BlockId.Millplank || id === BlockId.Craftbench) {
    // Vertical grain.
    for (let x = 0; x < TILE_PX; x++) {
      if (hash2(x, 0, seed + 11) > 0.55) {
        ctx.fillStyle = pal.dark;
        ctx.fillRect(ox + x, oy, 1, TILE_PX);
      }
    }
  } else if (id === BlockId.Foliage) {
    // Clumpy canopy.
    for (let y = 0; y < TILE_PX; y += 3) {
      for (let x = 0; x < TILE_PX; x += 3) {
        if (hash2(x, y, seed + 23) > 0.5) {
          ctx.fillStyle = pal.dark;
          ctx.fillRect(ox + x, oy + y, 2, 2);
        }
      }
    }
  } else if (id === BlockId.Slate || id === BlockId.Masonry || id === BlockId.Smeltforge) {
    // Brick-ish courses.
    for (let y = 0; y < TILE_PX; y += 8) {
      ctx.fillStyle = pal.dark;
      ctx.fillRect(ox, oy + y, TILE_PX, 1);
    }
    for (let y = 0; y < TILE_PX; y += 8) {
      const offset = ((y / 8) % 2) * 4;
      for (let x = offset; x < TILE_PX; x += 8) {
        ctx.fillRect(ox + x, oy + y, 1, 8);
      }
    }
  } else if (id === BlockId.Lumencrystal || id === BlockId.Crystpane || id === BlockId.Ironveil) {
    // Faceted highlight.
    ctx.fillStyle = pal.light;
    for (let y = 2; y < TILE_PX - 2; y += 5) {
      const w = 3 + Math.floor(hash2(y, 3, seed) * 4);
      ctx.fillRect(ox + 3, oy + y, w, 2);
    }
  } else if (id === BlockId.Emberflow || id === BlockId.Emberlamp) {
    // Glowing embers.
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(hash2(i, 1, seed) * TILE_PX);
      const y = Math.floor(hash2(i, 2, seed) * TILE_PX);
      ctx.fillStyle = pal.light;
      ctx.fillRect(ox + x, oy + y, 2, 2);
    }
  } else if (id === BlockId.Tidewater) {
    // Wavy banding.
    for (let y = 0; y < TILE_PX; y += 4) {
      const shift = Math.floor(hash2(y, 0, seed) * 4);
      ctx.fillStyle = pal.light;
      ctx.fillRect(ox + shift, oy + y, TILE_PX - shift, 1);
    }
  }

  // A subtle top-light / bottom-shade so blocks read as lit volumes.
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(ox, oy, TILE_PX, 1);
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.fillRect(ox, oy + TILE_PX - 1, TILE_PX, 1);
}

/** Slot index in the atlas for a block kind. */
export function tileIndex(id: BlockId): number {
  const i = TILE_ORDER.indexOf(id);
  return i < 0 ? 0 : i;
}

/** Total atlas size in pixels. */
export function atlasSize(): { width: number; height: number } {
  const rows = Math.ceil(TILE_ORDER.length / ATLAS_COLUMNS);
  return { width: ATLAS_COLUMNS * TILE_PX, height: rows * TILE_PX };
}

/**
 * Build the atlas canvas. Exposed separately so it can be unit-tested and
 * so a headless run can assert that it produced real pixels.
 */
export function buildAtlasCanvas(): HTMLCanvasElement {
  const { width, height } = atlasSize();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable - cannot build the texture atlas");
  }
  ctx.imageSmoothingEnabled = false;
  TILE_ORDER.forEach((id, index) => {
    const ox = (index % ATLAS_COLUMNS) * TILE_PX;
    const oy = Math.floor(index / ATLAS_COLUMNS) * TILE_PX;
    drawTile(ctx, ox, oy, id);
  });
  return canvas;
}

let cached: THREE.Texture | null = null;

/** The shared atlas texture (built once, reused). */
export function getAtlasTexture(): THREE.Texture {
  if (cached) {
    return cached;
  }
  const canvas = buildAtlasCanvas();
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  cached = texture;
  return texture;
}

/**
 * UVs for a face of a block kind, as four [u, v] corners in atlas space.
 * The mesher supplies per-triangle block ids, so the renderer resolves them
 * to atlas coordinates here.
 */
export function faceUv(id: BlockId): Array<[number, number]> {
  const index = tileIndex(id);
  const col = index % ATLAS_COLUMNS;
  const row = Math.floor(index / ATLAS_COLUMNS);
  const u0 = (col * TILE_PX) / (ATLAS_COLUMNS * TILE_PX);
  const u1 = ((col + 1) * TILE_PX) / (ATLAS_COLUMNS * TILE_PX);
  const v1 = 1 - (row * TILE_PX) / (atlasSize().height);
  const v0 = 1 - ((row + 1) * TILE_PX) / (atlasSize().height);
  return [
    [u0, v1],
    [u1, v1],
    [u1, v0],
    [u0, v0],
  ];
}
