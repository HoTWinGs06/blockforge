import { describe, it, expect } from "vitest";
import * as Core from "../src/core/index.js";

describe("PRIORITY 4: Core Contract Surface", () => {
  it("exports all frozen geometric constants", () => {
    expect(Core.CHUNK_SIZE_X).toBe(16);
    expect(Core.CHUNK_SIZE_Y).toBe(256);
    expect(Core.CHUNK_SIZE_Z).toBe(16);
    expect(Core.SECTION_HEIGHT).toBe(16);
    expect(Core.SECTIONS_PER_CHUNK).toBe(16);
    expect(Core.CHUNK_VOLUME).toBe(65536);
    expect(Core.WORLD_MIN_Y).toBe(0);
    expect(Core.WORLD_MAX_Y).toBe(256);
    expect(Core.SAVE_SCHEMA_VERSION).toBe(1);
    expect(Core.PROTOCOL_VERSION).toBe(1);
  });

  it("exports blockIndex, chunkKeyToString, chunkKeyFromString", () => {
    expect(typeof Core.blockIndex).toBe("function");
    expect(typeof Core.chunkKeyToString).toBe("function");
    expect(typeof Core.chunkKeyFromString).toBe("function");
  });

  it("exports BlockId enum and related frozen collections", () => {
    expect(Core.BlockId).toBeDefined();
    expect(Core.ALL_BLOCK_IDS).toBeDefined();
    expect(Core.SOLID_BLOCKS).toBeDefined();
    expect(Core.TRANSPARENT_BLOCKS).toBeDefined();
  });
});
