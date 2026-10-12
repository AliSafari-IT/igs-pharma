import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // real-Postgres harness from @igs/db/testing (T-004): one postgres:17-alpine per run
    globalSetup: ["@igs/db/testing/global-setup"],
    alias: {
      // `server-only` throws outside React Server Components; the kernel pulls in @igs/db/client
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
