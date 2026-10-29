/**
 * RED-TEAM M1 — PURITY INJECTION / SCANNING
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("M1 PURITY — src/core executable scan", () => {
  function tsFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry === "node_modules" || entry.startsWith("bf-det-")) continue;
        tsFiles(p, acc);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) acc.push(p);
    }
    return acc;
  }
  const CORE_DIR = join(__dirname, "../../src/core");
  const files = tsFiles(CORE_DIR);
  it("control: files exist", () => expect(files.length).toBeGreaterThan(0));
  function executableLines(text: string): string[] {
    const s = text.replace(/\/\*[\s\S]*?\*\//g, " ");
    return s.split("\n").map((l) => (l.split("//")[0] ?? ""));
  }
  const forbidden = [
    { name: "Math.random", regex: /Math\.random/ },
    { name: "Date.now", regex: /Date\.now/ },
    { name: "performance.now", regex: /performance\.now/ },
    { name: "window", regex: /\bwindow\b/ },
    { name: "document", regex: /\bdocument\b/ },
    { name: "localStorage", regex: /\blocalStorage\b/ },
    { name: "IndexedDB", regex: /\bIndexedDB\b/ },
    { name: "fetch", regex: /\bfetch\s*\(/ },
    { name: "three", regex: /require\(["']three["']\)|import\(["']three["']\)/ },
  ];
  for (const file of files) {
    it(`purity: ${file.replace(CORE_DIR, "src/core")}`, () => {
      const raw = readFileSync(file, "utf-8");
      const lines = executableLines(raw);
      for (const f of forbidden) {
        const hits = lines.filter((l) => f.regex.test(l));
        const safe = hits.filter((l) => /^\s*import\b.*from\s+["']\.\/.*["']/i.test(l) || /^\s*export\b/i.test(l));
        const bad = hits.filter((l) => !safe.includes(l));
        expect(bad.length, `forbidden "${f.name}": ${bad.slice(0, 2)}`).toBe(0);
      }
    });
  }
  it("positive control: synthetic bad snippet caught", () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-purity-"));
    const bad = join(dir, "bad.ts");
    writeFileSync(bad, "const r = Math.random(); const d = Date.now(); const w = window;\n");
    const badLines = executableLines(readFileSync(bad, "utf-8")).filter((l) => /Math\.random/.test(l));
    expect(badLines.length).toBeGreaterThan(0);
    unlinkSync(bad);
  });
  it("negative control: doc line stripped", () => {
    const doc = "// must contain no Math.random";
    expect(executableLines(doc).filter((l) => /Math\.random/.test(l)).length).toBe(0);
  });
});
