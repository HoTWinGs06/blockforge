import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // tests/ is owned exclusively by the TEST AUTHOR agent.
    // The coverage gate (G1) is enforced here: CI fails below 85% on src/core/.
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/core/**/*.ts"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
    },
  },
  bench: {
    include: ["tests/**/*.bench.ts"],
    // G3: chunk generation + meshing must average < 16 ms per chunk.
    // The bench itself asserts the threshold; see tests/perf/chunk.bench.ts.
  },
});
