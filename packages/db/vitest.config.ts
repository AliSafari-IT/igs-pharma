import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./src/testing/global-setup.ts"],
    alias: {
      // `server-only` throws outside React Server Components; the client module imports it
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
    // first run pulls the postgres image; container start dominates
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
