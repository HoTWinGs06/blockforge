/**
 * BlockForge — RED-TEAM: attacks on the ENGINE's core code.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/). Owner of the fixes: ENGINE
 * (hermes-linux) — src/core/rng.ts, src/core/noise.ts, src/core/world.ts.
 *
 * WHY THIS FILE NOW IMPORTS THE REPO'S OWN CORE
 * ----------------------------------------------
 * This file used to resolve the engine's modules out of a sibling worktree
 * (`~/workspace/worktrees/bf-engine`) through a transpile-to-temp-dir
 * harness, because at the time the engine's code was uncommitted work in
 * flight. That is no longer true: the engine's code is committed, merged
 * into `feature/integrated/m1`, and laid out FLAT (`src/core/rng.ts`,
 * `src/core/noise.ts`, `src/core/world.ts`).
 *
 * So the old indirection was not just unnecessary, it was WRONG: it pointed
 * at `world/chunk.js` and `world/noise.js`, paths that no longer exist. Every
 * armed `it.fails` in this file was therefore GREEN FOR THE WRONG REASON —
 * the dynamic import threw, the test body threw, and `it.fails` reported a
 * pass. An alarm that is green because the probe is broken is worse than no
 * alarm at all: it cannot announce its own closure.
 *
 * The attacks now import the repo's own `src/core` — the same code the build
 * runs and the same code the dispatcher merges — so a green stub here means
 * the finding is genuinely still open.
 *
 * WHAT WAS VERIFIED (by running the engine's own code, not by reading it)
 * -----------------------------------------------------------------------
 *   E1  fbm2(seed, x, z, 0) === NaN   (0/0)                -> T44  FIXED
 *   E2  fork() depends on the parent's consumption history   -> T45  FIXED
 *   E3  chunkIndex(16,0,0) === 16, the slot of block (0,0,1) -> T46  FIXED
 *   E4  valueNoise2 aliases x and z past int32              -> T47  FIXED
 *   E5  the SEED still aliases at the RNG layer: createRng(2^32) and
 *       createRng(0) are the same stream, and two worlds with those
 *       seeds hash the same with no chunks loaded            -> T88  OPEN
 *
 * The findings are filed on the board (T44-T47, T88) with the exact repros.
 * A finding that is FIXED becomes a plain `it` here, asserting the FIXED
 * behaviour, so it is a regression guard rather than a stale alarm. A
 * finding that is still OPEN keeps its `it.fails`, so the suite stays green
 * for every other agent while the alarm stays armed.
 */

import { describe, expect, it } from "vitest";
import { World, chunkIndex, createRng, fbm2, valueNoise2 } from "../../src/core/index.js";

/** The first four uint32s a seed produces, as one comparable string. */
function rngStream(seed: number): string {
  const rng = createRng(seed);
  const draws: number[] = [];
  for (let i = 0; i < 4; i++) draws.push(rng.nextUint32());
  return draws.join(",");
}

describe("engine core — RED-TEAM attacks (T44-T47, T88)", () => {
  it("E1: fbm2 must not return NaN for a zero octave count", () => {
    const value = fbm2(1234, 10.5, 20.5, 0);
    expect(Number.isNaN(value)).toBe(false);
  });

  it("E1: fbm2 must not return NaN for a negative octave count", () => {
    const value = fbm2(1234, 10.5, 20.5, -3);
    expect(Number.isNaN(value)).toBe(false);
  });

  it("E2: fork must depend only on (seed, label), not on the parent's history", () => {
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

  it("forking the same label twice from one parent gives the same stream (regression guard)", () => {
    // Verified: fork() does not advance the parent, so two forks of the same
    // label from the same parent state ARE identical. That is correct and
    // desirable — it is the parent's CONSUMPTION HISTORY (E2 above) that
    // changed the child, not the number of forks.
    const parent = createRng(42);
    const first = parent.fork("terrain");
    const second = parent.fork("terrain");
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 4; i++) a.push(first.nextUint32());
    for (let i = 0; i < 4; i++) b.push(second.nextUint32());
    expect(a.join(",")).toBe(b.join(","));
  });

  it("E3: chunkIndex must not alias an out-of-range x onto another block", () => {
    // The frozen blockIndex throws here, and chunkIndex now delegates to it,
    // so an out-of-range coordinate throws instead of silently aliasing
    // onto another block's storage slot.
    expect(() => chunkIndex(16, 0, 0)).toThrow(RangeError);
  });

  it("E3: chunkIndex must not produce an index one past the end of the chunk", () => {
    expect(() => chunkIndex(0, 256, 0)).toThrow(RangeError);
  });

  it("E4: valueNoise2 must not alias coordinates past int32", () => {
    expect(valueNoise2(5, 2147483648, 0)).not.toBe(valueNoise2(5, -2147483648, 0));
  });

  it("E4: distinct world seeds must not produce identical terrain", () => {
    expect(fbm2(4294967296, 10.5, 20.5, 1)).not.toBe(fbm2(0, 10.5, 20.5, 1));
  });

  it("E4: the noise lattice must not alias in z either", () => {
    expect(valueNoise2(5, 0, 2147483648)).not.toBe(valueNoise2(5, 0, -2147483648));
  });

  // ── E5: the SEED still aliases at the RNG layer ────────────────────────
  // The engine's T47 fix (c97eb34) covered the NOISE layer: the lattice and
  // the noise seed are now folded from both 32-bit halves. It deliberately did
  // NOT cover src/core/rng.ts, which still does `this.seed = seed >>> 0`.
  // So two seeds 2^32 apart are the same stream, and the terrain that the
  // noise layer separates is re-joined by everything the RNG drives.
  it("control: the seed probe is live — nearby seeds do NOT alias", () => {
    expect(rngStream(0)).not.toBe(rngStream(1));
  });

  it.fails("E5: the RNG must not alias two seeds that differ by 2^32", () => {
    expect(rngStream(4294967296)).not.toBe(rngStream(0));
  });

  it.fails("E5: two worlds with different seeds must never hash the same", () => {
    // World.hash()'s own docstring promises exactly this: "The SEED is
    // mixed in first, so two worlds with different seeds can never hash the
    // same however few chunks they have loaded." It mixes `seed >>> 0`, so
    // the promise is false for any pair of seeds 2^32 apart.
    expect(new World(4294967296).hash()).not.toBe(new World(0).hash());
  });
});
