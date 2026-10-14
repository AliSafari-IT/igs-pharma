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
    // One test file at a time (igs-pharma#107). `src/index.test.ts` loads the whole Better Auth
    // graph in a fresh worker, which is the slowest thing in this package on a CI runner; run next
    // to the database-heavy `mfa-flows.test.ts` on a 2-core machine it competed for CPU with it
    // and timed out. Sequential files cost about as much wall time (the two together were already
    // limited by the CPU) and take the contention out of the picture.
    fileParallelism: false,
  },
});
