import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * ESLint flat config (ESLint 10 + typescript-eslint 8).
 *
 * Deliberately uses the non-type-checked recommended set: seven agents write
 * code in parallel and gate G5 requires `npm run lint` to be clean, so the
 * config favours a small, non-noisy rule set over maximal strictness. The
 * strong static guarantees live in `tsc --noEmit` (strict, plus
 * noUncheckedIndexedAccess and exactOptionalPropertyTypes) instead.
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-side helper scripts. These are not browser code: they legitimately
    // use console and process, and must not be linted against the browser
    // globals the rest of the repo uses.
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        performance: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
    },
  },
);
