import { createFileRoute } from "@tanstack/react-router";

// Periodic resync: re-runs the Telegram matcher across unpromoted ingest rows
// for titles updated in the last N hours. Wired to pg_cron so newly uploaded
// media appears on title pages without anyone clicking "Re-run Telegram sync".
//
// Auth: bypass-auth /api/public/* route. We still require the Supabase
// anon/publishable key in the `apikey` header so random callers can't trigger
// expensive work.
export const Route = createFileRoute("/api/public/hooks/telegram-resync-recent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkCronAuth } = await import("@/lib/cron-auth.server");
        const auth = checkCronAuth(request);
        if (!auth.ok) return auth.response;

        const hoursStr = new URL(request.url).searchParams.get("hours");
        const hours = Math.max(1, Math.min(168, Number(hoursStr) || 24));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          loadMatchingSettings,
          autoPromoteToMediaFile,
          bestTitleScore,
          revalidatePromotedForTitle,
          reconcileRecentTelegramMedia,
        } = await import("@/lib/telegram-ingest.server");
        const { bumpCacheVersion } = await import("@/lib/indexes.server");
        const { recordTrace, newRunId } = await import("@/lib/sync-trace.server");

        const runId = newRunId();
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

        await recordTrace({
          run_id: runId,
          source: "resync-recent",
          decision: "matched",
          reason_code: "RUN_STARTED",
          details: { hours, since },
        });

        const { data: titles, error: titlesErr } = await supabaseAdmin
          .from("master_titles")
          .select("id, slug, title, release_year, category")
          .gte("updated_at", since)
          .eq("status", "published")
          .limit(50);
        if (titlesErr) {
          console.error("[resync-recent] titles query failed", titlesErr);
          await recordTrace({
            run_id: runId, source: "resync-recent", decision: "error",
            reason_code: "TITLES_QUERY_FAILED", details: { error: titlesErr.message },
          });
          return Response.json({ ok: false, error: titlesErr.message, runId }, { status: 500 });
        }

        const settings = await loadMatchingSettings(supabaseAdmin);
        let scannedTitles = 0;
        let promoted = 0;
        let skipped = 0;
        let demoted = 0;
        const errors: string[] = [];
        const traces: import("@/lib/sync-trace.server").TraceRow[] = [];

        const reconcile = await reconcileRecentTelegramMedia(supabaseAdmin, { sinceHours: hours, limit: 250 });
        promoted += reconcile.promoted;
        if (reconcile.errors.length) errors.push(...reconcile.errors.slice(0, 10).map((e) => `reconcile(${e.ingestId}): ${e.error}`));
        traces.push({
          run_id: runId,
          source: "resync-recent",
          decision: reconcile.errors.length ? "skipped" : "matched",
          reason_code: "RECENT_MEDIA_RECONCILED",
          details: { scanned: reconcile.scanned, updated: reconcile.updated, promoted: reconcile.promoted, errorCount: reconcile.errors.length },
        });

        for (const t of titles ?? []) {
          scannedTitles++;

          // Re-validate already-promoted matches first: demote any that no
          // longer meet the threshold so they stop showing on the title.
          try {
            const rev = await revalidatePromotedForTitle(supabaseAdmin, t, settings);
            demoted += rev.demoted;
            if (rev.demoted > 0) {
              traces.push({
                run_id: runId,
                source: "resync-recent",
                title_id: t.id,
                title_slug: (t as { slug?: string }).slug ?? null,
                channel_id: null,
                message_id: null,
                ingest_id: null,
                season_number: null,
                episode_number: null,
                decision: "skipped",
                reason_code: "DEMOTED_BELOW_THRESHOLD",
                details: { demoted: rev.demoted, kept: rev.kept, revalidated: rev.revalidated, ingestIds: rev.demotedIngestIds },
              });
            }
          } catch (e) {
            errors.push(`revalidate(${t.id}): ${(e as Error).message}`);
          }

          const head = (t.title || "").split(/\s+/).filter((w: string) => w.length >= 3)[0] ?? t.title?.[0] ?? "";
          if (!head) continue;
          const { data: rows } = await supabaseAdmin
            .from("telegram_ingest")
            .select("*")
            .ilike("parsed_title", `%${head}%`)
            .is("promoted_media_file_id", null)
            .limit(100);
          for (const r of rows ?? []) {
            const { score } = bestTitleScore(r.parsed_title ?? "", t.title, settings);
            const yearOk = !r.parsed_year || !t.release_year ||
              Math.abs(r.parsed_year - t.release_year) <= settings.year_window;
            const categoryOk = !r.parsed_category || !t.category || r.parsed_category === t.category;
            let adjusted = score;
            if (!yearOk) adjusted *= 0.6;
            if (settings.require_category_match && !categoryOk) adjusted = 0;
            else if (!categoryOk) adjusted *= 0.85;

            const baseTrace = {
              run_id: runId,
              source: "resync-recent" as const,
              title_id: t.id,
              title_slug: (t as { slug?: string }).slug ?? null,
              channel_id: r.channel_id ?? null,
              message_id: r.telegram_message_id ?? null,
              ingest_id: r.id,
              season_number: r.parsed_season ?? null,
              episode_number: r.parsed_episode ?? null,
            };

            if (!r.telegram_file_id) {
              skipped++;
              traces.push({ ...baseTrace, decision: "skipped", reason_code: "MEDIA_FILE_MISSING", details: { score: adjusted } });
              continue;
            }
            if (adjusted < settings.threshold) {
              skipped++;
              traces.push({
                ...baseTrace,
                decision: "skipped",
                reason_code: !yearOk ? "SKIPPED_YEAR_MISMATCH" : !categoryOk ? "SKIPPED_CATEGORY_MISMATCH" : "SKIPPED_TITLE_MISMATCH",
                details: { score: adjusted, threshold: settings.threshold, parsed: r.parsed_title },
              });
              continue;
            }
            try {
              await autoPromoteToMediaFile(supabaseAdmin, {
                ingestId: r.id,
                titleId: t.id,
                channelRowId: r.channel_id,
                telegramFileId: r.telegram_file_id,
                telegramMessageId: r.telegram_message_id,
                fileName: r.file_name ?? r.parsed_title ?? "file",
                caption: r.caption,
                mimeType: r.mime_type,
                fileSize: r.file_size,
                durationSeconds: r.duration_seconds,
                quality: r.parsed_quality,
                resolution: r.parsed_resolution,
                language: r.parsed_language,
                season: r.parsed_season,
                episode: r.parsed_episode,
              });
              promoted++;
              traces.push({ ...baseTrace, decision: "promoted", reason_code: "PROMOTED", details: { score: adjusted } });
            } catch (e) {
              const msg = (e as Error).message;
              errors.push(msg);
              traces.push({ ...baseTrace, decision: "error", reason_code: "PROMOTE_FAILED", details: { error: msg } });
            }
          }
        }

        if (traces.length) await recordTrace(traces);
        if (promoted > 0 || demoted > 0) await bumpCacheVersion(supabaseAdmin);

        await recordTrace({
          run_id: runId, source: "resync-recent", decision: "matched",
          reason_code: "RUN_FINISHED",
          details: { scannedTitles, promoted, skipped, demoted, errorCount: errors.length },
        });

        const summary = { ok: true, runId, hours, scannedTitles, promoted, skipped, demoted, errors: errors.slice(0, 10) };
        console.log("[resync-recent]", JSON.stringify(summary));
        return Response.json(summary);
      },
    },
  },
});
