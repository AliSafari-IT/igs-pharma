import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "html",

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    command: "pnpm --filter=@igs/web run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env["CI"],
  },
});
