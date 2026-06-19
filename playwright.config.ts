// Playwright E2E config — covers desktop Chromium, iOS WebKit (which
// blocks autoplay natively), and Android Chromium with
// `--autoplay-policy=user-gesture-required`.
//
// Run locally with:
//   bun add -D @playwright/test
//   bunx playwright install --with-deps chromium webkit
//   bunx playwright test
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-android",
      use: {
        ...devices["Pixel 7"],
        launchOptions: {
          args: ["--autoplay-policy=user-gesture-required"],
        },
      },
    },
    {
      name: "webkit-ios",
      use: { ...devices["iPhone 13"] },
    },
  ],
});
