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

export type EligibilityResult = { eligible: boolean; nextAllowedAt: string | null };

// Pure helper extracted from the createServerFn handler so it is unit-testable
// with a stubbed Supabase client.
export async function evaluateInterstitialEligibility(
  supabase: { from: (table: string) => unknown },
  userId: string,
  placement: AdPlacement,
  now: number = Date.now(),
): Promise<EligibilityResult> {
  const windowHours = PLACEMENT_WINDOW_HOURS[placement];
  if (!windowHours) return { eligible: true, nextAllowedAt: null };
  const cutoff = new Date(now - windowHours * 3600_000).toISOString();
  const q = supabase.from("ad_view_log") as {
    select: (cols: string) => {
      eq: (k: string, v: string) => {
        eq: (k: string, v: string) => {
          gte: (k: string, v: string) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: { created_at: string }[] | null; error: unknown }>;
            };
          };
        };
      };
    };
  };
  const { data: rows, error } = await q
    .select("created_at")
    .eq("user_id", userId)
    .eq("placement", placement)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !rows || rows.length === 0) {
    return { eligible: !error, nextAllowedAt: null };
  }
  const last = new Date(rows[0].created_at).getTime();
  return {
    eligible: false,
    nextAllowedAt: new Date(last + windowHours * 3600_000).toISOString(),
  };
}

export const getInterstitialEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ placement: z.enum(AD_PLACEMENTS) }).parse(d),
  )
  .handler(async ({ data, context }) =>
    evaluateInterstitialEligibility(context.supabase, context.userId, data.placement),
  );

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
    if (error) return { ok: false as const };
    return { ok: true as const };
  });
