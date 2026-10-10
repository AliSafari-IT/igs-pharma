import { defineConfig, devices } from "@playwright/test";

/**
 * Visual smoke check (T-015) and axe (T-017) against the PRODUCTION build of both apps: run
 * `pnpm build` first, then `pnpm --filter @igs/e2e smoke`. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use
 * a preinstalled Chromium.
 */
const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];
// fake values: the env schema only needs valid-looking ones (these pages read no data)
const env = {
  DATABASE_URL: "postgresql://smoke:smoke@localhost:5432/smoke",
  AUTH_SECRET: "smoke-only-placeholder-not-a-secret-000",
  AUTH_URL: "http://localhost:3000",
};

export default defineConfig({
  testDir: "./tests",
  testMatch: ["visual-smoke.spec.ts", "a11y.spec.ts"],
  timeout: 30_000,
  reporter: process.env["CI"] ? "github" : "list",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter=@igs/web run start",
      url: "http://localhost:3000/nl",
      env,
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter=@igs/platform run start",
      url: "http://localhost:3001/",
      // the /dev/ui gallery is a 404 in production unless switched on
      env: { ...env, UI_GALLERY: "on" },
      reuseExistingServer: false,
    },
  ],
});
