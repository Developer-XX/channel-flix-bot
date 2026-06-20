// Server-only helper to write structured Telegram sync step rows.
// Import inside server fn / server route handlers only.

export type SyncStep =
  | "fetch_updates"
  | "ingest_update"
  | "extract_metadata"
  | "db_write"
  | "cache_bump"
  | "channel_lookup"
  | "auto_promote"
  | "channel_retry"
  | "alert_check";

export type SyncStepStatus = "ok" | "error" | "warn" | "skipped";

export type SyncStepRow = {
  run_id: string;
  source: string; // "cron" | "webhook" | "manual_retry" | ...
  step: SyncStep | string;
  status: SyncStepStatus;
  error_code?: string | null;
  error_message?: string | null;
  latency_ms?: number | null;
  channel_id?: number | null;
  update_id?: number | null;
  details?: Record<string, unknown>;
};

export function newSyncRunId(): string {
  // Match crypto.randomUUID shape; falls back if not available in runtime
  try {
    return (globalThis.crypto as any)?.randomUUID?.() ?? fallback();
  } catch {
    return fallback();
  }
  function fallback() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

export async function recordSyncStep(row: SyncStepRow | SyncStepRow[]): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload = (Array.isArray(row) ? row : [row]).map((r) => ({
      run_id: r.run_id,
      source: r.source,
      step: r.step,
      status: r.status,
      error_code: r.error_code ?? null,
      error_message: r.error_message ? String(r.error_message).slice(0, 1000) : null,
      latency_ms: typeof r.latency_ms === "number" ? Math.max(0, Math.round(r.latency_ms)) : null,
      channel_id: r.channel_id ?? null,
      update_id: r.update_id ?? null,
      details: (r.details ?? {}) as never,
    }));
    if (!payload.length) return;
    const { error } = await supabaseAdmin.from("telegram_sync_steps").insert(payload as never);
    if (error) console.error("[telegram-sync-trace] insert failed", error.message);
  } catch (e) {
    console.error("[telegram-sync-trace] unexpected", e);
  }
}

// Convenience: wrap an async unit of work and record a step with latency + status.
export async function withSyncStep<T>(
  meta: Omit<SyncStepRow, "status" | "latency_ms" | "error_code" | "error_message">,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    void recordSyncStep({ ...meta, status: "ok", latency_ms: Date.now() - started });
    return result;
  } catch (e: any) {
    void recordSyncStep({
      ...meta,
      status: "error",
      latency_ms: Date.now() - started,
      error_code: e?.code ?? e?.name ?? "exception",
      error_message: e?.message ?? String(e),
    });
    throw e;
  }
}
