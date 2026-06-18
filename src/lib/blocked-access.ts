import { supabase } from "@/integrations/supabase/client";

// Fire-and-forget client logger for anonymous "blocked browsing" attempts.
// The RPC is rate-limited globally to 600 inserts / minute and silently
// drops further calls, so we don't need to throttle client-side beyond
// avoiding duplicates per page navigation.
const sent = new Set<string>();

export async function logBlockedBrowsing(reason: string, slug?: string, path?: string) {
  const key = `${reason}|${slug ?? ""}|${path ?? ""}`;
  if (sent.has(key)) return;
  sent.add(key);
  if (sent.size > 64) sent.clear();

  const ua = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 512) : undefined;
  const fullPath =
    path ?? (typeof window !== "undefined" ? window.location.pathname : undefined);

  try {
    const { error } = await supabase.rpc("log_blocked_browsing", {
      _reason: reason.slice(0, 64),
      _slug: slug ?? undefined,
      _path: fullPath,
      _user_agent: ua,
    });
    // Structured log — easier to grep in browser/server logs than free text.
    if (typeof console !== "undefined") {
      console.info(
        JSON.stringify({
          kind: "blocked_browsing",
          ok: !error,
          reason,
          slug: slug ?? null,
          path: fullPath ?? null,
          error: error?.message ?? null,
          ts: new Date().toISOString(),
        }),
      );
    }
  } catch (e) {
    // Swallow — analytics must not break the redirect.
    if (typeof console !== "undefined") {
      console.warn(
        JSON.stringify({
          kind: "blocked_browsing",
          ok: false,
          reason,
          error: e instanceof Error ? e.message : String(e),
          ts: new Date().toISOString(),
        }),
      );
    }
  }
}
