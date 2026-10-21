import { describe, it, expect } from "vitest";
import {
  BlockId,
  ALL_BLOCK_IDS,
  SOLID_BLOCKS,
  TRANSPARENT_BLOCKS,
  PROTOCOL_VERSION,
} from "../src/core/index.js";

describe("PRIORITY 4: Core Types and Originality Invariants", () => {
  describe("BlockId", () => {
    it("has only non-empty string values", () => {
      for (const id of ALL_BLOCK_IDS) {
        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(0);
      }
    });

    it("ALL_BLOCK_IDS matches declaration order and contains all enum values", () => {
      const enumValues = Object.values(BlockId);
      expect(ALL_BLOCK_IDS).toEqual(enumValues);
    });

    it("verifies originality: NO prohibited Mojang block names are used", () => {
      const prohibitedMojangNames = [
        "stone",
        "cobblestone",
        "dirt",
        "grass",
        "grass_block",
        "bedrock",
        "sandstone",
        "oak_log",
        "log",
        "leaves",
        "oak_leaves",
        "diamond",
        "diamond_ore",
        "coal",
        "coal_ore",
        "iron",
        "iron_ore",
        "gold",
        "gold_ore",
        "redstone",
        "lapis",
        "emerald",
        "netherrack",
        "obsidian",
        "water",
        "lava",
        "glass",
        "torch",
        "furnace",
        "crafting_table",
        "planks",
      ];

      for (const id of ALL_BLOCK_IDS) {
        expect(prohibitedMojangNames).not.toContain(id.toLowerCase());
      }
    });
  });

  describe("SOLID_BLOCKS and TRANSPARENT_BLOCKS", () => {
    it("are ReadonlySet instances containing valid BlockIds", () => {
      expect(SOLID_BLOCKS).toBeInstanceOf(Set);
      expect(TRANSPARENT_BLOCKS).toBeInstanceOf(Set);

      for (const id of SOLID_BLOCKS) {
        expect(ALL_BLOCK_IDS).toContain(id);
      }
      for (const id of TRANSPARENT_BLOCKS) {
        expect(ALL_BLOCK_IDS).toContain(id);
      }
    });

    it("properly classifies non-solid transparent blocks", () => {
      expect(SOLID_BLOCKS.has(BlockId.Air)).toBe(false);
      expect(TRANSPARENT_BLOCKS.has(BlockId.Air)).toBe(true);

      expect(SOLID_BLOCKS.has(BlockId.Tidewater)).toBe(false);
      expect(TRANSPARENT_BLOCKS.has(BlockId.Tidewater)).toBe(true);

      expect(SOLID_BLOCKS.has(BlockId.Emberflow)).toBe(false);
      expect(TRANSPARENT_BLOCKS.has(BlockId.Emberflow)).toBe(true);
    });

    it("properly classifies solid blocks", () => {
      expect(SOLID_BLOCKS.has(BlockId.Voidstone)).toBe(true);
      expect(SOLID_BLOCKS.has(BlockId.Slate)).toBe(true);
      expect(SOLID_BLOCKS.has(BlockId.Rubble)).toBe(true);
      expect(SOLID_BLOCKS.has(BlockId.Timber)).toBe(true);
      expect(SOLID_BLOCKS.has(BlockId.Masonry)).toBe(true);
    });

    it("properly classifies glass-like crystpane as both solid and transparent", () => {
      expect(SOLID_BLOCKS.has(BlockId.Crystpane)).toBe(true);
      expect(TRANSPARENT_BLOCKS.has(BlockId.Crystpane)).toBe(true);
    });
  });

  describe("Protocol Envelope", () => {
    it("has frozen PROTOCOL_VERSION 1", () => {
      expect(PROTOCOL_VERSION).toBe(1);
    });
  });
});
