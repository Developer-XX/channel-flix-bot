// Lists audit log entries scoped to tutorial settings changes.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

const TUTORIAL_KEYS = new Set([
  "TUTORIAL_ENABLED",
  "TUTORIAL_VIDEO_TYPE",
  "TUTORIAL_VIDEO_URL",
  "TUTORIAL_TITLE",
  "TUTORIAL_DESCRIPTION",
]);

export const listTutorialAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("admin_audit_log")
      .select("id, actor_user_id, actor_email, action, status, metadata, created_at")
      .eq("action", "settings.update")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const rows = (data ?? []).filter((r: any) => TUTORIAL_KEYS.has(r?.metadata?.key));
    const ids = Array.from(new Set(rows.map((r: any) => r.actor_user_id).filter(Boolean)));
    const nameMap = new Map<string, string | null>();
    if (ids.length) {
      const { data: profs } = await supabaseAdmin.from("profiles")
        .select("id, display_name").in("id", ids);
      for (const p of (profs ?? []) as Array<{ id: string; display_name: string | null }>) {
        nameMap.set(p.id, p.display_name);
      }
    }
    return rows.map((r: any) => ({
      ...r,
      actor_display_name: r.actor_user_id ? (nameMap.get(r.actor_user_id) ?? null) : null,
    }));
  });
