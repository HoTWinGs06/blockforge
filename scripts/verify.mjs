// One-command gate for BlockForge.
//
// Runs the full gate chain in order and prints a per-step timing table, so an
// agent gets ONE command and ONE summary instead of remembering five commands
// and eyeballing five exit codes. Cross-platform: Node only, no bash.
//
//   node scripts/verify.mjs           full chain: typecheck, lint, test, gates, coverage, build
//   node scripts/verify.mjs --fast    inner loop: typecheck, lint, test, gates
//   node scripts/verify.mjs --no-coverage
//
// The gate:* scripts are in the chain in BOTH modes: a gate that the fast
// runner does not run is a gate that rots in silence.
//
// Exits non-zero on the first failing step, and names the failing step.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const args = new Set(process.argv.slice(2));
const fast = args.has("--fast");
const noCoverage = args.has("--no-coverage");

const steps = [
  { name: "typecheck", cmd: ["npm", "run", "--silent", "typecheck"], critical: true },
  { name: "lint", cmd: ["npm", "run", "--silent", "lint"], critical: true },
  { name: "test", cmd: ["npx", "vitest", "run"], critical: true },
  // The engine's own gates. They live here, in the runner, because a gate
  // that nothing runs is not a gate: they used to be npm scripts that only
  // a human remembered to call, so they rotted (TS5096) while `npm run check`
  // still said ALL GREEN.
  { name: "gate:determinism", cmd: ["npm", "run", "--silent", "gate:determinism"], critical: true },
  { name: "gate:bench", cmd: ["npm", "run", "--silent", "gate:bench"], critical: true },
  { name: "gate:selfcheck", cmd: ["npm", "run", "--silent", "gate:selfcheck"], critical: true },
];
if (!fast && !noCoverage) {
  steps.push({ name: "coverage", cmd: ["npm", "run", "--silent", "coverage"], critical: true });
}
if (!fast) {
  steps.push({ name: "build", cmd: ["npm", "run", "--silent", "build"], critical: true });
}

// Drift guard: every gate:* script in package.json must be wired into this
// runner. The TS5096 regression hid for days precisely because a gate nobody
// ran could rot unnoticed while `npm run check` still said ALL GREEN.
{
  const pkg = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
  );
  const wired = new Set(
    steps.flatMap((s) => s.cmd.filter((c) => c.startsWith("gate:"))),
  );
  const missing = Object.keys(pkg.scripts).filter(
    (name) => name.startsWith("gate:") && !wired.has(name),
  );
  if (missing.length > 0) {
    console.error(
      `\nUnwired gate(s) in package.json: ${missing.join(", ")}\n` +
        "Add each one to the steps list in scripts/verify.mjs, or it is not a gate.",
    );
    process.exit(1);
  }
}

const results = [];
let failed = null;

for (const step of steps) {
  process.stdout.write(`\n── ${step.name} ${"─".repeat(Math.max(0, 46 - step.name.length))}\n`);
  const t0 = performance.now();
  const r = spawnSync(step.cmd[0], step.cmd.slice(1), {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  const ms = Math.round(performance.now() - t0);
  results.push({ name: step.name, ms, ok: r.status === 0 });
  if (r.status !== 0) {
    failed = step.name;
    break;
  }
}

const total = results.reduce((a, b) => a + b.ms, 0);
console.log("\n" + "═".repeat(54));
console.log("  BLOCKFORGE GATE SUMMARY");
console.log("═".repeat(54));
for (const r of results) {
  console.log(
    `  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(18)} ${String(r.ms).padStart(6)} ms`,
  );
}
console.log("─".repeat(54));
console.log(
  `  ${failed ? "FAILED at: " + failed : "ALL GREEN"}`.padEnd(31) +
    `total ${total} ms`,
);
console.log("═".repeat(54));

process.exit(failed ? 1 : 0);
