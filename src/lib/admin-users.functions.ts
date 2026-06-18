// Admin-only server functions for user management (list/delete) and the
// Telegram broadcast subsystem (subscribers list, recent runs, web-initiated
// broadcast, manual setWebhook).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

// ---------- Users ----------

const ListUsersSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  perPage: z.number().int().min(1).max(200).optional().default(50),
  search: z.string().max(200).optional(),
});

export const adminListUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ListUsersSchema.parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({
      page: data.page,
      perPage: data.perPage,
    });
    if (error) throw error;
    let users = list.users;
    if (data.search) {
      const s = data.search.toLowerCase();
      users = users.filter(
        (u) =>
          (u.email ?? "").toLowerCase().includes(s) ||
          (u.id ?? "").toLowerCase().includes(s),
      );
    }
    // Hydrate roles + premium status
    const ids = users.map((u) => u.id);
    const [{ data: roles }, { data: profiles }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
      supabaseAdmin
        .from("profiles")
        .select("id, display_name, is_premium, premium_until")
        .in("id", ids),
    ]);
    const rolesById = new Map<string, string[]>();
    for (const r of roles ?? []) {
      const arr = rolesById.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesById.set(r.user_id, arr);
    }
    const profileById = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email ?? null,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        roles: rolesById.get(u.id) ?? [],
        displayName: profileById.get(u.id)?.display_name ?? null,
        isPremium: profileById.get(u.id)?.is_premium ?? false,
        premiumUntil: profileById.get(u.id)?.premium_until ?? null,
      })),
      total: list.total ?? users.length,
      page: data.page,
      perPage: data.perPage,
    };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ userId: z.string().uuid(), confirm: z.literal("DELETE") }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    if (data.userId === context.userId) {
      throw new Error("You cannot delete your own account from the admin panel.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Safety: don't let the last admin be deleted.
    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    const targetIsAdmin = (targetRoles ?? []).some((r: any) => r.role === "admin");
    if (targetIsAdmin) {
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1) {
        throw new Error("Cannot delete the last remaining admin account.");
      }
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw error;

    try {
      await supabaseAdmin.from("admin_audit_log").insert({
        actor_user_id: context.userId,
        actor_email: (context.claims as any)?.email ?? null,
        action: "user.delete",
        status: "success",
        metadata: { deleted_user_id: data.userId },
      } as never);
    } catch {}

    return { ok: true };
  });

// ---------- Telegram broadcast ----------

export const adminBroadcastOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ count: total }, { count: active }, { count: blocked }, { data: recentRuns }] = await Promise.all([
      supabaseAdmin
        .from("telegram_broadcast_subscribers")
        .select("telegram_user_id", { count: "exact", head: true }),
      supabaseAdmin
        .from("telegram_broadcast_subscribers")
        .select("telegram_user_id", { count: "exact", head: true })
        .eq("blocked", false),
      supabaseAdmin
        .from("telegram_broadcast_subscribers")
        .select("telegram_user_id", { count: "exact", head: true })
        .eq("blocked", true),
      supabaseAdmin
        .from("telegram_broadcast_runs")
        .select("id, source_kind, text_preview, total_targets, success_count, failed_count, started_at, finished_at, error_sample")
        .order("started_at", { ascending: false })
        .limit(20),
    ]);
    return {
      subscribers: { total: total ?? 0, active: active ?? 0, blocked: blocked ?? 0 },
      recentRuns: recentRuns ?? [],
    };
  });

export const adminSendTextBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ text: z.string().min(1).max(4000) }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendMessage } = await import("@/lib/telegram-api.server");

    const { data: subs } = await supabaseAdmin
      .from("telegram_broadcast_subscribers")
      .select("telegram_user_id, chat_id")
      .eq("blocked", false);
    const targets = (subs ?? []) as Array<{ telegram_user_id: number; chat_id: number }>;

    const { data: run } = await supabaseAdmin
      .from("telegram_broadcast_runs")
      .insert({
        initiated_by: context.userId,
        initiated_via: "web",
        source_kind: "text",
        text_preview: data.text.slice(0, 280),
        total_targets: targets.length,
      })
      .select("id")
      .single();

    let ok = 0, fail = 0;
    let errorSample: string | null = null;
    const blockedIds: number[] = [];
    for (const t of targets) {
      try {
        await sendMessage(t.chat_id, data.text);
        ok++;
      } catch (e: any) {
        fail++;
        const m = String(e?.message ?? e);
        if (!errorSample) errorSample = m.slice(0, 500);
        if (/bot was blocked|user is deactivated|chat not found/i.test(m)) {
          blockedIds.push(t.telegram_user_id);
        }
      }
      await new Promise((r) => setTimeout(r, 45));
    }
    if (blockedIds.length) {
      await supabaseAdmin
        .from("telegram_broadcast_subscribers")
        .update({ blocked: true, blocked_at: new Date().toISOString() })
        .in("telegram_user_id", blockedIds);
    }
    if (run?.id) {
      await supabaseAdmin
        .from("telegram_broadcast_runs")
        .update({
          success_count: ok,
          failed_count: fail,
          finished_at: new Date().toISOString(),
          error_sample: errorSample,
        })
        .eq("id", run.id);
    }
    return { ok, fail, total: targets.length };
  });

// ---------- Webhook re-registration (used after rotating bot token) ----------

export const adminRegisterTelegramWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { setWebhook, getWebhookInfo, getMe } = await import("@/lib/telegram-api.server");
    const { getSetting } = await import("@/lib/runtime-settings.server");

    const base =
      (await getSetting("PUBLIC_BASE_URL")) ??
      process.env.PUBLIC_BASE_URL ??
      "";
    if (!base) throw new Error("PUBLIC_BASE_URL is not configured (admin → Settings).");
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is not configured.");

    const url = `${base.replace(/\/$/, "")}/api/public/telegram/webhook`;
    await setWebhook({ url, secretToken: secret });
    const [info, me] = await Promise.all([getWebhookInfo(), getMe().catch(() => null)]);
    return {
      ok: true,
      webhookUrl: info.url,
      pendingUpdates: info.pending_update_count,
      lastError: info.last_error_message ?? null,
      botUsername: me?.username ?? null,
    };
  });
