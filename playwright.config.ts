import { defineConfig, devices } from "@playwright/test";

/**
 * BlockForge — Playwright configuration (gate G2).
 *
 * The G2 gate runs the game in a real headless browser and asserts on the
 * console STREAM: zero errors and zero warnings for the whole session.
 *
 * The dev server is started by Playwright itself (`webServer`), so the gate
 * is one command with no manual setup.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://localhost:5173",
    // The e2e job runs against the DEV SERVER, not a production build.
    // That matters because the game's testing seam (window.__blockforge) is
    // published only when import.meta.env.DEV is true - so it exists here,
    // and a production build carries no debug backdoor. It is stated here
    // rather than left implicit, because if this ever switches to serving
    // dist/, every test that drives the game through the handle would start
    // failing with a null handle.
    //
    // NOTE: reuseExistingServer means a Vite instance left over from an
    // earlier session will be reused, and the tests will then run against
    // STALE CODE. When a change appears not to apply, check the port first:
    //   netstat -ano | grep :5173
    //   taskkill /PID <pid> /F /T
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
