import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

export type Announcement = {
  id: string; body: string; link_url: string | null;
  variant: "info"|"success"|"warning"|"promo";
  is_active: boolean; starts_at: string | null; ends_at: string | null;
  created_at: string; updated_at: string;
};

// Public — anonymous-safe.
export const listActiveAnnouncements = createServerFn({ method: "GET" })
  .handler(async () => {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const nowIso = new Date().toISOString();
    const { data, error } = await sb
      .from("announcements")
      .select("id, body, link_url, variant, starts_at, ends_at")
      .eq("is_active", true)
      .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
      .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
      .order("created_at", { ascending: false }).limit(10);
    if (error) return [];
    return (data ?? []) as Array<Pick<Announcement,"id"|"body"|"link_url"|"variant"|"starts_at"|"ends_at">>;
  });

export const adminListAnnouncements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("announcements")
      .select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Announcement[];
  });

export const adminUpsertAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid().optional().nullable(),
    body: z.string().min(2).max(500),
    link_url: z.string().url().max(500).optional().nullable(),
    variant: z.enum(["info","success","warning","promo"]).default("info"),
    is_active: z.boolean().default(true),
    starts_at: z.string().datetime().optional().nullable(),
    ends_at: z.string().datetime().optional().nullable(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row: any = { ...data, created_by: context.userId };
    if (!row.id) delete row.id;
    const { error } = await supabaseAdmin.from("announcements").upsert(row, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  });

export const adminDeleteAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("announcements").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
