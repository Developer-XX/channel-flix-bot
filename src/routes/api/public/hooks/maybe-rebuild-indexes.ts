// Cron-triggered. Runs rebuildIndexes only when pending_index_rebuild is true
// and no rebuild is currently in flight (lock held <5 min).

import { createFileRoute } from "@tanstack/react-router";

const LOCK_TTL_MS = 5 * 60 * 1000;

export const Route = createFileRoute("/api/public/hooks/maybe-rebuild-indexes")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { rebuildIndexes } = await import("@/lib/indexes.server");

        const { data: state } = await supabaseAdmin
          .from("telegram_bot_state")
          .select("pending_index_rebuild, indexes_rebuilding_at")
          .eq("id", "global")
          .maybeSingle();

        if (!state?.pending_index_rebuild) {
          return Response.json({ ok: true, skipped: "no_pending" });
        }
        if (
          state.indexes_rebuilding_at &&
          Date.now() - new Date(state.indexes_rebuilding_at).getTime() < LOCK_TTL_MS
        ) {
          return Response.json({ ok: true, skipped: "in_flight" });
        }

        // Acquire lock
        await supabaseAdmin
          .from("telegram_bot_state")
          .upsert(
            { id: "global", indexes_rebuilding_at: new Date().toISOString() },
            { onConflict: "id" },
          );

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
          return Response.json({ ok: true, rebuilt: r });
        } catch (e: any) {
          await supabaseAdmin
            .from("telegram_bot_state")
            .upsert({ id: "global", indexes_rebuilding_at: null }, { onConflict: "id" });
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
