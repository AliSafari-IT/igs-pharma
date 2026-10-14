import { defineConfig, devices } from "@playwright/test";

import { smokeEnv, smokePreviewKey } from "./smoke-env";

/**
 * Visual smoke check (T-015) and axe (T-017) against the PRODUCTION build of both apps: run
 * `pnpm build` first, then `pnpm --filter @igs/e2e smoke`. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use
 * a preinstalled Chromium.
 */
const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];
const env = smokeEnv;

export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "visual-smoke.spec.ts",
    "a11y.spec.ts",
    "account.spec.ts",
    "two-step.spec.ts",
    "staff.spec.ts",
    "coming-soon.spec.ts",
    "catalog.spec.ts",
    "stock.spec.ts",
    "categories.spec.ts",
    "privacy.spec.ts",
    "prices.spec.ts",
    "storefront-preview.spec.ts",
    "storefront-browse.spec.ts",
    "backoffice-dashboard.spec.ts",
    "session-limits.spec.ts",
    "reservations.spec.ts",
  ],
  timeout: 30_000,
  reporter: process.env["CI"] ? "github" : "list",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // CI uploads the traces of failed tests (e2e (smoke) job)
        trace: "retain-on-failure",
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter=@igs/web run start",
      url: "http://localhost:3000/nl",
      // the open storefront; production defaults to the coming-soon gate (#46)
      env: { ...env, SITE_GATE: "off" },
      reuseExistingServer: false,
    },
    {
      // the same build with SITE_GATE unset: closed by default (coming-soon.spec.ts)
      command: "pnpm --filter=@igs/web exec next start --port 3002",
      url: "http://localhost:3002/api/health/live",
      // "" counts as unset, and overrides a SITE_GATE inherited from the shell
      env: { ...env, SITE_GATE: "", IGS_PREVIEW_KEY: smokePreviewKey },
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter=@igs/platform run start",
      // the route the staging container health check calls (igs-pharma#48)
      url: "http://localhost:3001/api/health/live",
      // the /dev/ui gallery is a 404 in production unless switched on; Better Auth (and so the
      // passkeys' relying party) lives on the platform origin (36b)
      env: { ...env, AUTH_URL: "http://localhost:3001", UI_GALLERY: "on" },
      reuseExistingServer: false,
    },
  ],
});
