#!/usr/bin/env node
/**
 * Visual regression diff artifact bundler.
 *
 * After `playwright test` writes pixel-diff artifacts to `test-results/`,
 * this script:
 *   1. Discovers every failed visual diff trio (-expected, -actual, -diff)
 *   2. Composes a single HTML overview page with before / after / diff
 *      side-by-side, grouped by spec + project
 *   3. Copies the report + raw images to `/mnt/documents/visual-diffs/`
 *      so CI can upload them and the user can preview locally.
 *
 * Safe to run when there are no failures — it exits cleanly with a notice.
 */

import { readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, basename, relative, resolve } from "node:path";

const TEST_RESULTS = resolve(process.env.PW_TEST_RESULTS ?? "test-results");
const OUT_DIR = resolve(process.env.PW_DIFF_OUT ?? "/mnt/documents/visual-diffs");

if (!existsSync(TEST_RESULTS)) {
  console.log(`No test-results/ directory found at ${TEST_RESULTS} — nothing to bundle.`);
  process.exit(0);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const allFiles = walk(TEST_RESULTS);
const diffs = allFiles.filter((f) => /-diff\.png$/i.test(f));

if (diffs.length === 0) {
  console.log("✓ No visual diff failures detected.");
  process.exit(0);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(join(OUT_DIR, "images"), { recursive: true });

const cases = [];
for (const diffPath of diffs) {
  const expected = diffPath.replace(/-diff\.png$/i, "-expected.png");
  const actual = diffPath.replace(/-diff\.png$/i, "-actual.png");
  if (!existsSync(expected) || !existsSync(actual)) continue;

  const rel = relative(TEST_RESULTS, diffPath);
  const slug = rel.replace(/[\\/]/g, "__").replace(/-diff\.png$/i, "");
  const copy = (src, suffix) => {
    const dst = join(OUT_DIR, "images", `${slug}-${suffix}.png`);
    copyFileSync(src, dst);
    return `images/${basename(dst)}`;
  };
  cases.push({
    name: rel,
    expected: copy(expected, "expected"),
    actual: copy(actual, "actual"),
    diff: copy(diffPath, "diff"),
  });
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Visual diffs — ${cases.length} failure(s)</title>
<style>
  body{font:14px/1.4 system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#eee;margin:0;padding:24px}
  h1{margin:0 0 8px}
  .meta{color:#888;margin-bottom:24px;font-size:12px}
  .case{background:#141414;border:1px solid #2a2a2a;border-radius:12px;padding:16px;margin-bottom:24px}
  .case h2{margin:0 0 12px;font-size:14px;font-family:ui-monospace,monospace;color:#f6c177;word-break:break-all}
  .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .grid figure{margin:0;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:8px;overflow:hidden}
  .grid figcaption{padding:6px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888;background:#0a0a0a}
  .grid img{display:block;width:100%;height:auto}
  .label-expected figcaption{color:#7ed957}
  .label-actual figcaption{color:#f08080}
  .label-diff figcaption{color:#ffb454}
  @media (max-width:900px){.grid{grid-template-columns:1fr}}
</style></head>
<body>
<h1>Visual regression failures</h1>
<div class="meta">${cases.length} failing snapshot${cases.length === 1 ? "" : "s"} from ${TEST_RESULTS}</div>
${cases.map((c) => `
<div class="case">
  <h2>${c.name}</h2>
  <div class="grid">
    <figure class="label-expected"><figcaption>Expected (baseline)</figcaption><img src="${c.expected}" loading="lazy"/></figure>
    <figure class="label-actual"><figcaption>Actual (this run)</figcaption><img src="${c.actual}" loading="lazy"/></figure>
    <figure class="label-diff"><figcaption>Diff overlay</figcaption><img src="${c.diff}" loading="lazy"/></figure>
  </div>
</div>`).join("")}
</body></html>`;

writeFileSync(join(OUT_DIR, "index.html"), html);
console.log(`✘ ${cases.length} visual regression failure(s).`);
console.log(`  Report: ${join(OUT_DIR, "index.html")}`);
console.log(`  Open in browser or attach as a CI artifact.`);

// In CI we still want this script to exit 0 — the actual test failure is
// what fails the run. This is just an artifact step. Set PW_DIFF_STRICT=1
// to bubble up the failure count instead.
if (process.env.PW_DIFF_STRICT === "1") process.exit(1);
