// Per-user 24h frequency cap for the login-style video interstitial.
// Periodic + before-download placements keep their localStorage cooldowns
// (anonymous-safe, lighter weight). The login placement is anchored to the
// signed-in user so it survives reloads / device switches.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AD_PLACEMENTS, type AdPlacement } from "@/lib/ads.functions";

const PLACEMENT_WINDOW_HOURS: Partial<Record<AdPlacement, number>> = {
  interstitial_login: 24,
};

export const getInterstitialEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ placement: z.enum(AD_PLACEMENTS) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const windowHours = PLACEMENT_WINDOW_HOURS[data.placement];
    if (!windowHours) {
      return { eligible: true, nextAllowedAt: null as string | null };
    }
    const cutoff = new Date(Date.now() - windowHours * 3600_000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("ad_view_log")
      .select("created_at")
      .eq("user_id", context.userId)
      .eq("placement", data.placement)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) {
      // Fail-open: don't block the user if telemetry breaks.
      return { eligible: true, nextAllowedAt: null as string | null };
    }
    if (!rows || rows.length === 0) {
      return { eligible: true, nextAllowedAt: null as string | null };
    }
    const last = new Date(rows[0].created_at).getTime();
    const next = new Date(last + windowHours * 3600_000).toISOString();
    return { eligible: false, nextAllowedAt: next };
  });

export const recordInterstitialView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        placement: z.enum(AD_PLACEMENTS),
        ad_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("ad_view_log").insert({
      user_id: context.userId,
      placement: data.placement,
      ad_id: data.ad_id ?? null,
    });
    if (error) {
      // Don't surface errors to the UI; this is best-effort telemetry.
      return { ok: false as const };
    }
    return { ok: true as const };
  });
