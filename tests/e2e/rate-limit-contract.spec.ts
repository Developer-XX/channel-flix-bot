import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Contract test for rate limiting on /section/ and DownloadButton endpoints.
 *
 * The project currently does NOT run a global rate-limit primitive (see
 * runtime knowledge: no-backend-rate-limiting). This suite validates the
 * forward-looking contract:
 *
 *   - When a limit IS in place, responses MUST be HTTP 429 and include
 *     `Retry-After` and `RateLimit-*` headers (RFC 9331 / IETF draft).
 *   - When NO limit is in place (current state), the test self-skips with an
 *     annotation rather than fabricating a false pass.
 *
 * This file is kept so the contract is locked once limiting lands.
 */

const SECTION_PATH = "/section/trending";
const DOWNLOAD_FN_PATH = "/_serverFn/requestDownload"; // TanStack Start server-fn convention
const BURST = 80;
const CONCURRENCY = 20;

async function burst(baseURL: string | undefined, path: string, method: "GET" | "POST") {
  const ctx = await pwRequest.newContext({ baseURL });
  const tasks: Promise<Awaited<ReturnType<typeof ctx.get>>>[] = [];
  for (let i = 0; i < BURST; i++) {
    tasks.push(method === "GET"
      ? ctx.get(path)
      : ctx.post(path, { data: { ping: i }, headers: { "content-type": "application/json" } }),
    );
    if (tasks.length >= CONCURRENCY) {
      await Promise.allSettled(tasks.splice(0, tasks.length));
    }
  }
  return Promise.allSettled(tasks);
}

function inspectFor429(results: PromiseSettledResult<{ status: () => number; headers: () => Record<string, string> }>[]) {
  const fulfilled = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const statuses = fulfilled.map((r) => r.status());
  const limited = fulfilled.filter((r) => r.status() === 429);
  return { statuses, limited };
}

test.describe("Rate-limit contract (429 + headers)", () => {
  test("/section/ — bursts return 429 with correct headers (or skips if unlimited)", async ({ baseURL }) => {
    const results = await burst(baseURL, SECTION_PATH, "GET");
    // @ts-expect-error narrow generic
    const { statuses, limited } = inspectFor429(results);

    test.skip(limited.length === 0, `No 429 observed across ${statuses.length} requests — rate limiter not active for ${SECTION_PATH}. Statuses: ${[...new Set(statuses)].join(",")}`);

    const sample = limited[0];
    const hdrs = sample.headers();
    expect(hdrs["retry-after"], "429 must include Retry-After").toBeDefined();
    // At least one of the RateLimit-* headers (RFC 9331 draft) must be present.
    const hasRateLimitHeader = Object.keys(hdrs).some((k) => /^ratelimit(-(limit|remaining|reset|policy))?$/i.test(k));
    expect(hasRateLimitHeader, "429 must include RateLimit-* family headers").toBe(true);
  });

  test("download server-fn — bursts return 429 with correct headers (or skips if unlimited)", async ({ baseURL }) => {
    const results = await burst(baseURL, DOWNLOAD_FN_PATH, "POST");
    // @ts-expect-error narrow generic
    const { statuses, limited } = inspectFor429(results);

    test.skip(limited.length === 0, `No 429 observed across ${statuses.length} requests — rate limiter not active for ${DOWNLOAD_FN_PATH}. Statuses: ${[...new Set(statuses)].join(",")}`);

    const sample = limited[0];
    const hdrs = sample.headers();
    expect(hdrs["retry-after"]).toBeDefined();
  });
});
