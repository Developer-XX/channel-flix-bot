import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "https://channel-flix-bot.lovable.app";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "playwright-report/results.json" }],
  ],
  outputDir: "test-results",
  preserveOutput: "failures-only",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "mobile-320", use: { ...devices["iPhone SE"], viewport: { width: 320, height: 568 } } },
    { name: "mobile-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 800 } } },
    { name: "mobile-375", use: { ...devices["iPhone SE"], viewport: { width: 375, height: 667 } } },
    { name: "mobile-390", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
    { name: "mobile-414", use: { ...devices["iPhone 11"], viewport: { width: 414, height: 896 } } },
    { name: "tablet-768", use: { ...devices["iPad Mini"], viewport: { width: 768, height: 1024 } } },
  ],
});
