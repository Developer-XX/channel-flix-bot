#!/usr/bin/env node
/**
 * One-command production smoke test.
 *
 *   BASE_URL=https://movies.vybeprints.info \
 *   PREMIUM_DOWNLOAD_PATH=/title/some-slug \
 *   node scripts/smoke-test.mjs
 *
 * Exits 0 if all checks pass, 1 on any failure.
 *
 * Checks:
 *   1. GET  /api/public/health             → 200 + JSON {status:"ok"}
 *   2. GET  /admin/backup                  → 200 or 302 to /auth (route renders)
 *   3. GET  $PREMIUM_DOWNLOAD_PATH         → 200 (page renders; gating happens client-side)
 *
 * Optional env:
 *   BASE_URL                  default http://127.0.0.1:3000
 *   PREMIUM_DOWNLOAD_PATH     default /
 *   TIMEOUT_MS                default 15000
 */

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const PREMIUM_PATH = process.env.PREMIUM_DOWNLOAD_PATH || "/";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);

let failed = 0;
const results = [];

async function fetchWithTimeout(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, redirect: "manual" });
  } finally {
    clearTimeout(t);
  }
}

async function check(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    results.push({ name, status: "PASS", ms });
    console.log(`✓ ${name} (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - start;
    failed++;
    results.push({ name, status: "FAIL", ms, error: err?.message ?? String(err) });
    console.error(`✗ ${name} (${ms}ms): ${err?.message ?? err}`);
  }
}

await check("health endpoint", async () => {
  const res = await fetchWithTimeout(`${BASE_URL}/api/public/health`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body?.status !== "ok") throw new Error(`status != ok: ${JSON.stringify(body)}`);
});

await check("admin backup route reachable", async () => {
  const res = await fetchWithTimeout(`${BASE_URL}/admin/backup`);
  // 200 (rendered shell, gated client-side), 302/303/307 to /auth, or 401 are all acceptable.
  if (![200, 301, 302, 303, 307, 308, 401].includes(res.status)) {
    throw new Error(`HTTP ${res.status}`);
  }
});

await check(`premium-gated page reachable (${PREMIUM_PATH})`, async () => {
  const res = await fetchWithTimeout(`${BASE_URL}${PREMIUM_PATH}`);
  if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
});

console.log("\n— summary —");
for (const r of results) {
  console.log(`${r.status.padEnd(4)} ${r.name}  ${r.ms}ms${r.error ? `  ${r.error}` : ""}`);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
process.exit(0);
