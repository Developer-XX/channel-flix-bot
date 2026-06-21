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
  "master_titles",
  "title_aliases",
  "seasons",
  "episodes",
  "telegram_ingest",
  "media_files",
  "content_requests",
  "support_tickets",
  "support_messages",
  "download_logs",
] as const;

// Hard cap per table so the JSON download stays reasonable. Admins can ask
// for a bigger window in the UI if they have a huge dataset.
const DEFAULT_MAX_ROWS_PER_TABLE = 50_000;

export const exportAllData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ maxRowsPerTable: z.number().int().positive().max(500_000).optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
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
        kind: "lovable-app-backup",
        exported_at: new Date().toISOString(),
        exported_by: context.userId,
        row_cap: cap,
        counts,
        skipped,
        tables,
      },
    };
  });

const ImportArchiveSchema = z.object({
  version: z.literal(1),
  kind: z.string().optional(),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

export const importAllData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      archive: ImportArchiveSchema,
      mode: z.enum(["upsert", "replace"]).default("upsert"),
      confirm: z.literal("RESTORE"),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdminAccess(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const inserted: Record<string, number> = {};
    const failed: Record<string, string> = {};
    const tables = data.archive.tables;

    for (const t of EXPORT_TABLES) {
      const rows = tables[t];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      try {
        if (data.mode === "replace") {
          // Wipe table first. Use a where-true clause acceptable to PostgREST.
          const { error: delErr } = await supabaseAdmin
            .from(t as never)
            .delete()
            .not("id", "is", null);
          if (delErr && !/column .* does not exist/i.test(delErr.message)) {
            failed[t] = `delete failed: ${delErr.message}`;
            continue;
          }
        }

        // Chunk to keep individual requests small.
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

    return { ok: true, inserted, failed };
  });
