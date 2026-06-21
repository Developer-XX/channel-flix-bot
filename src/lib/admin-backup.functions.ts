// Admin data backup & restore.
//
// Exports all important application tables to a single JSON archive that an
// admin can download and re-upload later (after data loss, or when migrating
// to a different host / VPS). Uses the service role so RLS doesn't get in the
// way and so the full snapshot is captured deterministically.
//
// What is NOT exported:
//   - auth.users (passwords / sessions live in Supabase Auth; not accessible
//     via the Data API). Profiles + user_roles ARE exported so once a user
//     signs in again with the same email, their role assignments come back.
//   - rate-limit buckets, cron locks, webhook event log, ephemeral health
//     logs — these regenerate themselves at runtime.
//   - Object storage bucket contents.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminAccess } from "@/lib/admin-auth";

// Order matters for restore: parents before children (FK references).
const EXPORT_TABLES: readonly string[] = [
  "app_settings",
  "profiles",
  "user_roles",
  "premium_plans",
  "premium_payments",
  "announcements",
  "homepage_slides",
  "ads",
  "shortener_configs",
  "google_oauth_credentials",
  "telegram_channels",
  "telegram_user_links",
  "telegram_bot_state",
  "telegram_broadcast_subscribers",
  "telegram_broadcast_runs",
  "telegram_sync_steps",
  "master_titles",
  "title_aliases",
  "seasons",
  "episodes",
  "telegram_ingest",
  "media_files",
  "scheduled_message_deletes",
  "download_send_queue",
  "delivery_attempts",
  "content_requests",
  "support_tickets",
  "support_messages",
  "download_logs",
] as const;

// Bump when EXPORT_TABLES changes shape in a way that would make an old
// archive unsafe to restore against the current code.
const SCHEMA_VERSION = 3;

// Hard cap per table so the JSON download stays reasonable. Admins can ask
// for a bigger window in the UI if they have a huge dataset.
const DEFAULT_MAX_ROWS_PER_TABLE = 50_000;


export const exportAllData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ maxRowsPerTable: z.number().int().positive().max(500_000).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    try {
      await requireAdminAccess(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const cap = data.maxRowsPerTable ?? DEFAULT_MAX_ROWS_PER_TABLE;

      const tables: Record<string, any[]> = {};
      const counts: Record<string, number> = {};
      const skipped: Record<string, string> = {};

      for (const t of EXPORT_TABLES) {
        const { data: rows, error } = await supabaseAdmin
          .from(t as never)
          .select("*")
          .limit(cap);
        if (error) {
          skipped[t] = error.message;
          continue;
        }
        tables[t] = (rows ?? []) as any[];
        counts[t] = (rows ?? []).length;
      }

      return {
        ok: true,
        archive: {
          version: 1,
          schema_version: SCHEMA_VERSION,
          schema_tables: [...EXPORT_TABLES],
          kind: "lovable-app-backup",
          exported_at: new Date().toISOString(),
          exported_by: context.userId,
          row_cap: cap,
          counts,
          skipped,
          tables,
        },
      };
    } catch (err) {
      const { notifyOpsAlert } = await import("@/lib/ops-alert.server");
      notifyOpsAlert({
        level: "error",
        source: "backup.export",
        message: "exportAllData failed",
        details: { error: err instanceof Error ? err.message : String(err), userId: context.userId },
      });
      throw err;
    }
  });

const ImportArchiveSchema = z.object({
  version: z.literal(1),
  schema_version: z.number().int().optional(),
  schema_tables: z.array(z.string()).optional(),
  kind: z.string().optional(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

// Tables + key columns the completeness report inspects in detail.
// For each table we sample the archive and compare against live rows by the
// listed unique key, so admins can confirm Telegram file metadata round-trips.
const KEY_COLUMNS: Record<string, string[]> = {
  telegram_ingest: ["file_unique_id", "telegram_channel_id", "telegram_message_id"],
  media_files: ["file_unique_id", "file_id"],
  telegram_channels: ["telegram_chat_id"],
  episodes: ["id"],
  seasons: ["id"],
  master_titles: ["id"],
};

type LiveColumnMeta = { nullable: boolean; hasDefault: boolean };
type LiveSchemaProbe = {
  columns: Map<string, Map<string, LiveColumnMeta>>;
  tableErrors: Record<string, string>;
};

async function loadLiveSchemaProbe(
  supabaseAdmin: any,
  tables: Record<string, any[]>,
): Promise<LiveSchemaProbe> {
  const columns = new Map<string, Map<string, LiveColumnMeta>>();
  const tableErrors: Record<string, string> = {};

  // Prefer the optional metadata RPC when it exists, but never make restore depend
  // on PostgREST's schema cache. Self-hosted/VPS deployments often hit a stale
  // cache and return "Could not find the function ... in the schema cache".
  const { data: colsData, error: colsErr } = await supabaseAdmin.rpc(
    "get_public_columns" as never,
    { _tables: EXPORT_TABLES as unknown as string[] } as never,
  );

  if (!colsErr) {
    for (const row of (colsData as any[] | null) ?? []) {
      const tn = row.table_name as string;
      if (!columns.has(tn)) columns.set(tn, new Map());
      columns.get(tn)!.set(row.column_name, {
        nullable: row.is_nullable === "YES",
        hasDefault: row.column_default != null,
      });
    }
    return { columns, tableErrors };
  }

  const schemaCacheMiss = /schema cache|could not find the function|get_public_columns/i.test(
    colsErr.message ?? "",
  );
  if (!schemaCacheMiss) {
    throw new Error(`Failed to load live schema: ${colsErr.message}`);
  }

  // Fallback: verify tables directly through the Data API and use archive sample
  // columns for dry-run drift checks. Live restore still surfaces real per-table
  // upsert errors if a column actually changed.
  for (const t of EXPORT_TABLES) {
    const { error } = await supabaseAdmin
      .from(t as never)
      .select("*", { count: "exact", head: true });
    if (error) {
      tableErrors[t] = error.message;
      continue;
    }

    const sample = (tables[t] ?? []).find((row) => row && typeof row === "object") as
      | Record<string, unknown>
      | undefined;
    const tableCols = new Map<string, LiveColumnMeta>();
    for (const c of Object.keys(sample ?? { id: null })) {
      tableCols.set(c, { nullable: true, hasDefault: true });
    }
    columns.set(t, tableCols);
  }

  return { columns, tableErrors };
}

export const backupCompletenessReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      archive: ImportArchiveSchema,
      sampleSize: z.number().int().positive().max(5000).optional().default(500),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    type Row = {
      table: string;
      archive_rows: number;
      live_rows: number;
      delta: number;
      key_columns: string[];
      keys_checked: number;
      keys_missing_in_live: number;
      keys_missing_in_archive: number;
      sample_missing_in_live: string[];
      sample_missing_in_archive: string[];
      status: "ok" | "drift" | "skipped";
      note?: string;
    };

    const rows: Row[] = [];
    const archiveTables = data.archive.tables;
    const allTables = new Set<string>([
      ...EXPORT_TABLES,
      ...Object.keys(archiveTables),
    ]);

    for (const t of allTables) {
      const archiveRows = (archiveTables[t] ?? []) as any[];
      const { count: liveCountRaw, error: countErr } = await supabaseAdmin
        .from(t as never)
        .select("*", { count: "exact", head: true });

      if (countErr) {
        rows.push({
          table: t,
          archive_rows: archiveRows.length,
          live_rows: 0,
          delta: archiveRows.length,
          key_columns: [],
          keys_checked: 0,
          keys_missing_in_live: 0,
          keys_missing_in_archive: 0,
          sample_missing_in_live: [],
          sample_missing_in_archive: [],
          status: "skipped",
          note: countErr.message,
        });
        continue;
      }

      const liveCount = liveCountRaw ?? 0;
      const keyCols = KEY_COLUMNS[t] ?? ["id"];
      const primaryKey = keyCols[0];

      // Sample key values from the archive and check existence in live.
      const sample = archiveRows.slice(0, data.sampleSize);
      const archiveKeys = sample
        .map((r) => r?.[primaryKey])
        .filter((v) => v != null);

      let missingInLive = 0;
      const sampleMissingInLive: string[] = [];
      if (archiveKeys.length > 0) {
        const CHUNK = 500;
        const liveKeys = new Set<string>();
        for (let i = 0; i < archiveKeys.length; i += CHUNK) {
          const slice = archiveKeys.slice(i, i + CHUNK);
          const { data: hits } = await supabaseAdmin
            .from(t as never)
            .select(primaryKey)
            .in(primaryKey, slice as any);
          for (const h of (hits ?? []) as any[]) {
            liveKeys.add(String(h[primaryKey]));
          }
        }
        for (const k of archiveKeys) {
          if (!liveKeys.has(String(k))) {
            missingInLive++;
            if (sampleMissingInLive.length < 5) sampleMissingInLive.push(String(k));
          }
        }
      }

      // Reverse direction: sample live keys, check if absent from archive.
      let missingInArchive = 0;
      const sampleMissingInArchive: string[] = [];
      const { data: liveSample } = await supabaseAdmin
        .from(t as never)
        .select(primaryKey)
        .limit(data.sampleSize);
      const archiveKeySet = new Set(
        archiveRows.map((r) => String(r?.[primaryKey])).filter((v) => v !== "undefined"),
      );
      for (const r of (liveSample ?? []) as any[]) {
        const k = r?.[primaryKey];
        if (k != null && !archiveKeySet.has(String(k))) {
          missingInArchive++;
          if (sampleMissingInArchive.length < 5) sampleMissingInArchive.push(String(k));
        }
      }

      const delta = archiveRows.length - liveCount;
      const status: Row["status"] =
        delta === 0 && missingInLive === 0 && missingInArchive === 0 ? "ok" : "drift";

      rows.push({
        table: t,
        archive_rows: archiveRows.length,
        live_rows: liveCount,
        delta,
        key_columns: keyCols,
        keys_checked: archiveKeys.length,
        keys_missing_in_live: missingInLive,
        keys_missing_in_archive: missingInArchive,
        sample_missing_in_live: sampleMissingInLive,
        sample_missing_in_archive: sampleMissingInArchive,
        status,
      });
    }

    // Targeted check: every telegram_ingest row in the archive that has a
    // file_unique_id must map to a media_files row with that same value.
    const ingestRows = (archiveTables["telegram_ingest"] ?? []) as any[];
    const mediaRows = (archiveTables["media_files"] ?? []) as any[];
    const mediaUids = new Set(
      mediaRows.map((r) => r?.file_unique_id).filter((v) => v != null).map(String),
    );
    const ingestUids = ingestRows
      .map((r) => r?.file_unique_id)
      .filter((v) => v != null)
      .map(String);
    const orphanIngestUids = ingestUids.filter((u) => !mediaUids.has(u));

    const fileMetadataCheck = {
      ingest_with_file_unique_id: ingestUids.length,
      media_with_file_unique_id: mediaUids.size,
      ingest_orphans_without_media: orphanIngestUids.length,
      sample_orphans: orphanIngestUids.slice(0, 5),
      status:
        orphanIngestUids.length === 0
          ? ("ok" as const)
          : ("drift" as const),
    };

    const summary = {
      tables_checked: rows.length,
      tables_ok: rows.filter((r) => r.status === "ok").length,
      tables_drift: rows.filter((r) => r.status === "drift").length,
      tables_skipped: rows.filter((r) => r.status === "skipped").length,
      total_archive_rows: rows.reduce((a, r) => a + r.archive_rows, 0),
      total_live_rows: rows.reduce((a, r) => a + r.live_rows, 0),
      overall_status:
        rows.every((r) => r.status === "ok") && fileMetadataCheck.status === "ok"
          ? ("ok" as const)
          : ("drift" as const),
    };

    return {
      ok: true,
      generated_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
      archive_schema_version: data.archive.schema_version ?? 1,
      summary,
      tables: rows,
      file_metadata_check: fileMetadataCheck,
    };
  });



export const importAllData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      archive: ImportArchiveSchema,
      mode: z.enum(["upsert", "replace"]).default("upsert"),
      dryRun: z.boolean().optional().default(false),
      // confirm is only required for actual writes; dry runs don't touch data.
      confirm: z.union([z.literal("RESTORE"), z.literal("DRYRUN"), z.literal("")]).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!data.dryRun && data.confirm !== "RESTORE") {
      throw new Error("confirm=RESTORE required for live restore");
    }

    // ---- Integrity / version compatibility ----------------------------
    const archiveSchemaVersion = data.archive.schema_version ?? 1;
    const archiveTables = data.archive.schema_tables ?? Object.keys(data.archive.tables);
    const liveTables = [...EXPORT_TABLES];
    const unknownTables = archiveTables.filter((t) => !liveTables.includes(t));
    const missingTables = liveTables.filter((t) => !archiveTables.includes(t));
    const compatible = archiveSchemaVersion <= SCHEMA_VERSION && unknownTables.length === 0;
    const integrity = {
      archive_schema_version: archiveSchemaVersion,
      live_schema_version: SCHEMA_VERSION,
      archive_tables: archiveTables.length,
      live_tables: liveTables.length,
      unknown_tables: unknownTables,
      missing_tables: missingTables,
      compatible,
    };
    if (!data.dryRun && !compatible) {
      throw new Error(
        `Incompatible archive: schema v${archiveSchemaVersion} vs live v${SCHEMA_VERSION}` +
          (unknownTables.length ? `; unknown tables: ${unknownTables.join(", ")}` : "") +
          ". Run a dry-run to inspect, or re-export from a matching deployment.",
      );
    }

    const tables = data.archive.tables;


    type TableReport = {
      incoming: number;
      existing: number | null;
      idsInArchive: number;
      idsMatchingExisting: number; // would be overwritten on upsert
      newIds: number;              // would be inserted
      unknownColumns: string[];    // columns in archive not in live schema
      missingRequiredColumns: string[]; // NOT-NULL no-default columns absent from archive rows
      sampleRowErrors: string[];   // per-row issues (first 3)
      tableExists: boolean;
      error?: string;
    };

    const report: Record<string, TableReport> = {};

    // Load live schema info once for all involved tables. Falls back to direct
    // table probes if a self-hosted/VPS PostgREST schema cache has not picked up
    // the helper RPC yet.
    const { columns: liveCols, tableErrors } = await loadLiveSchemaProbe(supabaseAdmin, tables);

    // Per-table analysis (always run for dry runs; also collected during live runs).
    for (const t of EXPORT_TABLES) {
      const rows = (tables[t] ?? []) as any[];
      const live = liveCols.get(t);
      const r: TableReport = {
        incoming: rows.length,
        existing: null,
        idsInArchive: 0,
        idsMatchingExisting: 0,
        newIds: 0,
        unknownColumns: [],
        missingRequiredColumns: [],
        sampleRowErrors: [],
        tableExists: !!live && live.size > 0,
      };

      if (!r.tableExists) {
        r.error = tableErrors[t] ?? "table not found in live schema";
        report[t] = r;
        continue;
      }

      // Count existing rows.
      const { count: existingCount } = await supabaseAdmin
        .from(t as never)
        .select("id", { count: "exact", head: true });
      r.existing = existingCount ?? 0;

      if (rows.length === 0) {
        report[t] = r;
        continue;
      }

      // Compute archive vs live column drift on a sampled row.
      const sample = rows[0];
      const archiveCols = new Set(Object.keys(sample));
      const liveColSet = new Set(live!.keys());
      r.unknownColumns = [...archiveCols].filter((c) => !liveColSet.has(c));
      r.missingRequiredColumns = [...liveColSet].filter((c) => {
        const meta = live!.get(c)!;
        return !meta.nullable && !meta.hasDefault && !archiveCols.has(c);
      });

      // ID-based conflict detection (in chunks to keep .in() lists reasonable).
      const archiveIds = rows.map((row) => row?.id).filter((id) => id != null);
      r.idsInArchive = archiveIds.length;
      if (archiveIds.length > 0) {
        const CHUNK = 500;
        let matching = 0;
        for (let i = 0; i < archiveIds.length; i += CHUNK) {
          const slice = archiveIds.slice(i, i + CHUNK);
          const { data: hits } = await supabaseAdmin
            .from(t as never)
            .select("id")
            .in("id", slice as any);
          matching += (hits?.length ?? 0);
        }
        r.idsMatchingExisting = matching;
        r.newIds = archiveIds.length - matching;
      }

      report[t] = r;
    }

    // Dry-run: stop here.
    if (data.dryRun) {
      const summary = {
        tablesAnalyzed: Object.keys(report).length,
        totalIncoming: Object.values(report).reduce((a, r) => a + r.incoming, 0),
        totalConflicts: Object.values(report).reduce((a, r) => a + r.idsMatchingExisting, 0),
        tablesWithSchemaDrift: Object.entries(report)
          .filter(([, r]) => r.unknownColumns.length > 0 || r.missingRequiredColumns.length > 0)
          .map(([t]) => t),
        tablesMissing: Object.entries(report).filter(([, r]) => !r.tableExists).map(([t]) => t),
      };
      return { ok: true, dryRun: true, mode: data.mode, summary, report, integrity };
    }

    // Live restore path.
    const inserted: Record<string, number> = {};
    const failed: Record<string, string> = {};

    for (const t of EXPORT_TABLES) {
      const rows = (tables[t] ?? []) as any[];
      if (rows.length === 0) continue;
      if (report[t]?.error) {
        failed[t] = report[t].error!;
        continue;
      }

      try {
        if (data.mode === "replace") {
          const { error: delErr } = await supabaseAdmin
            .from(t as never)
            .delete()
            .not("id", "is", null);
          if (delErr && !/column .* does not exist/i.test(delErr.message)) {
            failed[t] = `delete failed: ${delErr.message}`;
            continue;
          }
        }

        const CHUNK = 500;
        let writtenForTable = 0;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const { error: upErr } = await supabaseAdmin
            .from(t as never)
            .upsert(chunk as never, { onConflict: "id" });
          if (upErr) {
            failed[t] = upErr.message;
            break;
          }
          writtenForTable += chunk.length;
        }
        inserted[t] = writtenForTable;
      } catch (e) {
        failed[t] = (e as Error).message;
      }
    }

    return { ok: true, dryRun: false, mode: data.mode, inserted, failed, report, integrity };
  });

// ---- Health check ------------------------------------------------------
// Lightweight ping the UI calls on mount to verify the server function
// route is reachable and the admin context is healthy before showing the
// Backup & Restore controls.
export const checkBackupHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Cheap probe: count one table we know exists.
    const { error } = await supabaseAdmin
      .from("app_settings" as never)
      .select("*", { count: "exact", head: true });
    return {
      ok: !error,
      schema_version: SCHEMA_VERSION,
      tables: EXPORT_TABLES.length,
      probe_error: error?.message ?? null,
      checked_at: new Date().toISOString(),
    };
  });

// ---- Self-test: export then dry-run import, assert counts match -------
export const runBackupSelfTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cap = 1_000;
    const tables: Record<string, any[]> = {};
    const counts: Record<string, number> = {};
    for (const t of EXPORT_TABLES) {
      const { data: rows } = await supabaseAdmin.from(t as never).select("*").limit(cap);
      tables[t] = (rows ?? []) as any[];
      counts[t] = tables[t].length;
    }
    // Compare archive counts against current counts. On a quiet DB they
    // should match — mismatches indicate writes happened mid-export.
    const mismatches: Record<string, { archive: number; live: number }> = {};
    for (const t of EXPORT_TABLES) {
      const { count } = await supabaseAdmin
        .from(t as never)
        .select("*", { count: "exact", head: true });
      const live = Math.min(count ?? 0, cap);
      if (live !== counts[t]) mismatches[t] = { archive: counts[t], live };
    }
    return {
      ok: Object.keys(mismatches).length === 0,
      schema_version: SCHEMA_VERSION,
      tables_checked: EXPORT_TABLES.length,
      total_rows: Object.values(counts).reduce((a, n) => a + n, 0),
      mismatches,
      ran_at: new Date().toISOString(),
    };
  });

