import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BUILD_ID } from "@/build-id";
import { logClientError, decodeServerFnId } from "@/lib/client-error-log";

const HEALTH_URL = "/api/public/health";
const POLL_MS = 60_000;
const RELOAD_GUARD = "_sfreload";

/**
 * Mounts:
 *  1. A polling check against /api/public/health — if the server's buildId
 *     differs from this bundle's BUILD_ID, prompt + auto hard-reload.
 *  2. A global fetch interceptor that watches /_serverFn/* responses and
 *     forces a hard reload exactly once when it sees the "Invalid server
 *     function ID" symptom (cache-busting for stale clients).
 *
 * The provider is invisible — it just installs side-effects and reports
 * server-fn failures to /api/public/client-errors.
 */
export function BuildSyncProvider() {
  const reloadedRef = useRef(false);
  const [, setApiHealthy] = useState(true);

  useEffect(() => {
    // expose build id for logger payloads
    (window as unknown as { __BUILD_ID__?: string }).__BUILD_ID__ = BUILD_ID;

    // 1) buildId polling
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(HEALTH_URL, { cache: "no-store" });
        if (!res.ok) {
          setApiHealthy(false);
          return;
        }
        const data = (await res.json()) as { buildId?: string };
        setApiHealthy(true);
        if (
          data.buildId &&
          data.buildId !== BUILD_ID &&
          BUILD_ID !== "dev-unknown" &&
          !reloadedRef.current
        ) {
          reloadedRef.current = true;
          toast("A new version is available", {
            description: "Reloading to apply the update…",
            duration: 4000,
          });
          setTimeout(() => hardReload("buildid"), 4000);
        }
      } catch {
        setApiHealthy(false);
      }
    };
    void check();
    const interval = window.setInterval(check, POLL_MS);

    // 2) /_serverFn fetch interceptor — cache-bust on stale server-fn IDs
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const isServerFn = url.includes("/_serverFn/");
      const response = await originalFetch(input as RequestInfo, init);
      if (isServerFn && !response.ok && response.status >= 500) {
        try {
          const cloned = response.clone();
          const text = await cloned.text();
          const { fnExport, fnFile } = decodeServerFnId(url);
          const isStaleId =
            /Invalid server function ID|not found in server function manifest|Cannot find module/i.test(
              text,
            );
          logClientError({
            kind: "server_fn_error",
            status: response.status,
            url,
            fnExport,
            fnFile,
            message: text.slice(0, 500),
          });
          if (isStaleId && !reloadedRef.current) {
            reloadedRef.current = true;
            toast.error("Stale client detected — reloading…");
            setTimeout(() => hardReload("staleid"), 600);
          }
        } catch {
          /* fall through */
        }
      }
      return response;
    };

    // un-set loop guard once the new bundle is in
    if (cleanReloadGuard()) {
      // no-op — just removes ?_sfreload=1 from the URL
    }

    return () => {
      cancelled = true;
      void cancelled;
      window.clearInterval(interval);
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}

function hardReload(reason: string) {
  const url = new URL(window.location.href);
  // don't loop forever — bail if we just reloaded for this reason
  const prev = url.searchParams.get(RELOAD_GUARD);
  if (prev === reason) return;
  url.searchParams.set(RELOAD_GUARD, reason);
  // bypass HTTP cache
  window.location.replace(url.toString());
}

function cleanReloadGuard(): boolean {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(RELOAD_GUARD)) return false;
  url.searchParams.delete(RELOAD_GUARD);
  window.history.replaceState({}, "", url.toString());
  return true;
}
