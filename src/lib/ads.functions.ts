// Ads — admin-managed banners/snippets shown across the site.
// Premium users see no ads (enforced in <AdSlot/> via getMyPremiumStatus).
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

export const AD_PLACEMENTS = [
  "homepage_banner",
  "between_rows",
  "title_page",
  "before_download",
  // Full-screen blocking video interstitials (Google-style).
  "interstitial_login",          // shown right after sign-in / sign-up
  "interstitial_periodic",       // shown every N minutes of active session
  "interstitial_before_download",// shown before a download is started
] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export const INTERSTITIAL_PLACEMENTS: AdPlacement[] = [
  "interstitial_login",
  "interstitial_periodic",
  "interstitial_before_download",
];

export type Ad = {
  id: string;
  name: string;
  placement: AdPlacement;
  kind: "image" | "video" | "html";
  image_url: string | null;
  video_url: string | null;
  html: string | null;
  link_url: string | null;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

async function readSetting(key: string): Promise<string | null> {
  try {
    const { getSetting } = await import("@/lib/runtime-settings.server");
    return await getSetting(key);
  } catch { return null; }
}

function publicClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export const listActiveAds = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ placement: z.enum(AD_PLACEMENTS) }).parse(d),
  )
  .handler(async ({ data }) => {
    const adsEnabled = !/^(0|false|no|off)$/i.test(
      (await readSetting("ADS_ENABLED")) ?? "true",
    );
    if (!adsEnabled) return { ads: [] as Ad[], enabled: false };
    const sb = publicClient();
    const nowIso = new Date().toISOString();
    const { data: rows } = await sb
      .from("ads")
      .select("id,name,placement,kind,image_url,video_url,html,link_url,sort_order,is_active,starts_at,ends_at")
      .eq("is_active", true)
      .eq("placement", data.placement)
      .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
      .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
      .order("sort_order", { ascending: true })
      .limit(20);
    return { ads: (rows ?? []) as Ad[], enabled: true };
  });

export const adminListAds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("ads")
      .select("*")
      .order("placement", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Ad[];
  });

const adUpsertSchema = z
  .object({
    id: z.string().uuid().optional().nullable(),
    name: z.string().min(1, "Name is required").max(120),
    placement: z.enum(AD_PLACEMENTS, {
      errorMap: () => ({ message: `Placement must be one of: ${AD_PLACEMENTS.join(", ")}` }),
    }),
    kind: z.enum(["image", "video", "html"]).default("image"),
    image_url: z.string().url("Image URL must be a valid URL").max(1000).optional().nullable(),
    video_url: z.string().url("Video URL must be a valid URL").max(1000).optional().nullable(),
    html: z.string().max(8000).optional().nullable(),
    link_url: z.string().url("Link URL must be a valid URL").max(1000).optional().nullable(),
    sort_order: z.number().int().min(0).max(9999).default(0),
    is_active: z.boolean().default(true),
    starts_at: z.string().datetime().optional().nullable(),
    ends_at: z.string().datetime().optional().nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "image" && !d.image_url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["image_url"], message: "Image URL is required when kind = image" });
    }
    if (d.kind === "video" && !d.video_url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["video_url"], message: "Video URL is required when kind = video (mp4 recommended)" });
    }
    if (d.kind === "html" && !d.html?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["html"], message: "HTML snippet is required when kind = html" });
    }
    if (INTERSTITIAL_PLACEMENTS.includes(d.placement) && d.kind !== "video") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kind"],
        message: `Interstitial placements require kind = video (${INTERSTITIAL_PLACEMENTS.join(", ")})`,
      });
    }
    if (d.starts_at && d.ends_at && new Date(d.ends_at) <= new Date(d.starts_at)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ends_at"], message: "Ends-at must be after starts-at" });
    }
  });

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`)
    .join(" · ");
}

export const adminUpsertAd = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const r = adUpsertSchema.safeParse(d);
    if (!r.success) throw new Error(`AD_VALIDATION: ${formatZodError(r.error)}`);
    return r.data;
  })
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row: any = { ...data, created_by: context.userId };
    if (!row.id) delete row.id;
    const { error } = await supabaseAdmin.from("ads").upsert(row, { onConflict: "id" });
    if (error) throw new Error(`AD_SAVE_FAILED: ${error.message}`);
    return { ok: true };
  });

export const adminDeleteAd = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("ads").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// Record an ad impression / click / dismiss / complete. Uses the public (anon)
// Data API path so it works for signed-out visitors too. RLS allows INSERT for
// anon with this scoped event_type allow-list.
export const recordAdEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({
      ad_id: z.string().uuid(),
      placement: z.enum(AD_PLACEMENTS),
      event_type: z.enum(["impression", "click", "dismiss", "complete", "view"]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const sb = publicClient();
      await (sb as any).from("ad_events").insert({
        ad_id: data.ad_id,
        placement: data.placement,
        event_type: data.event_type,
      });
    } catch {
      /* swallow — analytics must never break rendering */
    }
    return { ok: true };
  });

// Public read-only interstitial configuration consumed by the client.
export type InterstitialConfig = {
  enabled: boolean;
  cancelSeconds: number;        // delay before the cancel button appears
  periodicMinutes: number;      // how often to show the periodic interstitial (0 disables)
  beforeDownloadCooldownMinutes: number; // min gap between before-download interstitials
  showOnLogin: boolean;
};

function parseIntSetting(v: string | null, fallback: number, min = 0, max = 100000): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function parseBoolSetting(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  return !/^(0|false|no|off)$/i.test(v.trim());
}

export const getInterstitialConfig = createServerFn({ method: "GET" })
  .handler(async (): Promise<InterstitialConfig> => {
    const adsEnabled = parseBoolSetting(await readSetting("ADS_ENABLED"), true);
    const enabled = adsEnabled && parseBoolSetting(await readSetting("AD_INTERSTITIAL_ENABLED"), true);
    return {
      enabled,
      cancelSeconds: parseIntSetting(await readSetting("AD_INTERSTITIAL_CANCEL_SECONDS"), 12, 3, 60),
      periodicMinutes: parseIntSetting(await readSetting("AD_INTERSTITIAL_PERIODIC_MINUTES"), 120, 0, 24 * 60),
      beforeDownloadCooldownMinutes: parseIntSetting(
        await readSetting("AD_INTERSTITIAL_BEFORE_DOWNLOAD_COOLDOWN_MINUTES"),
        120,
        0,
        24 * 60,
      ),
      showOnLogin: parseBoolSetting(await readSetting("AD_INTERSTITIAL_ON_LOGIN"), true),
    };
  });

export type AdStat = {
  ad_id: string;
  name: string;
  placement: AdPlacement;
  impressions: number;
  clicks: number;
  ctr: number;
};

export const adminAdStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: ads }, { data: events }] = await Promise.all([
      supabaseAdmin.from("ads").select("id,name,placement"),
      (supabaseAdmin as any)
        .from("ad_events")
        .select("ad_id,event_type")
        .gte("created_at", since)
        .limit(50_000),
    ]);
    const tally = new Map<string, { i: number; c: number }>();
    for (const e of (events ?? []) as any[]) {
      const t = tally.get(e.ad_id) ?? { i: 0, c: 0 };
      if (e.event_type === "impression") t.i++;
      else if (e.event_type === "click") t.c++;
      tally.set(e.ad_id, t);
    }
    const out: AdStat[] = ((ads ?? []) as any[]).map((a) => {
      const t = tally.get(a.id) ?? { i: 0, c: 0 };
      return {
        ad_id: a.id,
        name: a.name,
        placement: a.placement,
        impressions: t.i,
        clicks: t.c,
        ctr: t.i > 0 ? t.c / t.i : 0,
      };
    });
    return { stats: out, windowDays: 30 };
  });
