/**
 * BlockForge — RED-TEAM: the cross-process determinism harness, proven.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Gate G6 ("two fresh processes with the same seed produce identical world
 * hashes") is the project's most important guarantee, and it is checked by
 * the harness in ./lib/determinism-harness.ts.
 *
 * A harness that cannot FAIL is not a guarantee, it is decoration. So this
 * file does the only thing that matters: it proves the harness works, in
 * both directions.
 *
 *   - a DETERMINISTIC generator must produce identical hashes across
 *     independent processes;
 *   - a NON-DETERMINISTIC generator (one that leaks Date.now or Math.random)
 *     must produce DIFFERENT hashes, and the harness must notice.
 *
 * The second half is the important half. If the harness could not tell the
 * two apart, it would be reporting "deterministic" for everything.
 *
 * WHEN THE ENGINE LANDS
 * ---------------------
 * The generator used here is a reference implementation, deliberately kept
 * in this file. Once src/core/world exists, the same harness is pointed at
 * the real generator by changing one import — the harness itself does not
 * change, and these tests keep proving it works.
 */

import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  WORK_DIR,
  allEqual,
  cleanupTempDir,
  emittedPathFor,
  hashAcrossFreshProcesses,
  runInFreshProcesses,
  transpileToTempDir,
} from "./lib/determinism-harness.js";

/**
 * Two reference generators, written as standalone ESM scripts.
 *
 * `deterministic` derives everything from the seed argument.
 * `nonDeterministic` leaks the wall clock, which is exactly the class of
 * bug the project forbids.
 */
const DETERMINISTIC_GENERATOR = `
const seed = Number(process.argv[2] ?? 1);
// A tiny LCG: deterministic, and obviously so.
let state = seed >>> 0;
const next = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state;
};
const words = [];
for (let i = 0; i < 64; i++) words.push(next());
process.stdout.write(words.join(","));
`;

const NON_DETERMINISTIC_GENERATOR = `
const seed = Number(process.argv[2] ?? 1);
let state = seed >>> 0;
const next = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state;
};
const words = [];
for (let i = 0; i < 64; i++) words.push(next());
// The forbidden leak: the result now depends on WHEN it ran.
words.push(Date.now());
process.stdout.write(words.join(","));
`;

/** Write a generator script to the work dir and return its path. */
function writeGenerator(name: string, source: string): string {
  mkdirSync(WORK_DIR, { recursive: true });
  const path = join(WORK_DIR, `${name}.mjs`);
  writeFileSync(path, source, "utf8");
  return path;
}

describe("cross-process determinism harness — it works", () => {
  it("produces identical output from independent processes for a deterministic generator", () => {
    const script = writeGenerator("det-generator", DETERMINISTIC_GENERATOR);
    const outputs = runInFreshProcesses(script, ["12345"], 2);
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toBe(outputs[1]);
  });

  it("produces identical hashes across processes for a deterministic generator", () => {
    const script = writeGenerator("det-generator-hash", DETERMINISTIC_GENERATOR);
    const hashes = hashAcrossFreshProcesses(script, ["12345"], 2);
    expect(allEqual(hashes)).toBe(true);
  });

  it("DETECTS a non-deterministic generator — the harness is not a rubber stamp", () => {
    const script = writeGenerator("nondet-generator", NON_DETERMINISTIC_GENERATOR);
    const outputs = runInFreshProcesses(script, ["12345"], 2);
    expect(outputs[0]).not.toBe(outputs[1]);
    expect(allEqual(hashAcrossFreshProcesses(script, ["12345"], 2))).toBe(false);
  });

  it("DETECTS a different seed producing a different world", () => {
    const script = writeGenerator("det-generator-seed", DETERMINISTIC_GENERATOR);
    const a = runInFreshProcesses(script, ["1"], 1)[0];
    const b = runInFreshProcesses(script, ["2"], 1)[0];
    expect(a).not.toBe(b);
  });

  it("runs a TypeScript entry point in a fresh process", () => {
    // The harness must be able to run the project's real TypeScript, not
    // only toy scripts, or it cannot check G6 against the real engine.
    mkdirSync(WORK_DIR, { recursive: true });
    const source = join(WORK_DIR, "ts-entry.ts");
    writeFileSync(
      source,
      ["export const greet = (): string => 'hello-from-typescript';", "process.stdout.write(greet());", ""].join(
        "\n",
      ),
      "utf8",
    );
    const outDir = transpileToTempDir(source, WORK_DIR);
    try {
      const entry = emittedPathFor(outDir, source);
      const out = runInFreshProcesses(entry, [], 1)[0] as string;
      expect(out).toBe("hello-from-typescript");
    } finally {
      cleanupTempDir(outDir);
    }
  });
});
