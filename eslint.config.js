import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "playwright-report/**", "test-results/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-explicit-any": "error",
      // src/core is pure: no side effects, no ambient globals.
      "no-restricted-globals": [
        "error",
        { name: "Math", message: "src/core must not use Math.random; use the seeded PRNG." },
      ],
    },
  },
  {
    // The core is allowed to use Math for pure math (floor, abs, min, max, sqrt).
    // Only Math.random is banned, and that is enforced by an AST rule below.
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-globals": "off",
    },
  },
  {
    // Hard ban on non-determinism and I/O inside src/core (G-determinism gate).
    files: ["src/core/**/*.ts"],
    ignores: ["src/core/**/*.test.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "src/core is pure: use the seeded PRNG (src/core/rng.ts) instead of Math.random.",
        },
        {
          object: "Date",
          property: "now",
          message: "src/core is pure: no wall-clock reads. Use an injected tick counter.",
        },
        {
          object: "performance",
          property: "now",
          message: "src/core is pure: no timing reads.",
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "localStorage",
          message: "src/core is pure: no browser storage access.",
        },
        {
          name: "indexedDB",
          message: "src/core is pure: no browser storage access.",
        },
        {
          name: "fetch",
          message: "src/core is pure: no network access.",
        },
        {
          name: "document",
          message: "src/core is pure: no DOM access.",
        },
        {
          name: "window",
          message: "src/core is pure: no DOM access.",
        },
      ],
    },
  },
  {
    files: ["server/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
