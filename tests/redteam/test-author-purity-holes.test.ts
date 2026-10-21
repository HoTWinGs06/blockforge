/**
 * BlockForge — RED-TEAM: the TEST AUTHOR's purity suite has holes.
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
 * file applies the same standard to the TEST AUTHOR's scanner: it runs
 * THEIR EXACT logic against sources that MUST be caught.
 *
 * THE THREE HOLES (all verified by executing their code, not by reading it)
 * ------------------------------------------------------------------------
 * T1  The file list comes from a NON-RECURSIVE readdirSync, so
 *     src/core/world/ — the directory the ENGINE is actively filling with
 *     rng, terrain, meshing and physics — is never scanned at all.
 *
 * T2  stripComments() deletes from `//` to end of line without knowing
 *     whether that `//` is inside a string. A URL on a line silently
 *     deletes the rest of the line, including a real Math.random() call.
 *
 * T3  Several real forms slip past the regexes: `Math . random()`,
 *     `require("three")`, and `await import("three")`.
 *
 * These are encoded as `it.fails` so the shared suite stays green while
 * the holes are open, and flips RED the moment the TEST AUTHOR fixes them.
 */

import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib/determinism-harness.js";
import { listTypeScriptFiles } from "./lib/purity-scan.js";

const CORE_DIR = join(REPO_ROOT, "src", "core");

/**
 * The TEST AUTHOR's stripComments(), copied verbatim from
 * feature/test-author/m1:tests/purity.test.ts.
 */
function theirStripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * The TEST AUTHOR's purity assertions, applied to one source file.
 * Returns the names of the rules that fired.
 */
function theirChecks(rawContent: string): string[] {
  const content = theirStripComments(rawContent);
  const failures: string[] = [];
  if (/\bMath\.random\s*\(/.test(content)) failures.push("Math.random");
  if (/\bDate\.now\s*\(/.test(content) || /\bnew\s+Date\s*\(/.test(content)) failures.push("Date");
  if (/\bperformance\.now\s*\(/.test(content)) failures.push("performance.now");
  if (
    /\bwindow\b|\bdocument\b|\bnavigator\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bHTMLElement\b|\bEventTarget\b/.test(
      content,
    )
  ) {
    failures.push("DOM");
  }
  if (/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/.test(content)) failures.push("network");
  if (/from\s+['"]three(?:\/.*)?['"]/.test(content) || /import\s+['"]three(?:\/.*)?['"]/.test(content)) {
    failures.push("three");
  }
  if (/from\s+['"].*\/engine(?:\/.*)?['"]/.test(content)) failures.push("engine");
  return failures;
}

describe("T1 — the purity scan must reach subdirectories of src/core", () => {
  it("control: a non-recursive readdirSync lists only the top level", () => {
    const topLevel = readdirSync(CORE_DIR).filter((f) => f.endsWith(".ts"));
    expect(topLevel.length).toBeGreaterThan(0);
    // Every entry is a FILE name, never a directory: this is the shape of
    // the TEST AUTHOR's file list.
    for (const entry of topLevel) expect(entry.endsWith(".ts")).toBe(true);
  });

  it.fails("T1: the scan must include files in src/core subdirectories", () => {
    // A recursive walk is the only way to cover src/core/world/, which is
    // where the engine puts its code. RED-TEAM's own scanner lists files
    // recursively for exactly this reason.
    const all = listTypeScriptFiles(CORE_DIR);
    const topLevel = readdirSync(CORE_DIR).filter((f) => f.endsWith(".ts")).length;
    expect(all.length).toBeGreaterThan(topLevel);
  });
});

describe("T2 — a // inside a string must not delete the rest of the line", () => {
  it("control: their stripComments does eat the rest of the line", () => {
    // Pinned deliberately: this is the CURRENT behaviour being reported.
    const stripped = theirStripComments('const url = "https://example.com/x"; const r = Math.random();');
    expect(stripped).not.toContain("Math.random");
  });

  it.fails("T2: a Math.random() after a URL string must still be detected", () => {
    const failures = theirChecks(
      'const url = "https://example.com/x"; const r = Math.random();',
    );
    expect(failures).toContain("Math.random");
  });

  it.fails("T2: a Date.now() after a URL string must still be detected", () => {
    const failures = theirChecks('const url = "https://example.com/x"; const t = Date.now();');
    expect(failures).toContain("Date");
  });
});

describe("T3 — the purity patterns must catch the real forms", () => {
  it.fails("T3: Math . random() with whitespace must be detected", () => {
    expect(theirChecks("const r = Math . random();")).toContain("Math.random");
  });

  it.fails("T3: require('three') must be detected", () => {
    expect(theirChecks('const T = require("three");')).toContain("three");
  });

  it.fails("T3: dynamic import('three') must be detected", () => {
    expect(theirChecks('const T = await import("three");')).toContain("three");
  });

  it("control: the forms the current patterns DO catch (regression guard)", () => {
    expect(theirChecks('import * as THREE from "three";')).toContain("three");
    expect(theirChecks('import { Scene } from "three/src/core/Scene.js";')).toContain("three");
    expect(theirChecks('import { x } from "../engine/thing.js";')).toContain("engine");
    expect(theirChecks('import { x } from "../../engine/thing.js";')).toContain("engine");
    expect(theirChecks("const t = globalThis.Date.now();")).toContain("Date");
    expect(theirChecks("const w = globalThis.window;")).toContain("DOM");
    expect(theirChecks("const d = fetch ('/x');")).toContain("network");
  });
});
