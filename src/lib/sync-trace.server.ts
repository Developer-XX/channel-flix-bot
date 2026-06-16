/**
 * Server-only helper to insert sync trace rows.
 * Import inside server function/route handlers only.
 */
export type TraceDecision = "matched" | "skipped" | "promoted" | "rejected" | "hidden" | "error";

export type TraceRow = {
  run_id: string;
  source: string;
  title_id?: string | null;
  title_slug?: string | null;
  channel_id?: number | string | null;
  message_id?: number | null;
  ingest_id?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  decision: TraceDecision;
  reason_code: string;
  details?: Record<string, unknown>;
};

export async function recordTrace(rows: TraceRow | TraceRow[]): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload = (Array.isArray(rows) ? rows : [rows]).map((r) => ({
      ...r,
      details: (r.details ?? {}) as never,
    }));
    if (!payload.length) return;
    const { error } = await supabaseAdmin.from("sync_trace_log").insert(payload as never);
    if (error) {
      // Never let logging break the caller
      console.error("[sync-trace] insert failed", error.message);
    }
  } catch (e) {
    console.error("[sync-trace] unexpected", e);
  }
}

export function newRunId(): string {
  return crypto.randomUUID();
}
