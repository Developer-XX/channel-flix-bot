// Homepage slideshow + section ordering server functions.
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

export type HomepageSlide = {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  link_url: string | null;
  cta_label: string | null;
  sort_order: number;
  is_active: boolean;
  duration_ms: number;
};

export const DEFAULT_SECTION_ORDER = [
  "trending",
  "latest",
  "movies",
  "series",
  "anime",
  "kdrama",
] as const;

async function readSetting(key: string): Promise<string | null> {
  try {
    const { getSetting } = await import("@/lib/runtime-settings.server");
    return await getSetting(key);
  } catch {
    return null;
  }
}

function publicClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export const getHomepageLayout = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const { data } = await sb
    .from("homepage_slides")
    .select("id,title,subtitle,image_url,link_url,cta_label,sort_order,is_active,duration_ms")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const orderRaw = await readSetting("HOMEPAGE_SECTION_ORDER");
  const slideshowEnabled = !/^(0|false|no|off)$/i.test(
    (await readSetting("HOMEPAGE_SLIDESHOW_ENABLED")) ?? "true",
  );
  const sectionOrder = (orderRaw && orderRaw.trim()
    ? orderRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [...DEFAULT_SECTION_ORDER]) as string[];

  return {
    slides: (data ?? []) as HomepageSlide[],
    sectionOrder,
    slideshowEnabled,
  };
});

export const adminListSlides = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("homepage_slides")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return (data ?? []) as HomepageSlide[];
  });

export const adminUpsertSlide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional().nullable(),
        title: z.string().min(1).max(200),
        subtitle: z.string().max(400).optional().nullable(),
        image_url: z.string().url().max(1000),
        link_url: z.string().url().max(1000).optional().nullable(),
        cta_label: z.string().max(60).optional().nullable(),
        sort_order: z.number().int().min(0).max(9999).default(0),
        is_active: z.boolean().default(true),
        duration_ms: z.number().int().min(1500).max(60000).default(5000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row: any = { ...data, created_by: context.userId };
    if (!row.id) delete row.id;
    const { error } = await supabaseAdmin.from("homepage_slides").upsert(row, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  });

export const adminDeleteSlide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("homepage_slides").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
