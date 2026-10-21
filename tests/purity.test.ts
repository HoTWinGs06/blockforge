import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

function stripComments(code: string): string {
  // Strip block comments and single-line comments
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("PRIORITY 1: Core Purity (Static Analysis)", () => {
  const coreDir = path.resolve(__dirname, "../src/core");
  const files = fs.readdirSync(coreDir).filter((f) => f.endsWith(".ts"));

  it("found TypeScript source files in src/core", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    describe(`file: src/core/${file}`, () => {
      const filePath = path.join(coreDir, file);
      const rawContent = fs.readFileSync(filePath, "utf-8");
      const content = stripComments(rawContent);

      it("does not contain Math.random()", () => {
        expect(content).not.toMatch(/\bMath\.random\s*\(/);
      });

      it("does not contain Date.now() or new Date()", () => {
        expect(content).not.toMatch(/\bDate\.now\s*\(/);
        expect(content).not.toMatch(/\bnew\s+Date\s*\(/);
      });

      it("does not contain performance.now()", () => {
        expect(content).not.toMatch(/\bperformance\.now\s*\(/);
      });

      it("does not access DOM or browser storage/window globals", () => {
        expect(content).not.toMatch(/\bwindow\b/);
        expect(content).not.toMatch(/\bdocument\b/);
        expect(content).not.toMatch(/\bnavigator\b/);
        expect(content).not.toMatch(/\blocalStorage\b/);
        expect(content).not.toMatch(/\bsessionStorage\b/);
        expect(content).not.toMatch(/\bindexedDB\b/);
        expect(content).not.toMatch(/\bHTMLElement\b/);
        expect(content).not.toMatch(/\bEventTarget\b/);
      });

      it("does not initiate network calls", () => {
        expect(content).not.toMatch(/\bfetch\s*\(/);
        expect(content).not.toMatch(/\bXMLHttpRequest\b/);
        expect(content).not.toMatch(/\bWebSocket\b/);
      });

      it("does not import Three.js", () => {
        expect(content).not.toMatch(/from\s+['"]three(?:\/.*)?['"]/);
        expect(content).not.toMatch(/import\s+['"]three(?:\/.*)?['"]/);
      });

      it("does not import from engine, render, net, gameplay, or server layers", () => {
        expect(content).not.toMatch(/from\s+['"].*\/engine(?:\/.*)?['"]/);
        expect(content).not.toMatch(/from\s+['"].*\/render(?:\/.*)?['"]/);
        expect(content).not.toMatch(/from\s+['"].*\/net(?:\/.*)?['"]/);
        expect(content).not.toMatch(/from\s+['"].*\/gameplay(?:\/.*)?['"]/);
        expect(content).not.toMatch(/from\s+['"].*\/server(?:\/.*)?['"]/);
      });
    });
  }
});
