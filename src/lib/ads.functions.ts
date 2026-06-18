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
] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

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

export const adminUpsertAd = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional().nullable(),
        name: z.string().min(1).max(120),
        placement: z.enum(AD_PLACEMENTS),
        kind: z.enum(["image", "video", "html"]).default("image"),
        image_url: z.string().url().max(1000).optional().nullable(),
        video_url: z.string().url().max(1000).optional().nullable(),
        html: z.string().max(8000).optional().nullable(),
        link_url: z.string().url().max(1000).optional().nullable(),
        sort_order: z.number().int().min(0).max(9999).default(0),
        is_active: z.boolean().default(true),
        starts_at: z.string().datetime().optional().nullable(),
        ends_at: z.string().datetime().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row: any = { ...data, created_by: context.userId };
    if (!row.id) delete row.id;
    const { error } = await supabaseAdmin.from("ads").upsert(row, { onConflict: "id" });
    if (error) throw error;
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
