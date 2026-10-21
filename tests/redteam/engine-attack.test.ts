/**
 * BlockForge — RED-TEAM: attacks on the ENGINE's in-flight core code.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/). Owner of the fixes: ENGINE
 * (hermes-linux) — src/core/rng.ts, src/core/world/ are theirs.
 *
 * WHY THIS FILE POINTS AT A WORKTREE
 * -----------------------------------
 * The engine's core code is still IN FLIGHT: it exists as uncommitted work
 * in ~/workspace/worktrees/bf-engine, not yet as a commit on a branch this
 * test can import from. A red team that waits for the code to be committed
 * is a red team that arrives late.
 *
 * So this file resolves the engine's modules from a path that can be
 * overridden, defaulting to the engine worktree, and SKIPS itself when the
 * code is not there. The moment the engine commits, the same test runs
 * against the committed branch with no edit: set BLOCKFORGE_ENGINE_DIR to
 * point it somewhere else.
 *
 * The findings themselves are filed on the board (T44, T45, T46, T47) with
 * the exact repros. When the engine lands its code on a branch, RED-TEAM
 * flips the `it.fails` to plain `it` and these become the regression suite.
 *
 * WHAT WAS VERIFIED (by running the engine's own code, not by reading it)
 * -----------------------------------------------------------------------
 *   E1  fbm2(seed, x, z, 0) === NaN   (0/0)                -> T44
 *   E2  fork() depends on the parent's consumption history   -> T45
 *   E3  chunkIndex(16,0,0) === 16, the slot of block (0,0,1) -> T46
 *   E4  valueNoise2 aliases x and z past int32               -> T47
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Where the engine's core code lives right now. */
const ENGINE_DIR =
  process.env["BLOCKFORGE_ENGINE_DIR"] ?? join(process.env["HOME"] ?? "", "workspace/worktrees/bf-engine");

/** The engine's core source root, if it is there. */
const ENGINE_CORE = join(ENGINE_DIR, "src", "core");

/** True when the engine's code is available to attack. */
const ENGINE_PRESENT = existsSync(join(ENGINE_CORE, "rng.ts"));

/** Load the engine's modules, transpiled so they can be imported directly. */
async function loadEngine(): Promise<{
  createRng: (seed: number) => {
    nextUint32: () => number;
    nextFloat: () => number;
    nextInt: (min: number, max: number) => number;
    fork: (label: string) => { nextUint32: () => number };
    getState: () => { seed: number; state: number };
    setState: (s: { seed: number; state: number }) => void;
  };
  fbm2: (seed: number, x: number, z: number, octaves: number) => number;
  valueNoise2: (seed: number, x: number, z: number) => number;
  chunkIndex: (x: number, y: number, z: number) => number;
}> {
  const { transpileDirToTempDir } = await import("./lib/determinism-harness.js");
  const outDir = transpileDirToTempDir(ENGINE_CORE, ENGINE_CORE);
  const rng = (await import(join(outDir, "rng.js"))) as { createRng: never };
  const noise = (await import(join(outDir, "world/noise.js"))) as {
    fbm2: never;
    valueNoise2: never;
  };
  const chunk = (await import(join(outDir, "world/chunk.js"))) as { chunkIndex: never };
  return {
    createRng: rng.createRng,
    fbm2: noise.fbm2,
    valueNoise2: noise.valueNoise2,
    chunkIndex: chunk.chunkIndex,
  };
}

describe.skipIf(!ENGINE_PRESENT)("engine core — RED-TEAM attacks (T44-T47)", () => {
  it("control: the engine's core code is present to attack", () => {
    expect(ENGINE_PRESENT).toBe(true);
  });

  it.fails("E1: fbm2 must not return NaN for a zero octave count", async () => {
    const { fbm2 } = await loadEngine();
    const value = fbm2(1234, 10.5, 20.5, 0);
    expect(Number.isNaN(value)).toBe(false);
  });

  it.fails("E1: fbm2 must not return NaN for a negative octave count", async () => {
    const { fbm2 } = await loadEngine();
    const value = fbm2(1234, 10.5, 20.5, -3);
    expect(Number.isNaN(value)).toBe(false);
  });

  it.fails("E2: fork must depend only on (seed, label), not on the parent's history", async () => {
    const { createRng } = await loadEngine();
    const early = createRng(42);
    const childEarly = early.fork("terrain");
    early.nextUint32();
    const childLate = early.fork("terrain");

    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 4; i++) a.push(childEarly.nextUint32());
    for (let i = 0; i < 4; i++) b.push(childLate.nextUint32());

    expect(a.join(",")).toBe(b.join(","));
  });

  it("forking the same label twice from one parent gives the same stream (regression guard)", async () => {
    // Verified: fork() does not advance the parent, so two forks of the same
    // label from the same parent state ARE identical. That is correct and
    // desirable — it is the parent's CONSUMPTION HISTORY (E2 above) that
    // changes the child, not the number of forks.
    const { createRng } = await loadEngine();
    const parent = createRng(42);
    const first = parent.fork("terrain");
    const second = parent.fork("terrain");
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 4; i++) a.push(first.nextUint32());
    for (let i = 0; i < 4; i++) b.push(second.nextUint32());
    expect(a.join(",")).toBe(b.join(","));
  });

  it.fails("E3: chunkIndex must not alias an out-of-range x onto another block", async () => {
    const { chunkIndex } = await loadEngine();
    // The frozen blockIndex throws here. The engine's hot-path version
    // returns 16 — which is the storage slot of block (0,0,1).
    expect(chunkIndex(16, 0, 0)).toBe(-1);
  });

  it.fails("E3: chunkIndex must not produce an index one past the end of the chunk", async () => {
    const { chunkIndex } = await loadEngine();
    expect(chunkIndex(0, 256, 0)).toBe(-1);
  });

  it.fails("E4: valueNoise2 must not alias coordinates past int32", async () => {
    const { valueNoise2 } = await loadEngine();
    expect(valueNoise2(5, 2147483648, 0)).not.toBe(valueNoise2(5, -2147483648, 0));
  });

  it.fails("E4: distinct world seeds must not produce identical terrain", async () => {
    const { fbm2 } = await loadEngine();
    expect(fbm2(4294967296, 10.5, 20.5, 1)).not.toBe(fbm2(0, 10.5, 20.5, 1));
  });
});
