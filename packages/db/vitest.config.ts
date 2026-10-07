import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./src/testing/global-setup.ts"],
    // first run pulls the postgres image; container start dominates
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
