import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";
import { z } from "zod";

// Two-step, rate-limited destructive actions (currently: full database wipe).
//
// Flow:
//   1) requestDatabaseWipe()       -> returns { confirmationCode, expiresAt }
//   2) confirmDatabaseWipe({ code, confirmationPhrase })
//      - confirmationPhrase MUST equal "WIPE EVERYTHING"
//      - code must match the unconsumed row created in step 1
//      - rate limit: at most 1 successful wipe / hour / admin and 3 / day project-wide

const CONFIRM_PHRASE = "WIPE EVERYTHING";
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PER_ADMIN_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const PROJECT_DAILY_LIMIT = 3;

function newCode(): string {
  // 6-char base32-ish; collisions essentially impossible at our volume
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function reqMeta() {
  const ip =
    getRequestHeader("x-forwarded-for") ??
    getRequestHeader("cf-connecting-ip") ??
    null;
  const ua = getRequestHeader("user-agent") ?? null;
  return { ip, ua };
}

export const requestDatabaseWipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Per-admin cooldown: don't even let them request a new code mid-cooldown.
    const since = new Date(Date.now() - PER_ADMIN_COOLDOWN_MS).toISOString();
    const { count: recent } = await supabaseAdmin
      .from("admin_audit_log")
      .select("id", { count: "exact", head: true })
      .eq("actor_user_id", context.userId)
      .eq("action", "database_wipe")
      .eq("status", "success")
      .gte("created_at", since);
    if ((recent ?? 0) > 0) {
      throw new Error(
        `Rate limit: you already wiped the database in the last hour. Try again after the cooldown.`,
      );
    }

    const code = newCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

    // Invalidate any older pending wipe codes for this admin.
    await supabaseAdmin
      .from("pending_destructive_actions")
      .delete()
      .eq("actor_user_id", context.userId)
      .eq("action", "database_wipe")
      .is("consumed_at", null);

    const { error } = await supabaseAdmin.from("pending_destructive_actions").insert({
      actor_user_id: context.userId,
      action: "database_wipe",
      confirmation_code: code,
      expires_at: expiresAt,
    });
    if (error) throw error;

    const meta = reqMeta();
    await supabaseAdmin.from("admin_audit_log").insert({
      actor_user_id: context.userId,
      actor_email: (context.claims as { email?: string } | null)?.email ?? null,
      action: "database_wipe_requested",
      status: "pending",
      ip: meta.ip,
      user_agent: meta.ua,
      metadata: { expires_at: expiresAt },
    });

    return { confirmationCode: code, expiresAt, confirmationPhrase: CONFIRM_PHRASE };
  });

const ConfirmInput = z.object({
  code: z.string().min(4).max(20),
  confirmationPhrase: z.string(),
});

export const confirmDatabaseWipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ConfirmInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const meta = reqMeta();
    const email = (context.claims as { email?: string } | null)?.email ?? null;

    if (data.confirmationPhrase !== CONFIRM_PHRASE) {
      await supabaseAdmin.from("admin_audit_log").insert({
        actor_user_id: context.userId,
        actor_email: email,
        action: "database_wipe",
        status: "rejected",
        ip: meta.ip,
        user_agent: meta.ua,
        metadata: { reason: "wrong_confirmation_phrase" },
      });
      throw new Error(`Confirmation phrase must be exactly "${CONFIRM_PHRASE}".`);
    }

    // Project-wide daily limit
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: dayCount } = await supabaseAdmin
      .from("admin_audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "database_wipe")
      .eq("status", "success")
      .gte("created_at", since24h);
    if ((dayCount ?? 0) >= PROJECT_DAILY_LIMIT) {
      await supabaseAdmin.from("admin_audit_log").insert({
        actor_user_id: context.userId,
        actor_email: email,
        action: "database_wipe",
        status: "rejected",
        ip: meta.ip,
        user_agent: meta.ua,
        metadata: { reason: "daily_project_limit_exceeded", limit: PROJECT_DAILY_LIMIT },
      });
      throw new Error(
        `Daily project limit reached: only ${PROJECT_DAILY_LIMIT} wipes per 24h are allowed.`,
      );
    }

    // Validate token
    const { data: pending, error: pendErr } = await supabaseAdmin
      .from("pending_destructive_actions")
      .select("id, expires_at, consumed_at")
      .eq("actor_user_id", context.userId)
      .eq("action", "database_wipe")
      .eq("confirmation_code", data.code.toUpperCase())
      .is("consumed_at", null)
      .maybeSingle();
    if (pendErr) throw pendErr;
    if (!pending) {
      await supabaseAdmin.from("admin_audit_log").insert({
        actor_user_id: context.userId,
        actor_email: email,
        action: "database_wipe",
        status: "rejected",
        ip: meta.ip,
        user_agent: meta.ua,
        metadata: { reason: "invalid_or_consumed_code" },
      });
      throw new Error("Confirmation code is invalid or already used. Request a new one.");
    }
    if (new Date(pending.expires_at).getTime() < Date.now()) {
      await supabaseAdmin.from("admin_audit_log").insert({
        actor_user_id: context.userId,
        actor_email: email,
        action: "database_wipe",
        status: "rejected",
        ip: meta.ip,
        user_agent: meta.ua,
        metadata: { reason: "code_expired" },
      });
      throw new Error("Confirmation code expired. Request a new one.");
    }

    // Mark consumed before executing so a retry can't double-fire.
    await supabaseAdmin
      .from("pending_destructive_actions")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", pending.id);

    // Execute via the security-definer RPC (service-role granted).
    const { data: result, error: rpcErr } = await supabaseAdmin.rpc("wipe_application_data");
    if (rpcErr) {
      await supabaseAdmin.from("admin_audit_log").insert({
        actor_user_id: context.userId,
        actor_email: email,
        action: "database_wipe",
        status: "failed",
        ip: meta.ip,
        user_agent: meta.ua,
        metadata: { error: rpcErr.message },
      });
      throw rpcErr;
    }

    await supabaseAdmin.from("admin_audit_log").insert({
      actor_user_id: context.userId,
      actor_email: email,
      action: "database_wipe",
      status: "success",
      ip: meta.ip,
      user_agent: meta.ua,
      metadata: { result },
    });

    return { ok: true, result };
  });

export const listAdminAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number } | undefined) => ({
    limit: Math.min(Math.max(input?.limit ?? 50, 1), 200),
  }))
  .handler(async ({ data, context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("admin_audit_log")
      .select("id, actor_email, action, status, ip, user_agent, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw error;
    return rows ?? [];
  });
