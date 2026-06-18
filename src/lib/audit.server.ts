// Shared helpers for audit logging, admin alerts, cron tracking, and
// admin-targeted Telegram notifications. Server-only.

import type { SupabaseClient } from "@supabase/supabase-js";

type SB = SupabaseClient<any, any, any>;

export type AuditEvent = {
  action: string; // e.g. "channel_sync.upsert", "cron.auto_delete.run"
  status?: "success" | "failed" | "warning" | "info";
  actorUserId?: string | null;
  actorEmail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeAudit(supabase: SB, ev: AuditEvent): Promise<void> {
  try {
    await supabase.from("admin_audit_log").insert({
      actor_user_id: ev.actorUserId ?? null,
      actor_email: ev.actorEmail ?? null,
      action: ev.action.slice(0, 64),
      status: ev.status ?? "success",
      ip: ev.ip ?? null,
      user_agent: ev.userAgent ?? null,
      metadata: ev.metadata ?? {},
    } as never);
  } catch (e) {
    console.warn("[audit] insert failed", (e as Error).message);
  }
}

// -- Admin alerts ---------------------------------------------------------

export type OpenAlertArgs = {
  kind: string;
  severity?: "info" | "warn" | "error";
  subject: string;
  details?: Record<string, unknown>;
  source?: string;
};

// Coalesces by (kind, subject) when an unresolved row already exists.
export async function openAdminAlert(supabase: SB, args: OpenAlertArgs): Promise<string | null> {
  try {
    const { data: existing } = await supabase
      .from("admin_alerts")
      .select("id, occurrences, last_notified_at")
      .eq("kind", args.kind)
      .eq("subject", args.subject)
      .is("resolved_at", null)
      .maybeSingle();
    const now = new Date().toISOString();
    if (existing) {
      await supabase
        .from("admin_alerts")
        .update({
          last_seen_at: now,
          occurrences: (existing as any).occurrences + 1,
          severity: args.severity ?? "warn",
          details: args.details ?? {},
        })
        .eq("id", (existing as any).id);
      return (existing as any).id as string;
    }
    const { data: ins } = await supabase
      .from("admin_alerts")
      .insert({
        kind: args.kind,
        severity: args.severity ?? "warn",
        subject: args.subject,
        details: args.details ?? {},
        source: args.source ?? null,
      })
      .select("id")
      .maybeSingle();
    return (ins as any)?.id ?? null;
  } catch (e) {
    console.warn("[alerts] open failed", (e as Error).message);
    return null;
  }
}

export async function resolveAdminAlerts(supabase: SB, kind: string, subject?: string): Promise<void> {
  try {
    let q = supabase
      .from("admin_alerts")
      .update({ resolved_at: new Date().toISOString() })
      .eq("kind", kind)
      .is("resolved_at", null);
    if (subject) q = q.eq("subject", subject);
    await q;
  } catch {}
}

// -- Cron run tracking ----------------------------------------------------

export async function recordCronRun(
  supabase: SB,
  jobName: string,
  ok: boolean,
  summary: Record<string, unknown> = {},
  errorMessage?: string | null,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const { data: row } = await supabase
      .from("cron_job_status")
      .select("consecutive_failures, total_runs, total_failures, expected_interval_seconds")
      .eq("job_name", jobName)
      .maybeSingle();
    const prev = (row as any) ?? {
      consecutive_failures: 0,
      total_runs: 0,
      total_failures: 0,
      expected_interval_seconds: 60,
    };
    const consecutive = ok ? 0 : prev.consecutive_failures + 1;
    await supabase
      .from("cron_job_status")
      .upsert(
        {
          job_name: jobName,
          last_run_at: now,
          last_ok_at: ok ? now : null,
          last_error: ok ? null : (errorMessage ?? "unknown").slice(0, 500),
          last_summary: summary,
          consecutive_failures: consecutive,
          total_runs: prev.total_runs + 1,
          total_failures: prev.total_failures + (ok ? 0 : 1),
          expected_interval_seconds: prev.expected_interval_seconds,
        },
        { onConflict: "job_name" },
      );

    await writeAudit(supabase, {
      action: `cron.${jobName.replace(/-/g, "_")}.run`,
      status: ok ? "success" : "failed",
      metadata: { ...summary, error: errorMessage ?? null, consecutive_failures: consecutive },
    });

    // Alert escalation: open alert when 2+ consecutive failures.
    if (!ok && consecutive >= 2) {
      const alertId = await openAdminAlert(supabase, {
        kind: "cron_failure",
        severity: "error",
        subject: `Cron job '${jobName}' failing (${consecutive} consecutive failures)`,
        details: { jobName, consecutive, lastError: errorMessage, summary },
        source: jobName,
      });
      await maybeNotifyAdminsTelegram(supabase, {
        alertId,
        kind: "cron_failure",
        text: `🚨 <b>Cron failure</b>\nJob: <code>${jobName}</code>\nConsecutive failures: <b>${consecutive}</b>\n${errorMessage ? `Error: ${escapeHtml(errorMessage).slice(0, 300)}` : ""}`,
      });
    } else if (ok) {
      await resolveAdminAlerts(supabase, "cron_failure", `Cron job '${jobName}' failing`);
    }
  } catch (e) {
    console.warn("[cron-status] record failed", (e as Error).message);
  }
}

// -- Admin Telegram DM alerts --------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

// Throttled to 1 message / kind / hour, only to admins with linked Telegram.
export async function maybeNotifyAdminsTelegram(
  supabase: SB,
  args: { alertId: string | null; kind: string; text: string },
): Promise<void> {
  try {
    if (args.alertId) {
      const { data: alert } = await supabase
        .from("admin_alerts")
        .select("last_notified_at")
        .eq("id", args.alertId)
        .maybeSingle();
      const last = (alert as any)?.last_notified_at as string | null;
      if (last && Date.now() - new Date(last).getTime() < 60 * 60 * 1000) return; // 1h throttle
    }
    // Fetch admin user ids + linked telegram chats.
    const { data: admins } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    const ids = (admins ?? []).map((r: any) => r.user_id);
    if (!ids.length) return;
    const { data: links } = await supabase
      .from("telegram_user_links")
      .select("telegram_user_id")
      .in("user_id", ids)
      .not("telegram_user_id", "is", null);
    const chatIds = (links ?? [])
      .map((r: any) => r.telegram_user_id)
      .filter((v: any): v is number => typeof v === "number");
    if (!chatIds.length) return;
    const { sendMessage } = await import("@/lib/telegram-api.server");
    await Promise.allSettled(chatIds.map((cid) => sendMessage(cid, args.text)));
    if (args.alertId) {
      await supabase
        .from("admin_alerts")
        .update({ last_notified_at: new Date().toISOString() })
        .eq("id", args.alertId);
    }
  } catch (e) {
    console.warn("[telegram-alerts] notify failed", (e as Error).message);
  }
}
