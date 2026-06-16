#!/usr/bin/env node
/**
 * CI artifact comment generator for visual regression failures.
 *
 * Reads Playwright's JSON reporter output + the bundled diff report from
 * `scripts/visual-diff-report.mjs`, then emits a Markdown comment that:
 *   1. Links to the uploaded HTML diff report (env: VISUAL_DIFF_URL)
 *   2. Lists the top N failing snapshots, sorted by diff pixel ratio
 *   3. Embeds a thumbnail grid (expected | actual | diff) per failure
 *
 * Output:
 *   - Writes Markdown to /mnt/documents/visual-diffs/pr-comment.md
 *   - When GITHUB_OUTPUT is set, also appends `comment_body<<EOF` for the
 *     `actions/github-script` step to post via `issues.createComment`.
 *
 * Usage in CI:
 *   bun run perf:budget       # optional
 *   bun test:visual || true
 *   bun test:report-diffs     # creates /mnt/documents/visual-diffs/
 *   VISUAL_DIFF_URL=$ARTIFACT_URL bun scripts/ci-visual-comment.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const RESULTS_JSON = resolve(process.env.PW_RESULTS_JSON ?? "playwright-report/results.json");
const DIFF_DIR = resolve(process.env.PW_DIFF_OUT ?? "/mnt/documents/visual-diffs");
const TEST_RESULTS = resolve(process.env.PW_TEST_RESULTS ?? "test-results");
const REPORT_URL = process.env.VISUAL_DIFF_URL ?? "";
const TOP_N = Number(process.env.PW_TOP_N ?? 5);
const OUT_FILE = join(DIFF_DIR, "pr-comment.md");

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// Parse failing visual tests from the Playwright JSON report.
function loadFailures() {
  if (!existsSync(RESULTS_JSON)) return [];
  const json = JSON.parse(readFileSync(RESULTS_JSON, "utf8"));
  const failures = [];
  const visit = (suite) => {
    for (const child of suite.suites ?? []) visit(child);
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const last = t.results?.at(-1);
        if (!last || last.status === "passed" || last.status === "skipped") continue;
        const visualErr = (last.errors ?? []).find((e) =>
          /toHaveScreenshot|pixel.*differ|snapshot/i.test(e.message ?? ""),
        );
        if (!visualErr && !(last.errors ?? []).length) continue;
        const ratioMatch = visualErr?.message?.match(/Ratio[^0-9]*([0-9.]+)/i);
        failures.push({
          title: spec.title,
          file: spec.file,
          project: t.projectName,
          diffPixelRatio: ratioMatch ? Number(ratioMatch[1]) : 0,
          error: (visualErr?.message ?? last.errors?.[0]?.message ?? "").split("\n")[0].slice(0, 240),
        });
      }
    }
  };
  for (const s of json.suites ?? []) visit(s);
  return failures;
}

const failures = loadFailures();

if (failures.length === 0) {
  const body = `### ✅ Visual regression\n\nNo visual diffs detected across mobile breakpoints.`;
  if (existsSync(DIFF_DIR)) writeFileSync(OUT_FILE, body);
  console.log(body);
  emitGithubOutput(body);
  process.exit(0);
}

failures.sort((a, b) => b.diffPixelRatio - a.diffPixelRatio);
const top = failures.slice(0, TOP_N);

// Match diff thumbnails (produced by visual-diff-report.mjs) to failure names.
const diffImages = walk(join(DIFF_DIR, "images"));
function thumbFor(name, suffix) {
  const slug = name.replace(/[\\/\s]/g, "__");
  return diffImages.find((p) => p.includes(slug) && p.endsWith(`-${suffix}.png`));
}

const reportLine = REPORT_URL
  ? `📎 **[Open full visual diff report →](${REPORT_URL})**`
  : `📎 Full HTML report bundled at \`${relative(process.cwd(), DIFF_DIR)}/index.html\` (upload as a CI artifact).`;

const lines = [
  `### ❌ Visual regression — ${failures.length} failing snapshot${failures.length === 1 ? "" : "s"}`,
  ``,
  reportLine,
  ``,
  `<details open><summary><strong>Top ${top.length} by pixel drift</strong></summary>`,
  ``,
  `| # | Spec | Project | Diff ratio |`,
  `|---|------|---------|------------|`,
  ...top.map(
    (f, i) =>
      `| ${i + 1} | \`${f.title}\` | \`${f.project}\` | ${f.diffPixelRatio ? (f.diffPixelRatio * 100).toFixed(2) + "%" : "—"} |`,
  ),
  ``,
  `</details>`,
  ``,
];

for (const f of top) {
  const exp = thumbFor(f.title, "expected");
  const act = thumbFor(f.title, "actual");
  const diff = thumbFor(f.title, "diff");
  lines.push(`<details><summary><code>${f.title}</code> — <em>${f.project}</em></summary>`, ``);
  if (f.error) lines.push("```", f.error, "```", "");
  if (REPORT_URL && (exp || act || diff)) {
    const base = REPORT_URL.replace(/\/index\.html?$/, "");
    const img = (p, label) =>
      p ? `<img alt="${label}" src="${base}/${relative(DIFF_DIR, p).replace(/\\/g, "/")}" width="280"/>` : "";
    lines.push(
      `| Expected | Actual | Diff |`,
      `|---|---|---|`,
      `| ${img(exp, "expected")} | ${img(act, "actual")} | ${img(diff, "diff")} |`,
      ``,
    );
  }
  lines.push(`</details>`, ``);
}

if (failures.length > TOP_N) {
  lines.push(`_…and ${failures.length - TOP_N} more. See the full report._`);
}

const body = lines.join("\n");
if (existsSync(DIFF_DIR)) writeFileSync(OUT_FILE, body);
else console.warn(`Diff directory ${DIFF_DIR} missing — comment not saved to disk.`);
console.log(body);
emitGithubOutput(body);

function emitGithubOutput(text) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  try {
    const delim = `EOF_${Math.random().toString(36).slice(2)}`;
    const payload = `comment_body<<${delim}\n${text}\n${delim}\n`;
    // Append, don't overwrite.
    const fs = require("node:fs");
    fs.appendFileSync(out, payload);
  } catch (e) {
    console.warn("Failed to write GITHUB_OUTPUT:", e);
  }
}
