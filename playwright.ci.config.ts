import { defineConfig, devices } from "@playwright/test";

/**
 * Hardened config for the View-all + DownloadButton suites.
 *
 *  - retries: 2 (transient mock/network timing)
 *  - per-action timeout: 7s, per-test: 45s
 *  - on retry: capture trace, video, screenshots
 *  - custom reporter dumps DOM/ARIA/focus context on failure for the
 *    View-all and DownloadButton specs (see failure-context-reporter.ts)
 *
 * Use:  bun playwright test --config=playwright.ci.config.ts
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "homepage-view-all.spec.ts",
    "section-ordering.spec.ts",
    "section-contract.spec.ts",
    "download-button-flow.spec.ts",
    "analytics-events.spec.ts",
    "a11y-sweep.spec.ts",
  ],
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: 2,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["./tests/e2e/failure-context-reporter.ts"],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    viewport: { width: 1280, height: 900 },
    headless: true,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 7_000,
    navigationTimeout: 15_000,
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
