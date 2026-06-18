// Client-side helper for inserting onboarding analytics events.
// Inserts go through the browser supabase client and rely on the RLS policy
// `user_id IS NULL OR user_id = auth.uid()` to scope writes safely.
import { supabase } from "@/integrations/supabase/client";

export type OnboardingEvent = "opened" | "completed" | "skipped" | "source_admin_preview";

function sessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const k = "sv:onboarding:sid";
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

export async function trackOnboardingEvent(args: {
  event: OnboardingEvent;
  videoType?: string | null;
  videoUrl?: string | null;
  watchedMs?: number | null;
}): Promise<void> {
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id ?? null;
    await supabase.from("onboarding_events").insert({
      user_id: userId,
      session_id: sessionId() || null,
      event: args.event,
      video_type: args.videoType ?? null,
      video_url: args.videoUrl ?? null,
      watched_ms: args.watchedMs ?? null,
    } as never);
  } catch {
    // analytics best-effort; never throw into the UI
  }
}
