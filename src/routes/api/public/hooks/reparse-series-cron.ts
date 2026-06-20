// Cron-driven: periodically re-runs the SxxPnEyy backfill for newly-ingested
// or re-cropped TV series files. Admin-configurable via app_settings:
//   REPARSE_SERIES_CRON_ENABLED      "true" | "false" (default: false)
//   REPARSE_SERIES_CRON_LIMIT        rows scanned per run, 1..2000 (default: 500)
//   REPARSE_SERIES_CRON_DRYRUN       "true" | "false" (default: false)
//
// Auth: standard cron header (CRON_SECRET / service-role / apikey).
import { createFileRoute } from "@tanstack/react-router";
import { checkCronAuth } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/hooks/reparse-series-cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = checkCronAuth(request);
        if (!auth.ok) return auth.response;

        const t0 = Date.now();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { getSetting, getSettingNumber } = await import("@/lib/runtime-settings.server");
        const { recordCronRun } = await import("@/lib/audit.server");
        const { parseMedia } = await import("@/lib/telegram-parser");

        const enabled = (await getSetting("REPARSE_SERIES_CRON_ENABLED"))?.toLowerCase() === "true";
        if (!enabled) {
          await recordCronRun(supabaseAdmin, "reparse-series-cron", true, {
            skipped: true,
            reason: "disabled",
          });
          return Response.json({ ok: true, skipped: true, reason: "disabled" });
        }

        const limit = Math.max(1, Math.min(2000, await getSettingNumber("REPARSE_SERIES_CRON_LIMIT", 500)));
        const dryRun = (await getSetting("REPARSE_SERIES_CRON_DRYRUN"))?.toLowerCase() === "true";

        let scanned = 0;
        let changed = 0;
        let updated = 0;
        let runError: string | null = null;

        try {
          const { data: rows, error } = await supabaseAdmin
            .from("telegram_ingest")
            .select("id, caption, file_name, matched_title_id, parsed_season, parsed_episode, promoted_media_file_id")
            .not("matched_title_id", "is", null)
            .or("caption.ilike.%P%E%,file_name.ilike.%P%E%,caption.ilike.%Part%,file_name.ilike.%Part%")
            .order("id", { ascending: false }) // newest first for cron
            .limit(limit);
          if (error) throw error;

          for (const r of rows ?? []) {
            scanned++;
            const parsed = parseMedia(r.caption, r.file_name);
            if (parsed.season == null || parsed.episode == null || parsed.part == null) continue;
            const encoded = parsed.part * 100 + parsed.episode;
            if (r.parsed_season === parsed.season && r.parsed_episode === encoded) continue;
            changed++;
            if (dryRun) continue;

            await supabaseAdmin
              .from("telegram_ingest")
              .update({ parsed_season: parsed.season, parsed_episode: encoded })
              .eq("id", r.id);
            updated++;
          }
        } catch (e) {
          runError = (e as Error).message;
        }

        const durationMs = Date.now() - t0;
        await recordCronRun(supabaseAdmin, "reparse-series-cron", runError === null, {
          scanned,
          changed,
          updated_ingest: updated,
          dry_run: dryRun,
          limit,
          duration_ms: durationMs,
        }, runError);

        return Response.json({
          ok: runError === null,
          scanned,
          changed,
          updated_ingest: updated,
          dry_run: dryRun,
          duration_ms: durationMs,
          error: runError,
        });
      },
    },
  },
});
