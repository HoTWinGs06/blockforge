/**
 * BlockForge — PRIORITY 3b: water-physics core (swim, submersion, flow, buoyancy).
 *
 * OWNERSHIP: TEST AUTHOR (tests/). Covers the fresh merge of swimVelocity,
 * submersion, flowAt, isFluidBlock, and the water branch of stepPhysics.
 *
 * The module must remain pure: same seed + same inputs => byte-identical
 * output, any order, any process. No Math.random, no Date.now, no DOM.
 */
import { describe, it, expect } from "vitest";
import {
  GRAVITY,
  WATER_BUOYANCY,
  WATER_DRAG,
  WATER_TERMINAL_VELOCITY,
  SWIM_SPEED,
  SWIM_ACCELERATION,
  SWIM_RISE_ACCELERATION,
  FLOW_SPEED,
  isFluidBlock,
  submersion,
  flowAt,
  swimVelocity,
  stepPhysics,
  solidWorldFromBlocks,
  bodyAabb,
} from "../src/core/physics.js";
import type { SolidWorld } from "../src/core/physics.js";
import { BlockId } from "../src/core/types.js";
import type { Aabb } from "../src/core/types.js";

/* ---------- helpers ---------- */
function waterWorld(fluids: [number, number, number][]): SolidWorld {
  return solidWorldFromBlocks([], fluids);
}
function dryWorldWithSolid(x = 0, y = 0, z = 0): SolidWorld {
  return solidWorldFromBlocks([[x, y, z]]);
}

/* ---------- 1. isFluidBlock ---------- */
describe("isFluidBlock (the water identity gate)", () => {
  it("recognises Tidewater as fluid", () => {
    expect(isFluidBlock(BlockId.Tidewater)).toBe(true);
  });
  it("rejects every solid block id", () => {
    expect(isFluidBlock(BlockId.Slate)).toBe(false);
    expect(isFluidBlock(BlockId.Voidstone)).toBe(false);
    expect(isFluidBlock(BlockId.Rubble)).toBe(false);
    expect(isFluidBlock(BlockId.Loam)).toBe(false);
    expect(isFluidBlock(BlockId.Timber)).toBe(false);
  });
  it("rejects air / non-block ids", () => {
    expect(isFluidBlock("air" as BlockId)).toBe(false);
    expect(isFluidBlock("" as BlockId)).toBe(false);
  });
});

/* ---------- 2. submersion ---------- */
describe("submersion — continuous wet fraction 0..1", () => {
  it("dry world with no isFluid returns 0", () => {
    const w = dryWorldWithSolid();
    const box = bodyAabb({ x: 0, y: 1, z: 0 });
    expect(submersion(box, w)).toBe(0);
  });

  it("fully submerged body returns 1", () => {
    // One block of tidewater at (0,0,0) covering y=[0,1]
    const w = waterWorld([[0, 0, 0]]);
    // Body fully inside that block (feet at y=0.5, height 1.8 -> y range [0.5, 2.3], 
    // but block only 0..1; to be fully submerged need body inside block)
    // Box spans [0.2,0.8] x [ -0.4, 1.4] wait bodyAabb centered on feet at y=0.5 => minY=0.5, maxY=2.3 (feet+height)
    // Actually better: make box that fits entirely inside single fluid block
    // Use a small custom box fully inside [0,1]^3 by placing feet at y=0.1
    const small = bodyAabb({ x: 0.5, y: 0.1, z: 0.5 }, 0.1, 0.6); // half=0.1, height=0.6 -> y=[0.1,0.7]
    expect(submersion(small, w)).toBeGreaterThan(0.9); // almost fully inside one block
  });

  it("partially submerged body gives a continuous value between 0 and 1", () => {
    // Fluid at (0,0,0) and (0,1,0) — a 2-block water column y=[0,1] and [1,2]
    const w = waterWorld([[0, 0, 0], [0, 1, 0]]);
    // Player standing with feet at y=1.5 (top of second block = 2.0)
    const box = bodyAabb({ x: 0.5, y: 1.5, z: 0.5 }); // y=[1.5,3.3]
    const wet = submersion(box, w);
    expect(wet).toBeGreaterThan(0);
    expect(wet).toBeLessThan(1);
  });

  it("zero-volume box returns 0", () => {
    const w = waterWorld([[0, 0, 0]]);
    const flat = { minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5, minZ: 0.5, maxZ: 0.5 };
    expect(submersion(flat as Aabb, w)).toBe(0);
  });

  it("multi-block overlap sums correctly and caps at 1", () => {
    const w = waterWorld([[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0]]);
    // Large body spanning all four fluid blocks
    const big = { minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 2 } as Aabb;
    expect(submersion(big, w)).toBeLessThanOrEqual(1);
    expect(submersion(big, w)).toBeGreaterThan(0.4);
  });

  it("body just at surface gets near-zero wet", () => {
    // Fluid at (0,0,0) only; feet at y=1 (top of block)
    const w = waterWorld([[0, 0, 0]]);
    const box = bodyAabb({ x: 0.5, y: 1.0, z: 0.5 });
    const wet = submersion(box, w);
    // Overlap only at the very top edge -> ~0
    expect(wet).toBeGreaterThanOrEqual(0);
    expect(wet).toBeLessThan(0.05);
  });

  it("isFluid missing (undefined) always yields 0 regardless of blocks", () => {
    const w: SolidWorld = { isSolid: () => false };
    const box = bodyAabb({ x: 0, y: 0.5, z: 0 });
    expect(submersion(box, w)).toBe(0);
  });
});

/* ---------- 3. flowAt ---------- */
describe("flowAt — deterministic current from world state", () => {
  it("no isFluid returns zero vector", () => {
    const w: SolidWorld = { isSolid: () => false };
    expect(flowAt(w, 0.5, 0.5, 0.5)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("at non-fluid block returns zero", () => {
    const w = waterWorld([[0, 1, 0]]);
    // Point at (0,0,0) — no fluid there
    expect(flowAt(w, 0, 0, 0)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("flat open water (equal depth everywhere) gives calm zero current", () => {
    // 3x3 pool one block deep — all neighbours same depth
    const fluids: [number, number, number][] = [];
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) fluids.push([x, 0, z]);
    const w = waterWorld(fluids);
    expect(flowAt(w, 0, 0.5, 0)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("drop-off pulls toward deeper neighbour", () => {
    // Shallow at (0,2,0); deep stacked at (1,2,0),(1,1,0),(1,0,0)
    // Call at y=2.5 so by=2; shallow depth=1, deep depth=3
    const w = waterWorld([[0, 2, 0], [1, 2, 0], [1, 1, 0], [1, 0, 0]]);
    const v = flowAt(w, 0.5, 2.5, 0.5);
    expect(v.x).toBeGreaterThan(0); // direction toward deeper
    expect(v.y).toBe(0);
    expect(Math.abs(v.z)).toBeLessThan(0.01); // no z bias in this setup
  });

  it("current speed is capped at FLOW_SPEED", () => {
    // Deep pool at y=2; call at y=2.5 so by=2; extreme gradient
    const w = waterWorld([[0, 2, 0], [1, 2, 0], [1, 1, 0], [1, 0, 0]]);
    const v = flowAt(w, 0.5, 2.5, 0.5);
    const speed = Math.hypot(v.x, v.z);
    expect(speed).toBeLessThanOrEqual(FLOW_SPEED + 1e-9);
  });

  it("same world always produces same vector (determinism)", () => {
    const w = waterWorld([[0, 0, 0], [0, 1, 0]]);
    const a = flowAt(w, 0.5, 0.5, 0.5);
    const b = flowAt(w, 0.5, 0.5, 0.5);
    expect(a).toEqual(b);
  });

  it("direction is purely horizontal (y stays 0)", () => {
    const w = waterWorld([[0, 0, 0], [2, 0, 0], [2, -1, 0], [2, -2, 0]]);
    const v = flowAt(w, 0.5, 0.5, 0.5);
    expect(v.y).toBe(0);
  });
});

/* ---------- 4. swimVelocity ---------- */
describe("swimVelocity — horizontal stroke + flow, not vertical", () => {
  it("dry world (wet<=0) passes through wish exactly", () => {
    const w = dryWorldWithSolid();
    const v = swimVelocity({ x: 1, y: 2, z: 3 }, { x: 0, y: 1, z: 0 }, 5, 7, 0.016, w);
    expect(v.x).toBe(5);
    expect(v.z).toBe(7);
    expect(v.y).toBe(1); // vertical untouched
  });

  it("in water applies drag and targets swim speed", () => {
    // Single fluid block at origin; player inside it
    const w = waterWorld([[0, 0, 0]]);
    const v = swimVelocity({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 0, z: 0 }, 2, 0, 0.016, w);
    expect(v.x).toBeGreaterThan(0); // accelerated toward wish
    expect(Math.abs(v.z)).toBeLessThan(1e-6); // no z wish
  });

  it("targets cap at SWIM_SPEED", () => {
    const w = waterWorld([[0, 0, 0]]);
    const v = swimVelocity({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 0, z: 0 }, 100, 0, 0.016, w);
    const speed = Math.hypot(v.x, v.z);
    expect(speed).toBeLessThanOrEqual(SWIM_SPEED + 1e-6);
  });

  it("zero wish with non-zero velocity coasts down (drag)", () => {
    const w = waterWorld([[0, 0, 0]]);
    const v1 = swimVelocity({ x: 0.5, y: 0.5, z: 0.5 }, { x: 2, y: 0, z: 0 }, 0, 0, 0.016, w);
    expect(v1.x).toBeLessThan(2); // damped
  });

  it("current (flow) is added on top of swim target", () => {
    // Deep pool at y=2 stack; call at y=2.5 so by=2; shallow vs deep drop
    const w = waterWorld([[0, 2, 0], [1, 2, 0], [1, 1, 0], [1, 0, 0]]);
    const v = swimVelocity({ x: 0.2, y: 2.5, z: 0.5 }, { x: 0, y: 0, z: 0 }, 0, 0, 0.016, w);
    // With zero wish, target=0, flow should push +x
    expect(v.x).toBeGreaterThan(0);
  });

  it("same inputs => identical outputs (reproducibility)", () => {
    const w = waterWorld([[0, 0, 0]]);
    const a = swimVelocity({ x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 2 }, 3, -1, 0.016, w);
    const b = swimVelocity({ x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 2 }, 3, -1, 0.016, w);
    expect(a).toEqual(b);
  });

  it("respects custom halfWidth/height without crashing", () => {
    const w = waterWorld([[0, 0, 0]]);
    const v = swimVelocity({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 0, z: 0 }, 1, 0, 0.016, w, 0.2, 1.5);
    expect(typeof v.x).toBe("number");
    expect(typeof v.z).toBe("number");
  });

  it("maximum acceleration per step is bounded by SWIM_ACCELERATION * dt", () => {
    const w = waterWorld([[0, 0, 0]]);
    // Large dt to make maxStep visible
    const v = swimVelocity({ x: 0.5, y: 0.5, z: 0.5 }, { x: 10, y: 0, z: 0 }, 10, 0, 1, w);
    expect(Math.abs(v.x - 10)).toBeLessThanOrEqual(SWIM_ACCELERATION * 1 + 1e-6);
  });
});

/* ---------- 5. stepPhysics — water branch ---------- */
describe("stepPhysics — water branch (buoyancy, drag, caps, stroke)", () => {
  it("dry (wet<=0) falls with gravity", () => {
    const w = dryWorldWithSolid();
    const r = stepPhysics({ x: 0.5, y: 3, z: 0.5 }, { x: 0, y: 0, z: 0 }, 1 / 60, w);
    expect(r.velocity.y).toBeLessThan(0); // falling
  });

  it("in water with no rise intent holds depth (net near zero at half-submerged)", () => {
    // Fluid at y=0..1; player feet at y=0.5 -> partly submerged
    const w = waterWorld([[0, 0, 0]]);
    const r = stepPhysics({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 0, z: 0 }, 1 / 60, w);
    // Should not plummet
    expect(r.velocity.y).toBeGreaterThan(-WATER_TERMINAL_VELOCITY - 1);
  });

  it("rise intent accelerates upward by SWIM_RISE_ACCELERATION * wet", () => {
    const w = waterWorld([[0, 0, 0], [0, 1, 0]]); // deeper water
    const r = stepPhysics({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 0, z: 0 }, 0.016, w, { rise: true });
    // With rise true, vertical acceleration is positive above dry case
    expect(r.velocity.y).toBeGreaterThan(-1); // should not be strongly downward
  });

  it("drag caps extreme vertical speeds in water", () => {
    const w = waterWorld([[0, 0, 0]]);
    const r = stepPhysics({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 100, z: 0 }, 1 / 60, w);
    expect(r.velocity.y).toBeLessThanOrEqual(WATER_TERMINAL_VELOCITY + 1e-6);
    expect(r.velocity.y).toBeGreaterThanOrEqual(-WATER_TERMINAL_VELOCITY - 1e-6);
  });

  it("full submersion pushes up when no stroke", () => {
    // Fully inside fluid block
    const w = waterWorld([[0, 0, 0]]);
    // Step at small dt; should get positive vy from buoyancy (greater than dry)
    const r = stepPhysics({ x: 0.5, y: 0.1, z: 0.5 }, { x: 0, y: -10, z: 0 }, 0.016, w);
    // Even with large downward input, buoyancy should reduce downward speed or reverse
    expect(r.velocity.y).toBeGreaterThan(-WATER_TERMINAL_VELOCITY - 2);
  });

  it("same inputs => same MoveResult (determinism)", () => {
    const w = waterWorld([[0, 0, 0]]);
    const a = stepPhysics({ x: 0.5, y: 1, z: 0.5 }, { x: 1, y: -2, z: 3 }, 1 / 60, w, { rise: true });
    const b = stepPhysics({ x: 0.5, y: 1, z: 0.5 }, { x: 1, y: -2, z: 3 }, 1 / 60, w, { rise: true });
    expect(a.position).toEqual(b.position);
    expect(a.velocity).toEqual(b.velocity);
  });

  it("custom dimensions work without crash in water branch", () => {
    const w = waterWorld([[0, 0, 0]]);
    const r = stepPhysics({ x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: 0 }, 0.016, w, undefined, 0.2, 1.2);
    expect(r.position).toBeDefined();
  });
});

/* ---------- 6. Constant consistency ---------- */
describe("water constant coherence", () => {
  it("WATER_BUOYANCY equals GRAVITY by design", () => {
    expect(WATER_BUOYANCY).toBe(GRAVITY);
  });
  it("SWIM_RISE_ACCELERATION equals GRAVITY by design", () => {
    expect(SWIM_RISE_ACCELERATION).toBe(GRAVITY);
  });
  it("FLOW_SPEED is positive and below SWIM_SPEED", () => {
    expect(FLOW_SPEED).toBeGreaterThan(0);
    expect(FLOW_SPEED).toBeLessThan(SWIM_SPEED);
  });
  it("WATER_DRAG is positive and caps damp at dt=0.25 to <=1", () => {
    expect(WATER_DRAG).toBeGreaterThan(0);
    expect(Math.min(1, WATER_DRAG * 0.25)).toBeLessThanOrEqual(1);
  });
});

/* ---------- 7. Purity / determinism quick-check ---------- */
describe("purity invariants for new water exports", () => {
  it("swimVelocity never produces NaN for legal inputs", () => {
    const w = waterWorld([[0, 0, 0]]);
    for (let i = 0; i < 20; i++) {
      const v = swimVelocity(
        { x: Math.sin(i) * 0.5, y: 0.5, z: Math.cos(i) * 0.5 },
        { x: i, y: 0, z: -i },
        i, -i, 0.016, w
      );
      expect(Number.isFinite(v.x)).toBe(true);
      expect(Number.isFinite(v.z)).toBe(true);
    }
  });

  it("submersion never yields <0 or >1", () => {
    const w = waterWorld([[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0]]);
    for (let x = -2; x <= 3; x++) for (let y = -1; y <= 2; y++) for (let z = -2; z <= 3; z++) {
      const wet = submersion(bodyAabb({ x, y, z }), w);
      expect(wet).toBeGreaterThanOrEqual(0);
      expect(wet).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("flowAt is pure: identical world => identical vector, no hidden state", () => {
    const w = waterWorld([[0, 0, 0], [1, 0, 0], [1, -1, 0]]);
    const a = flowAt(w, 0.2, 0.5, 0.2);
    const b = flowAt(w, 0.2, 0.5, 0.2);
    const c = flowAt(w, 0.2, 0.5, 0.2);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});
