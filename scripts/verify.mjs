// One-command gate for BlockForge.
//
// Runs the full gate chain in order and prints a per-step timing table, so an
// agent gets ONE command and ONE summary instead of remembering five commands
// and eyeballing five exit codes. Cross-platform: Node only, no bash.
//
//   node scripts/verify.mjs           full chain: typecheck, lint, test, coverage, build
//   node scripts/verify.mjs --fast    inner loop: typecheck, lint, test  (no coverage, no build)
//   node scripts/verify.mjs --no-coverage
//
// Exits non-zero on the first failing step, and names the failing step.

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const fast = args.has("--fast");
const noCoverage = args.has("--no-coverage");

const steps = [
  { name: "typecheck", cmd: ["npm", "run", "--silent", "typecheck"], critical: true },
  { name: "lint", cmd: ["npm", "run", "--silent", "lint"], critical: true },
  { name: "test", cmd: ["npx", "vitest", "run"], critical: true },
];
if (!fast && !noCoverage) {
  steps.push({ name: "coverage", cmd: ["npm", "run", "--silent", "coverage"], critical: true });
}
if (!fast) {
  steps.push({ name: "build", cmd: ["npm", "run", "--silent", "build"], critical: true });
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
    `  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(12)} ${String(r.ms).padStart(6)} ms`,
  );
}
console.log("─".repeat(54));
console.log(`  ${failed ? "FAILED at: " + failed : "ALL GREEN"}`.padEnd(24) + `total ${total} ms`);
console.log("═".repeat(54));

process.exit(failed ? 1 : 0);
