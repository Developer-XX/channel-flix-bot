import { defineConfig, devices } from "@playwright/test";

// E2E suite covering admin gating, post-login redirect-back, and admin link
// integrity. Run with: bun playwright test
// Requires the dev server on http://localhost:8080 (auto-reuses if running).
//
// Auth: tests sign in via the credentials in TEST_USER / TEST_PASS, falling
// back to a 'skip' tagged spec when those env vars are missing.

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    video: "retain-on-failure",
    headless: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "echo 'Reusing existing dev server on :8080'",
        url: "http://localhost:8080",
        reuseExistingServer: true,
        timeout: 5_000,
      },
});
