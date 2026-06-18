import { supabase } from "@/integrations/supabase/client";

// Fire-and-forget client logger for anonymous "blocked browsing" attempts.
// The RPC is rate-limited globally to 600 inserts / minute and silently
// drops further calls, so we don't need to throttle client-side beyond
// avoiding duplicates per page navigation.
const sent = new Set<string>();

export async function logBlockedBrowsing(reason: string, slug?: string, path?: string) {
  try {
    const key = `${reason}|${slug ?? ""}|${path ?? ""}`;
    if (sent.has(key)) return;
    sent.add(key);
    if (sent.size > 64) sent.clear();
    const ua =
      typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 512) : null;
    await supabase.rpc("log_blocked_browsing", {
      _reason: reason.slice(0, 64),
      _slug: slug ?? null,
      _path: path ?? (typeof window !== "undefined" ? window.location.pathname : null),
      _user_agent: ua,
    });
  } catch {
    // Swallow — analytics must not break the redirect.
  }
}
