import { defineConfig } from "vitest/config";

// Separate from vite.config.ts: vitest 2 bundles vite 5, the app builds with vite 6.
export default defineConfig({
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts" },
});
