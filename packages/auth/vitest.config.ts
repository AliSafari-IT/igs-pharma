import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // real-Postgres harness from @igs/db/testing (T-004/T-016): Testcontainers or TEST_DATABASE_URL
    globalSetup: ["@igs/db/testing/global-setup"],
    alias: {
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
