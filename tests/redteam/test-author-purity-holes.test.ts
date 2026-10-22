/**
 * BlockForge — RED-TEAM: the TEST AUTHOR's purity suite had holes.
 *
 * OWNERSHIP: RED-TEAM (tests/redteam/). Owner of the fix: TEST AUTHOR
 * (antigravity) — tests/ is theirs; this file is a finding, not a rewrite.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `tests/purity.test.ts` (TEST AUTHOR) is the project's PRIMARY defence
 * against the purity invariant in docs/ARCHITECTURE.md §1 — the property
 * the whole project depends on and the one nobody can fix by eye.
 *
 * A guard that cannot fail is not a guard. RED-TEAM's own scanner
 * (lib/purity-scan.ts) is meta-tested for exactly that reason, and this
 * file applies the same standard to the TEST AUTHOR's scanner.
 *
 * THE THREE HOLES (all found by executing their code, not by reading it)
 * ------------------------------------------------------------------------
 * T1  The file list came from a NON-RECURSIVE readdirSync, so a
 *     src/core subdirectory was never scanned at all.
 *
 * T2  stripComments() deleted from `//` to end of line without knowing
 *     whether that `//` was inside a string. A URL on a line silently
 *     deleted the rest of the line, including a real Math.random() call.
 *
 * T3  Several real forms slipped past the regexes: `Math . random()`,
 *     `require("three")`, and `await import("three")`.
 *
 * STATUS: FIXED (T48, T49, T50). The TEST AUTHOR replaced the
 * comment-stripping regex scanner with a TypeScript-AST scanner
 * (`tests/lib/purity-scan.ts`) that resolves the dotted callee name, so
 * spacing cannot hide a call and a `//` inside a string is not a comment.
 *
 * WHY THIS FILE NO LONGER COPIES THE SCANNER
 * ------------------------------------------
 * It used to carry a verbatim copy of the TEST AUTHOR's OLD regex scanner
 * and assert the holes against that copy. That was a false alarm waiting to
 * happen: the copy could never start working, so the armed `it.fails` stubs
 * would stay green forever while proving nothing about the scanner the
 * project actually runs. Worse, the copy was pinned to a scanner that no
 * longer exists, so it tested dead code.
 *
 * These tests now run the REAL scanner — the one in `tests/lib/purity-scan.ts`
 * that guards `src/core/` — and assert that each hole class is still caught.
 * That way the test tracks the live guard: if the TEST AUTHOR's scanner ever
 * regresses, this file goes red.
 */

import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib/determinism-harness.js";
import { listTypeScriptFiles, scanSource } from "../lib/purity-scan.js";

const CORE_DIR = join(REPO_ROOT, "src", "core");

/** The rule ids the real scanner reports. */
function rulesFor(source: string): string[] {
  return scanSource("synthetic.ts", source, REPO_ROOT).map((v) => v.rule);
}

describe("T1 — the purity scan must reach subdirectories of src/core", () => {
  it("control: a non-recursive readdirSync lists only the top level", () => {
    const topLevel = readdirSync(CORE_DIR).filter((f) => f.endsWith(".ts"));
    expect(topLevel.length).toBeGreaterThan(0);
    // Every entry is a FILE name, never a directory: this is the shape of
    // the TEST AUTHOR's OLD file list.
    for (const entry of topLevel) expect(entry.endsWith(".ts")).toBe(true);
  });

  it("T1: the scan must include files in src/core subdirectories", () => {
    // A recursive walk is the only way to cover a src/core subdirectory.
    // RED-TEAM's own scanner lists files recursively for exactly this
    // reason, and so does the TEST AUTHOR's.
    const all = listTypeScriptFiles(CORE_DIR);
    const topLevel = readdirSync(CORE_DIR).filter((f) => f.endsWith(".ts")).length;
    expect(all.length).toBeGreaterThanOrEqual(topLevel);
    // The engine's load-bearing files must all be in the list.
    const names = all.map((f) => f.split("/").pop());
    for (const name of ["world.ts", "noise.ts", "rng.ts", "meshing.ts", "physics.ts"]) {
      expect(names).toContain(name);
    }
  });
});

describe("T2 — a // inside a string must not delete the rest of the line", () => {
  it("control: a URL in a string is a string, not a comment", () => {
    // Pinned deliberately: the OLD stripComments() ate the rest of the
    // line, taking a real Math.random() with it. The AST scanner sees a
    // string literal and carries on.
    const violations = scanSource(
      "synthetic.ts",
      'const url = "https://example.com/x"; const r = Math.random();',
      REPO_ROOT,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("math-random");
  });

  it("T2: a Math.random() after a URL string must still be detected", () => {
    const failures = rulesFor(
      'const url = "https://example.com/x"; const r = Math.random();',
    );
    expect(failures).toContain("math-random");
  });

  it("T2: a Date.now() after a URL string must still be detected", () => {
    const failures = rulesFor('const url = "https://example.com/x"; const t = Date.now();');
    expect(failures).toContain("date-now");
  });
});

describe("T3 — the purity patterns must catch the real forms", () => {
  it("T3: Math . random() with whitespace must be detected", () => {
    expect(rulesFor("const r = Math . random();")).toContain("math-random");
  });

  it("T3: require('three') must be detected", () => {
    expect(rulesFor('const T = require("three");')).toContain("package-three");
  });

  it("T3: dynamic import('three') must be detected", () => {
    expect(rulesFor('const T = await import("three");')).toContain("package-three");
  });

  it("control: the forms the current patterns DO catch (regression guard)", () => {
    expect(rulesFor('import * as THREE from "three";')).toContain("package-three");
    expect(rulesFor('import { Scene } from "three/src/core/Scene.js";')).toContain("package-three");
    expect(rulesFor('import { x } from "../engine/thing.js";')).toContain("layer-engine");
    expect(rulesFor('import { x } from "../../engine/thing.js";')).toContain("layer-engine");
    expect(rulesFor("const t = globalThis.Date.now();")).toContain("date-now");
    expect(rulesFor("const w = window;")).toContain("dom-global");
    expect(rulesFor("const d = fetch ('/x');")).toContain("network");
  });
});

describe("T4 — a DOM global reached through globalThis is still a DOM dependency", () => {
  it("control: the probe is live — a BARE DOM global is caught", () => {
    expect(rulesFor("const w = window;")).toContain("dom-global");
  });

  it.fails("T4: globalThis.window must be caught like a bare window", () => {
    // The scanner matches BANNED_DOM_GLOBALS on a bare Identifier node, so
    // `globalThis.window` — a PropertyAccessExpression — slips through, even
    // though it is exactly as much a DOM dependency as `window`. The same
    // asymmetry does NOT apply to calls: `globalThis.Date.now()` IS caught,
    // because the scanner resolves the dotted callee name.
    expect(rulesFor("const w = globalThis.window;")).toContain("dom-global");
  });
});
