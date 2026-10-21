import { defineConfig } from "vitest/config";

/**
 * Vitest configuration.
 *
 * Gate G1 requires >= 85% coverage on src/core/ with the thresholds ENFORCED
 * here so that CI fails below the threshold rather than relying on a human
 * to notice a coverage report.
 *
 * tests/ is owned exclusively by the TEST AUTHOR agent. Do not add test
 * files here — create them under tests/ and let that agent own them.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      // Vitest 5 removed `coverage.all`; `include` now also pulls in untested
      // files, so untried core modules still count against the threshold.
      include: ["src/core/**/*.ts"],
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
    },
  },
});
