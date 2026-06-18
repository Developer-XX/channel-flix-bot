// Best-effort client-side error reporter. Used by the serverFn fetch interceptor
// and the ServerFnErrorBoundary to forward failures to /api/public/client-errors.
// No PII, simple in-memory rate limit so a hot loop can't spam the endpoint.

const MAX_PER_MIN = 10;
let bucket: number[] = [];

export interface ClientErrorPayload {
  kind: string;
  message?: string;
  fnExport?: string | null;
  fnFile?: string | null;
  status?: number;
  requestId?: string;
  url?: string;
  stack?: string;
}

export function logClientError(payload: ClientErrorPayload) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  bucket = bucket.filter((t) => now - t < 60_000);
  if (bucket.length >= MAX_PER_MIN) return;
  bucket.push(now);

  try {
    const body = JSON.stringify({
      ...payload,
      buildId: (window as unknown as { __BUILD_ID__?: string }).__BUILD_ID__,
      href: window.location.href,
      ts: new Date().toISOString(),
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/public/client-errors",
        new Blob([body], { type: "application/json" }),
      );
    } else {
      void fetch("/api/public/client-errors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* never throw from the logger */
  }
}

export function decodeServerFnId(
  url: string,
): { fnExport: string | null; fnFile: string | null } {
  try {
    const m = url.match(/\/_serverFn\/([^/?#]+)/);
    if (!m) return { fnExport: null, fnFile: null };
    const json = JSON.parse(atob(m[1]));
    return {
      fnExport: typeof json.export === "string" ? json.export : null,
      fnFile: typeof json.file === "string" ? json.file : null,
    };
  } catch {
    return { fnExport: null, fnFile: null };
  }
}
