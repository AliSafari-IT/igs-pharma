import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // real-Postgres harness from @igs/db/testing for the fresh-check tests through the real Better Auth handler (#100)
    globalSetup: ["@igs/db/testing/global-setup"],
    alias: {
      "server-only": fileURLToPath(new URL("./test/support/server-only-stub.ts", import.meta.url)),
    },
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
