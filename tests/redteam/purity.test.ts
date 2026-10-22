/**
 * BlockForge — RED-TEAM: the purity scanner, and the guarantee it gives.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/).
 *
 * docs/ARCHITECTURE.md §1:
 *
 *     src/core/ is additionally constrained to be pure: no Math.random, no
 *     Date.now, no performance.now, no DOM access, no localStorage/
 *     IndexedDB, no network calls, no Three.js. It must import and run in
 *     Node under Vitest with no GPU, no browser and no canvas. The RED-TEAM
 *     agent owns the static checks that enforce this.
 *
 * This file does two things:
 *
 *   1. META-TESTS the scanner against deliberately impure sources. A purity
 *      check that cannot FAIL is worse than no purity check, because it
 *      looks like a guarantee. Every banned construct gets a positive
 *      control proving the scanner catches it, and the real src/core gets a
 *      negative control proving the scanner does not cry wolf.
 *
 *   2. SCANS THE REAL src/core/ and asserts it is pure. This is the test
 *      that fails the moment ENGINE lands a file that breaks the contract.
 */

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { formatViolations, scanDirectory, scanSource } from "./lib/purity-scan.js";
import { REPO_ROOT } from "./lib/determinism-harness.js";

const CORE_DIR = join(REPO_ROOT, "src", "core");

/** Scan a synthetic source file that lives (on paper) inside src/core. */
function scanCoreSource(source: string): ReturnType<typeof scanSource> {
  return scanSource(join(CORE_DIR, "probe.ts"), source, REPO_ROOT);
}

describe("purity scanner — positive controls: it must CATCH every banned construct", () => {
  const cases: ReadonlyArray<{ name: string; source: string; rule: string }> = [
    { name: "Math.random", source: "export const r = Math.random();", rule: "math-random" },
    { name: "Date.now", source: "export const t = Date.now();", rule: "date-now" },
    { name: "new Date", source: "export const d = new Date();", rule: "new-date" },
    { name: "performance.now", source: "export const p = performance.now();", rule: "performance-now" },
    {
      name: "crypto.getRandomValues",
      source: "export const c = crypto.getRandomValues(new Uint8Array(4));",
      rule: "crypto-random",
    },
    { name: "document", source: "export const e = document.getElementById('x');", rule: "dom-global" },
    { name: "window", source: "export const w = window.innerWidth;", rule: "dom-global" },
    {
      name: "localStorage",
      source: "export const s = localStorage.getItem('k');",
      rule: "dom-global",
    },
    {
      name: "indexedDB",
      source: "export const i = indexedDB.open('db');",
      rule: "dom-global",
    },
    { name: "fetch", source: "export const f = fetch('https://example.com');", rule: "network" },
    { name: "WebSocket", source: "export const ws = new WebSocket('wss://x');", rule: "network" },
    { name: "node:fs", source: "import { readFileSync } from 'node:fs';", rule: "node-io" },
    { name: "node:http", source: "import { get } from 'node:http';", rule: "node-network" },
    { name: "three", source: "import * as THREE from 'three';", rule: "package-three" },
    { name: "react", source: "import React from 'react';", rule: "package-react" },
  ];

  for (const testCase of cases) {
    it(`catches ${testCase.name}`, () => {
      const violations = scanCoreSource(testCase.source);
      expect(violations.map((v) => v.rule)).toContain(testCase.rule);
    });
  }

  it("catches an import from src/engine (layering)", () => {
    const violations = scanCoreSource("import { thing } from '../engine/thing.js';");
    expect(violations.map((v) => v.rule)).toContain("layer-engine");
  });

  it("catches an import from src/render (layering)", () => {
    const violations = scanCoreSource("import { thing } from '../render/thing.js';");
    expect(violations.map((v) => v.rule)).toContain("layer-render");
  });

  it("catches an import from src/net (layering)", () => {
    const violations = scanCoreSource("import { thing } from '../net/thing.js';");
    expect(violations.map((v) => v.rule)).toContain("layer-net");
  });

  it("catches an import from src/gameplay (layering)", () => {
    const violations = scanCoreSource("import { thing } from '../gameplay/thing.js';");
    expect(violations.map((v) => v.rule)).toContain("layer-gameplay");
  });

  it("catches an import from server/ (layering)", () => {
    const violations = scanCoreSource("import { thing } from '../../server/thing.js';");
    expect(violations.map((v) => v.rule)).toContain("layer-server");
  });

  it("catches a banned call hidden inside a template expression", () => {
    const violations = scanCoreSource("export const s = `${Math.random()}`;");
    expect(violations.map((v) => v.rule)).toContain("math-random");
  });
});

describe("purity scanner — negative controls: it must NOT cry wolf", () => {
  it("does not flag the word Math.random inside a comment", () => {
    // The frozen contract itself says this, in a doc comment.
    const violations = scanCoreSource(
      "/** no Math.random, Date.now, performance.now in here */\nexport const x = 1;\n",
    );
    expect(violations).toEqual([]);
  });

  it("does not flag the word Math.random inside a string literal", () => {
    const violations = scanCoreSource("export const msg = 'never call Math.random here';");
    expect(violations).toEqual([]);
  });

  it("does not flag a property named document on a local object", () => {
    // A field called `document` is a false positive for a naive scanner.
    const violations = scanCoreSource("export const r = { document: 1 };");
    expect(violations.map((v) => v.rule)).not.toContain("dom-global");
  });

  it("does not flag a path-like string that is not an import", () => {
    const violations = scanCoreSource("export const p = '../engine/thing.js';");
    expect(violations).toEqual([]);
  });

  it("does not flag a core-internal relative import", () => {
    const violations = scanCoreSource("import { blockIndex } from './constants.js';");
    expect(violations).toEqual([]);
  });
});

describe("src/core/ is pure", () => {
  it("contains no banned construct and no forbidden dependency", () => {
    const violations = scanDirectory(CORE_DIR, REPO_ROOT);
    expect(
      violations,
      `src/core/ is not pure:\n${formatViolations(violations)}`,
    ).toEqual([]);
  });
});
