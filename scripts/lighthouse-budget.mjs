#!/usr/bin/env node
/**
 * Lighthouse performance budget runner.
 *
 * Runs Lighthouse against mobile + desktop form factors for a set of URLs and
 * fails if the chosen Web Vitals exceed the budget. Defaults are tuned for a
 * dark, image-heavy streaming directory served from the edge.
 *
 * Usage:
 *   LH_BASE_URL=https://channel-flix-bot.lovable.app node scripts/lighthouse-budget.mjs
 *   LH_PATHS="/,/browse/movie,/title/doraemon-the-movie-nobita-s-earth-symphony-2024" node scripts/lighthouse-budget.mjs
 *
 * Requires Chrome installed on the host. Lighthouse is pulled via `npx -y`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.LH_BASE_URL ?? "https://channel-flix-bot.lovable.app";
const PATHS = (process.env.LH_PATHS ?? "/").split(",").map((p) => p.trim()).filter(Boolean);

// Budgets (in ms / unitless). Lower is better.
const BUDGETS = {
  mobile: {
    "largest-contentful-paint": 3000, // ms
    "cumulative-layout-shift": 0.1,
    "total-blocking-time": 300, // ms
    "first-contentful-paint": 2000, // ms
    performanceScore: 0.75,
  },
  desktop: {
    "largest-contentful-paint": 2000,
    "cumulative-layout-shift": 0.1,
    "total-blocking-time": 150,
    "first-contentful-paint": 1200,
    performanceScore: 0.9,
  },
};

function runLighthouse(url, formFactor, outDir) {
  const out = join(outDir, `lh-${formFactor}-${Date.now()}.json`);
  const args = [
    "-y",
    "lighthouse",
    url,
    "--quiet",
    "--chrome-flags=--headless=new --no-sandbox",
    "--only-categories=performance",
    `--form-factor=${formFactor}`,
    formFactor === "desktop" ? "--preset=desktop" : "--screenEmulation.mobile",
    "--output=json",
    `--output-path=${out}`,
  ];
  const r = spawnSync("npx", args, { stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) throw new Error(`lighthouse failed for ${url} (${formFactor})`);
  return JSON.parse(readFileSync(out, "utf8"));
}

function check(metricsBudget, report, label) {
  const a = report.audits;
  const score = report.categories.performance.score ?? 0;
  const failures = [];
  const got = {
    "first-contentful-paint": a["first-contentful-paint"].numericValue,
    "largest-contentful-paint": a["largest-contentful-paint"].numericValue,
    "cumulative-layout-shift": a["cumulative-layout-shift"].numericValue,
    "total-blocking-time": a["total-blocking-time"].numericValue,
    performanceScore: score,
  };
  for (const [k, limit] of Object.entries(metricsBudget)) {
    const v = got[k];
    const pass = k === "performanceScore" ? v >= limit : v <= limit;
    const fmt = k === "cumulative-layout-shift" || k === "performanceScore"
      ? v.toFixed(3) : `${Math.round(v)}ms`;
    const arrow = k === "performanceScore" ? ">=" : "<=";
    console.log(`  ${pass ? "✔" : "✘"} ${k.padEnd(28)} ${fmt} (${arrow} ${limit})`);
    if (!pass) failures.push(`${k}: ${fmt} (${arrow} ${limit})`);
  }
  if (failures.length) {
    console.error(`✘ ${label} failed budget:\n  - ${failures.join("\n  - ")}`);
    return false;
  }
  return true;
}

const tmp = mkdtempSync(join(tmpdir(), "lh-"));
let ok = true;
try {
  for (const p of PATHS) {
    const url = new URL(p, BASE).toString();
    for (const ff of ["mobile", "desktop"]) {
      console.log(`\n▶ Lighthouse ${ff.padEnd(7)} ${url}`);
      const report = runLighthouse(url, ff, tmp);
      const passed = check(BUDGETS[ff], report, `${ff} ${url}`);
      if (!passed) ok = false;
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (!ok) {
  console.error("\n✘ One or more Lighthouse budgets failed.");
  process.exit(1);
}
console.log("\n✔ All Lighthouse budgets passed.");
