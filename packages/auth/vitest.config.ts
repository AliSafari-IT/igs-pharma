import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // real-Postgres harness from @igs/db/testing (T-004) for the 2-step login flows (36b)
    globalSetup: ["@igs/db/testing/global-setup"],
    alias: {
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
