/**
 * BlockForge — PRIORITY 1: Core Purity.
 *
 * OWNERSHIP: TEST AUTHOR (tests/).
 *
 * The invariant under test (docs/ARCHITECTURE.md §1):
 *
 *   `src/core/` is pure — no `Math.random`, no `Date.now`, no
 *   `performance.now`, no DOM access, no `localStorage`/`IndexedDB`, no
 *   network calls, no Three.js, and no import from `src/engine`,
 *   `src/render`, `src/net`, `src/gameplay` or `server/`.
 *
 * WHY THERE IS A SCANNER AND META-TESTS
 * ------------------------------------
 * RED-TEAM (T48, T49, T50) found three holes in the first version of this
 * guard. A guard that cannot fail is not a guard, so the scanner lives in
 * `tests/lib/purity-scan.ts` and is built on the TypeScript AST rather than
 * on regexes over comment-stripped text.
 *
 * The "PROVES IT CAN FAIL" block below is the part that matters: every hole
 * RED-TEAM found is replayed against the scanner as a known-bad source, and
 * the scanner must report it. If someone weakens the scanner again, that
 * block goes red before the real files do.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  formatViolations,
  listTypeScriptFiles,
  scanDirectory,
  scanSource,
  type PurityViolation,
} from "./lib/purity-scan.js";

const REPO_ROOT = path.resolve(__dirname, "..");
const CORE_DIR = path.join(REPO_ROOT, "src", "core");

/** Scan a snippet and return the rule ids that fired. */
function rulesFor(source: string): string[] {
  return scanSource("synthetic.ts", source, REPO_ROOT).map((v) => v.rule);
}

describe("PRIORITY 1: Core Purity (Static Analysis)", () => {
  it("found TypeScript source files in src/core", () => {
    const files = listTypeScriptFiles(CORE_DIR);
    expect(files.length).toBeGreaterThan(0);
  });

  it("scans src/core RECURSIVELY, so files in subdirectories are covered", () => {
    // T48. The old guard used a non-recursive readdirSync, so anything under
    // a src/core subdirectory was invisible to it. The engine puts most of
    // its real code in exactly those files, so the guard was watching
    // mostly empty space.
    const files = listTypeScriptFiles(CORE_DIR);
    const topLevel = fs
      .readdirSync(CORE_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".ts"))
      .map((e) => e.name);

    // Every top-level file must be in the recursive list.
    for (const name of topLevel) {
      expect(path.basename(files.find((f) => path.basename(f) === name) ?? "")).toBe(name);
    }

    // The recursive walk must also descend into subdirectories. Proven
    // against a real nested tree rather than asserted on the current
    // layout, which happens to be flat.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-purity-"));
    try {
      fs.mkdirSync(path.join(tmp, "nested", "deeper"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "top.ts"), "export const a = 1;\n");
      fs.writeFileSync(path.join(tmp, "nested", "mid.ts"), "export const b = 2;\n");
      fs.writeFileSync(
        path.join(tmp, "nested", "deeper", "deep.ts"),
        "export const c = 3;\n",
      );
      const nested = listTypeScriptFiles(tmp).map((f) => path.relative(tmp, f));
      expect(nested).toContain("top.ts");
      expect(nested).toContain(path.join("nested", "mid.ts"));
      expect(nested).toContain(path.join("nested", "deeper", "deep.ts"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reports no purity violations in src/core", () => {
    const violations = scanDirectory(CORE_DIR, REPO_ROOT);
    expect(
      violations,
      `purity violations in src/core:\n${formatViolations(violations)}`,
    ).toEqual([]);
  });

  it("scans the engine files the old guard never reached", () => {
    // The specific files RED-TEAM named as unscanned under the old
    // non-recursive guard. If the engine ever renames them this test
    // should be updated with the new names — but right now, this is the
    // list of files carrying the load-bearing logic.
    const scanned = listTypeScriptFiles(CORE_DIR).map((f) => path.basename(f));
    for (const name of [
      "world.ts",
      "meshing.ts",
      "physics.ts",
      "raycast.ts",
      "noise.ts",
      "rng.ts",
    ]) {
      expect(scanned).toContain(name);
    }
  });
});

describe("PRIORITY 1: the purity scanner PROVES IT CAN FAIL", () => {
  // Every case here is a form that a real violation can take. If the
  // scanner stops reporting one of them, the scanner is blind again and
  // the whole guard is worthless — these tests go red before the real
  // files do.

  it("catches Math.random() in a plain top-level file (the control)", () => {
    expect(rulesFor("const r = Math.random();\n")).toContain("math-random");
  });

  it("T2: catches a Math.random() that follows a URL string on the same line", () => {
    // The old stripComments() deleted from the "//" to end of line without
    // knowing the "//" was inside a string, so the real Math.random() call
    // was deleted with the rest of the line and the guard reported clean.
    const source = 'const url = "https://example.com/x"; const r = Math.random();';
    expect(rulesFor(source)).toContain("math-random");
  });

  it("T2: catches a Date.now() that follows a URL string on the same line", () => {
    const source = 'const url = "https://example.com/x"; const t = Date.now();';
    expect(rulesFor(source)).toContain("date-now");
  });

  it("T2: does not mistake a // inside a string for a comment", () => {
    // The negative direction: a URL in a string is not a comment, and the
    // code after it on the same line must still be scanned.
    const source = 'const url = "https://example.com/x"; const r = Math.random();';
    const violations = scanSource("synthetic.ts", source, REPO_ROOT);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("math-random");
  });

  it("T3: catches Math . random() with whitespace around the dot", () => {
    expect(rulesFor("const r = Math . random();\n")).toContain("math-random");
  });

  it("T3: catches require('three')", () => {
    expect(rulesFor('const T = require("three");\n')).toContain("package-three");
  });

  it("T3: catches await import('three')", () => {
    expect(rulesFor('const T = await import("three");\n')).toContain("package-three");
  });

  it("catches a static import of three", () => {
    expect(rulesFor('import * as THREE from "three";\n')).toContain("package-three");
  });

  it("catches a deep import into three", () => {
    expect(rulesFor('import { Scene } from "three/src/core/Scene.js";\n')).toContain(
      "package-three",
    );
  });

  it("catches a new Date()", () => {
    expect(rulesFor("const d = new Date();\n")).toContain("new-date");
  });

  it("catches globalThis.Date.now()", () => {
    expect(rulesFor("const t = globalThis.Date.now();\n")).toContain("date-now");
  });

  it("catches performance.now()", () => {
    expect(rulesFor("const t = performance.now();\n")).toContain("performance-now");
  });

  it("catches a DOM global used as a value", () => {
    expect(rulesFor("const w = window;\n")).toContain("dom-global");
    expect(rulesFor("const d = document;\n")).toContain("dom-global");
    expect(rulesFor("const n = navigator;\n")).toContain("dom-global");
  });

  it("catches a DOM global used as a type", () => {
    expect(rulesFor("let e: HTMLElement;\n")).toContain("dom-global");
  });

  it("T4: catches a DOM global reached through globalThis", () => {
    // The DOM-global rule matched a bare Identifier, so `globalThis.window` -
    // a PropertyAccessExpression whose `window` is a property NAME and not an
    // identifier reference - slipped through the guard entirely. RED-TEAM
    // found it by execution (T99).
    expect(rulesFor("const w = globalThis.window;\n")).toContain("dom-global");
    expect(rulesFor("const d = globalThis.document;\n")).toContain("dom-global");
    expect(rulesFor("const s = globalThis.localStorage;\n")).toContain("dom-global");
    expect(rulesFor("const w = globalThis['window'];\n")).toContain("dom-global");
  });

  it("T4: catches a DOM global destructured off globalThis", () => {
    // Same dependency, a different spelling: the bound identifier is a
    // local declaration, so the identifier rule skips it.
    expect(rulesFor("const { window } = globalThis;\n")).toContain("dom-global");
    expect(rulesFor("const { localStorage } = globalThis;\n")).toContain("dom-global");
    expect(rulesFor("const { window: w } = globalThis;\n")).toContain("dom-global");
  });

  it("T4: does NOT flag a DOM global reached through some other object", () => {
    // The negative direction: only the REAL global object is a DOM
    // dependency. `foo.window` is somebody else's property, and a locally
    // declared `globalThis` shadows the real one.
    expect(rulesFor("const x = foo.window;\n")).toEqual([]);
    expect(rulesFor("const x = obj.globalThis.window;\n")).toEqual([]);
    expect(rulesFor("const x = globalThis.foo;\n")).toEqual([]);
    expect(
      rulesFor("const globalThis = { window: 1 };\nconst x = globalThis.window;\n"),
    ).toEqual([]);
    expect(rulesFor("const { window } = someOtherObject;\n")).toEqual([]);
    // A RENAMED binding reads the property `window` off whatever it
    // destructures, so the name is a property and not the global.
    expect(rulesFor("const { window: w } = someOtherObject;\n")).toEqual([]);
  });

  it("catches a network call", () => {
    expect(rulesFor('fetch("/x");\n')).toContain("network");
    expect(rulesFor('const w = new WebSocket("ws://x");\n')).toContain("network");
  });

  it("catches an import from a forbidden layer", () => {
    expect(rulesFor('import { x } from "../engine/thing.js";\n')).toContain("layer-engine");
    expect(rulesFor('import { x } from "../../engine/thing.js";\n')).toContain("layer-engine");
    expect(rulesFor('import { x } from "../render/thing.js";\n')).toContain("layer-render");
    expect(rulesFor('import { x } from "../net/thing.js";\n')).toContain("layer-net");
    expect(rulesFor('import { x } from "../gameplay/thing.js";\n')).toContain("layer-gameplay");
    expect(rulesFor('import { x } from "../../server/thing.js";\n')).toContain("layer-server");
  });

  it("does NOT flag a sibling file whose name merely contains a layer word", () => {
    // The layer rule matches whole path segments, so a file called
    // "./engine-utils.js" is not an import from src/engine.
    expect(rulesFor('import { x } from "./engine-utils.js";\n')).not.toContain("layer-engine");
  });

  it("does NOT flag a doc comment that merely names a banned construct", () => {
    // The frozen contract itself writes "no Math.random, Date.now,
    // performance.now" in a doc comment. Flagging that would make the
    // guard fail on the contract that defines it.
    const source = `
      /**
       * - no Math.random, Date.now, performance.now
       * - no DOM access, no localStorage/IndexedDB
       */
      export const ok = 1;
    `;
    expect(rulesFor(source)).toEqual([]);
  });

  it("does NOT flag a string literal that merely contains a banned text", () => {
    // A URL, a regex or a path may legitimately contain "//" or the text
    // "Date.now()". That is DATA, not code.
    expect(rulesFor('const s = "Date.now() is banned";\n')).toEqual([]);
    expect(rulesFor('const s = "https://example.com/Math.random";\n')).toEqual([]);
  });

  it("does NOT flag an object key that happens to be a DOM global name", () => {
    expect(rulesFor("const o = { document: 1, window: 2 };\n")).toEqual([]);
  });

  it("does NOT flag a property access on some other object", () => {
    expect(rulesFor("const d = foo.document;\n")).toEqual([]);
  });

  it("does NOT flag a local variable that shadows a DOM global name", () => {
    expect(rulesFor("const document = { a: 1 };\nexport const b = document.a;\n")).toEqual([]);
  });

  it("reports the line and column of the violation", () => {
    const source = "const a = 1;\nconst r = Math.random();\n";
    const violations: PurityViolation[] = scanSource("synthetic.ts", source, REPO_ROOT);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(2);
    expect(violations[0]?.column).toBe(11);
  });
});
