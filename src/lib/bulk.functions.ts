// Admin bulk job: re-run forceRematchAndPublish for every unmatched ingest
// in the last N days, while writing progress to bulk_job_runs so the admin
// UI can poll status.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(context: any) {
  const { data: ok } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!ok) throw new Error("Forbidden: admin only");
}

export const startBulkRematch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        days: z.number().int().min(1).max(180).default(7),
        dryRun: z.boolean().optional(),
        categories: z
          .array(z.enum(["movie", "series", "anime", "documentary", "show"]))
          .optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Refuse to start if another rematch job is currently running
    const { data: inflight } = await supabaseAdmin
      .from("bulk_job_runs")
      .select("id")
      .eq("job_type", "force_rematch")
      .eq("status", "running")
      .limit(1);
    if (inflight && inflight.length > 0) {
      throw new Error("A bulk rematch job is already running.");
    }

    const since = new Date(Date.now() - data.days * 24 * 60 * 60 * 1000).toISOString();
    let q = supabaseAdmin
      .from("telegram_ingest")
      .select("id")
      .eq("match_status", "unmatched")
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    if (data.categories && data.categories.length > 0) {
      q = q.in("parsed_category", data.categories as any);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    const ids = (rows ?? []).map((r: any) => r.id as string);

    const { data: job, error: jobErr } = await supabaseAdmin
      .from("bulk_job_runs")
      .insert({
        job_type: "force_rematch",
        params: { days: data.days, dryRun: !!data.dryRun },
        filters: { days: data.days, categories: data.categories ?? null, dryRun: !!data.dryRun },
        total: ids.length,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (jobErr) throw jobErr;

    void runRematchJob(job.id, ids, !!data.dryRun);

    return { jobId: job.id, total: ids.length };
  });

async function runRematchJob(jobId: string, ids: string[], dryRun: boolean) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { runMatcher, loadMatchingSettings, autoPromoteToMediaFile } = await import(
    "@/lib/telegram-ingest.server"
  );
  const { writeMatchAudit } = await import("@/lib/match-audit.server");
  const { markPromotionForAutoRebuild } = await import("@/lib/indexes.server");

  let processed = 0;
  let promoted = 0;
  let failed = 0;
  let stillUnmatched = 0;
  let lastError: string | null = null;
  const results: Array<{
    ingestId: string;
    parsedTitle: string | null;
    category: string | null;
    titleId: string | null;
    titleName: string | null;
    score: number | null;
    decision: "promoted" | "still_unmatched" | "failed";
    error?: string;
  }> = [];
  const settings = await loadMatchingSettings(supabaseAdmin);

  for (const id of ids) {
    let entry: (typeof results)[number] = {
      ingestId: id,
      parsedTitle: null,
      category: null,
      titleId: null,
      titleName: null,
      score: null,
      decision: "still_unmatched",
    };
    try {
      const { data: r } = await supabaseAdmin
        .from("telegram_ingest")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!r) {
        processed++;
        continue;
      }
      entry.parsedTitle = r.parsed_title ?? null;
      entry.category = (r.parsed_category as any) ?? null;
      const match = await runMatcher(
        supabaseAdmin,
        { title: r.parsed_title ?? "", year: r.parsed_year, category: r.parsed_category },
        settings,
      );
      entry.titleId = match.matchedTitleId ?? null;
      entry.score = typeof match.score === "number" ? match.score : null;
      if (entry.titleId) {
        const { data: t } = await supabaseAdmin
          .from("master_titles")
          .select("title")
          .eq("id", entry.titleId)
          .maybeSingle();
        entry.titleName = t?.title ?? null;
      }
      let didPromote = false;
      if (!dryRun && match.matchedTitleId && r.telegram_file_id) {
        try {
          await autoPromoteToMediaFile(supabaseAdmin, {
            ingestId: r.id,
            titleId: match.matchedTitleId,
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
          didPromote = true;
          promoted++;
          entry.decision = "promoted";
          await markPromotionForAutoRebuild(supabaseAdmin);
        } catch (e) {
          failed++;
          entry.decision = "failed";
          entry.error = (e as Error).message.slice(0, 200);
          lastError = (e as Error).message.slice(0, 300);
        }
      } else {
        stillUnmatched++;
        entry.decision = "still_unmatched";
      }
      await writeMatchAudit(supabaseAdmin, {
        ingestId: r.id,
        titleId: match.matchedTitleId,
        match,
        settings,
        decision: didPromote ? "promoted" : "rejected",
        reason: didPromote ? "bulk_rematch" : "below_threshold",
        actor: "bulk_job",
        parsedSnapshot: {
          title: r.parsed_title, year: r.parsed_year, category: r.parsed_category,
          season: r.parsed_season, episode: r.parsed_episode,
        },
      });
    } catch (e) {
      failed++;
      entry.decision = "failed";
      entry.error = (e as Error).message.slice(0, 200);
      lastError = (e as Error).message.slice(0, 300);
    }
    results.push(entry);
    processed++;

    if (processed % 5 === 0 || processed === ids.length) {
      await supabaseAdmin
        .from("bulk_job_runs")
        .update({
          processed,
          promoted,
          failed,
          last_error: lastError,
          results: results as any,
          params: { stillUnmatched } as any,
        })
        .eq("id", jobId);
    }
  }

  await supabaseAdmin
    .from("bulk_job_runs")
    .update({
      processed,
      promoted,
      failed,
      last_error: lastError,
      results: results as any,
      params: { stillUnmatched } as any,
      status: "completed",
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export const getBulkJobStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ jobId: z.string().uuid().optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.jobId) {
      const { data: row } = await supabaseAdmin
        .from("bulk_job_runs")
        .select("*")
        .eq("id", data.jobId)
        .maybeSingle();
      return { job: row };
    }
    const { data: rows } = await supabaseAdmin
      .from("bulk_job_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10);
    return { recent: rows ?? [] };
  });
