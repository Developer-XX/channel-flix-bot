// Cron-triggered. Single-instance via a unique partial index on
// index_rebuild_runs (atomic at the DB level — no race window). Every
// invocation writes a row recording start/end timestamps and whether it was
// skipped due to overlap or because nothing was pending.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/maybe-rebuild-indexes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth } = await import("@/lib/cron-auth.server");
        const auth = checkCronAuth(request);
        if (!auth.ok) return auth.response;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { rebuildIndexes } = await import("@/lib/indexes.server");

        const startedAt = new Date().toISOString();

        // 1. Is a rebuild even needed?
        const { data: state } = await supabaseAdmin
          .from("telegram_bot_state")
          .select("pending_index_rebuild")
          .eq("id", "global")
          .maybeSingle();
        if (!state?.pending_index_rebuild) {
          await supabaseAdmin.from("index_rebuild_runs").insert({
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            skipped: true,
            skip_reason: "no_pending",
          });
          return Response.json({ ok: true, skipped: "no_pending" });
        }

        // 2. Acquire the lock by inserting an in-flight row. The unique
        // partial index `index_rebuild_runs_single_inflight` causes this
        // insert to fail when another rebuild is already running, giving
        // us an atomic, single-instance advisory lock at the DB level.
        const { data: runRow, error: lockErr } = await supabaseAdmin
          .from("index_rebuild_runs")
          .insert({ started_at: startedAt })
          .select("id")
          .single();

        if (lockErr || !runRow) {
          await supabaseAdmin.from("index_rebuild_runs").insert({
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            skipped: true,
            skip_reason: "overlap",
          });
          return Response.json({ ok: true, skipped: "overlap" });
        }

        const runId = runRow.id as string;
        try {
          const r = await rebuildIndexes(supabaseAdmin);
          await supabaseAdmin
            .from("telegram_bot_state")
            .upsert(
              {
                id: "global",
                pending_index_rebuild: false,
                promotions_since_last_index: 0,
                indexes_rebuilding_at: null,
                indexes_rebuilt_at: new Date().toISOString(),
              },
              { onConflict: "id" },
            );
          await supabaseAdmin
            .from("index_rebuild_runs")
            .update({ finished_at: new Date().toISOString(), result: r as any })
            .eq("id", runId);
          return Response.json({ ok: true, rebuilt: r });
        } catch (e: any) {
          await supabaseAdmin
            .from("index_rebuild_runs")
            .update({
              finished_at: new Date().toISOString(),
              error: String(e?.message ?? e).slice(0, 500),
            })
            .eq("id", runId);
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
