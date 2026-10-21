import { defineConfig } from "vite";

/**
 * Vite configuration.
 *
 * `base: "./"` produces relative asset URLs, which is what the GitHub Pages
 * deploy (owned by the RELEASE agent) needs for a project-page URL.
 */
export default defineConfig({
  base: "./",
  build: {
    target: "es2023",
    sourcemap: true,
    outDir: "dist",
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
