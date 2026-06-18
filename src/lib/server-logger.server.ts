// Centralized server-side logger for server-function requests.
// Writes structured JSON to console (picked up by worker logs) and, for
// errors / 5xx, inserts into admin_error_log via the service-role client.
//
// SAFE TO IMPORT ONLY FROM .server / .functions handlers — never from
// client-reachable modules.

interface LogEntry {
  requestId: string;
  fnExport?: string | null;
  fnFile?: string | null;
  userId?: string | null;
  status?: number | null;
  durationMs?: number | null;
  message?: string | null;
  stack?: string | null;
  metadata?: Record<string, unknown>;
}

// Simple time-ordered ID — no extra deps.
export function newRequestId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${t}-${r}`;
}

export async function logServerFnRequest(entry: LogEntry, isError: boolean) {
  const payload = {
    kind: "server_fn",
    at: new Date().toISOString(),
    ...entry,
  };
  // Always structured-log to console.
  if (isError) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(payload));
  } else if ((entry.durationMs ?? 0) > 1500) {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ ...payload, slow: true }));
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  }

  if (!isError) return;
  // Persist 5xx / thrown errors so admins can audit them later.
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("admin_error_log").insert({
      request_id: entry.requestId,
      fn_export: entry.fnExport ?? null,
      fn_file: entry.fnFile ?? null,
      user_id: entry.userId ?? null,
      status: entry.status ?? 500,
      error_message: entry.message?.slice(0, 2000) ?? null,
      error_stack: entry.stack?.slice(0, 5000) ?? null,
      duration_ms: entry.durationMs ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (insertErr) {
    // eslint-disable-next-line no-console
    console.error("admin_error_log insert failed", insertErr);
  }
}
