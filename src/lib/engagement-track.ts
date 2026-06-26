// Client-side helper for inserting engagement analytics events used by the
// admin dashboard (Support Group popup + Download Preflight dialog).
// Inserts go through the browser supabase client; RLS allows any caller to
// insert and only admins to read.
import { supabase } from "@/integrations/supabase/client";

export type EngagementEvent =
  | "support_popup_impression"
  | "support_popup_join_click"
  | "support_popup_dismiss"
  | "preflight_impression"
  | "preflight_verify_click"
  | "preflight_join_click";

function sessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const k = "sv:engagement:sid";
    let v = window.sessionStorage.getItem(k);
    if (!v) {
      v = Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.sessionStorage.setItem(k, v);
    }
    return v;
  } catch {
    return "";
  }
}

export async function trackEngagement(
  event: EngagementEvent,
  opts: { surface?: string; meta?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    await supabase.from("engagement_events").insert({
      user_id: data?.user?.id ?? null,
      session_id: sessionId() || null,
      event,
      surface: opts.surface ?? null,
      meta: opts.meta ?? null,
    } as never);
  } catch {
    // analytics best-effort; never throw into the UI
  }
}
