import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Test files share one throwaway database (and its migration runner), so
    // run them one at a time.
    fileParallelism: false,
  },
});
