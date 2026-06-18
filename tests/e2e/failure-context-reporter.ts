import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * On any failed step in the View-all / DownloadButton specs, dump:
 *   - the active route URL
 *   - the document outline (landmarks + headings)
 *   - currently focused element + tabindex chain
 *   - the closest aria-* attributes on the failing locator (if known)
 *
 * Files land under `playwright-debug/<test-id>/` and are referenced from the
 * HTML report. The data is captured by playwright via the attachments the
 * tests themselves push (see `attachFailureContext` helper).
 *
 * This reporter only adds a deterministic on-disk index so CI can surface
 * the per-failure context without scraping the HTML report.
 */
const OUT_DIR = "playwright-debug";

class FailureContextReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status !== "failed" && result.status !== "timedOut") return;
    if (!/view.all|download.button|section/i.test(test.title)) return;

    const dir = join(OUT_DIR, sanitize(test.id));
    try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }

    const summary = {
      title: test.title,
      file: test.location.file,
      status: result.status,
      duration: result.duration,
      retry: result.retry,
      errors: result.errors.map((e) => ({ message: e.message, stack: e.stack })),
      attachments: result.attachments.map((a) => ({ name: a.name, contentType: a.contentType, path: a.path })),
    };
    writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  }
}
function sanitize(s: string) { return s.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80); }

export default FailureContextReporter;
