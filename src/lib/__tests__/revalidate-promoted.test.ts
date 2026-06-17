import { describe, it, expect, vi } from "vitest";
import { revalidatePromotedForTitle, DEFAULT_MATCHING_SETTINGS } from "@/lib/telegram-ingest.server";

// In-memory stub mirroring the Supabase fluent builder shape used by
// revalidatePromotedForTitle. Each table has its own state and minimal
// chainable methods (select / eq / in / not / is / order / limit /
// maybeSingle / update / insert).
function makeStub(state: {
  ingest: any[];
  audits: any[];
  mediaFiles: any[];
}) {
  function table(name: string) {
    if (name === "telegram_ingest") {
      let rows = state.ingest;
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: any) => {
          rows = rows.filter((r) => r[col] === val);
          return builder;
        },
        not: (col: string, _op: string, val: any) => {
          rows = rows.filter((r) => r[col] !== val);
          return builder;
        },
        is: (col: string, val: any) => {
          rows = rows.filter((r) => r[col] === val);
          return builder;
        },
        update: (patch: any) => ({
          eq: (col: string, val: any) => {
            for (const r of state.ingest) if (r[col] === val) Object.assign(r, patch);
            return Promise.resolve({ data: null, error: null });
          },
        }),
        then: (resolve: any) => resolve({ data: rows, error: null }),
      };
      return builder;
    }
    if (name === "media_files") {
      const builder: any = {
        update: (patch: any) => ({
          eq: (col: string, val: any) => {
            for (const f of state.mediaFiles) if (f[col] === val) Object.assign(f, patch);
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
      return builder;
    }
    if (name === "match_audit_log") {
      let rows = state.audits;
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: any) => { rows = rows.filter((r) => r[col] === val); return builder; },
        in: (col: string, vals: any[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder; },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        insert: (row: any) => {
          state.audits.push({ ...row, attempt_at: new Date().toISOString() });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    }
    throw new Error(`unknown table ${name}`);
  }
  return { from: table };
}

describe("revalidatePromotedForTitle — score drop reclassifies file", () => {
  it("demotes a previously promoted file when its score falls below threshold", async () => {
    const title = { id: "title-1", title: "The Bear", release_year: 2022, category: "series" };

    const state = {
      ingest: [
        {
          id: "ingest-1",
          parsed_title: "Totally Unrelated Movie", // poor similarity to "The Bear"
          parsed_year: null,
          parsed_category: null,
          parsed_season: 1,
          parsed_episode: 1,
          promoted_media_file_id: "mf-1",
          matched_title_id: "title-1",
          deleted_at: null,
          match_status: "promoted",
        },
      ],
      audits: [
        {
          telegram_ingest_id: "ingest-1",
          master_title_id: "title-1",
          decision: "promoted",
          scores: { total: 0.91 },
          attempt_at: "2025-01-01T00:00:00Z",
        },
      ],
      mediaFiles: [{ id: "mf-1", is_active: true }],
    };

    const supabase = makeStub(state);
    const settings = { ...DEFAULT_MATCHING_SETTINGS, threshold: 0.6 };

    const result = await revalidatePromotedForTitle(supabase as any, title, settings);

    expect(result.revalidated).toBe(1);
    expect(result.demoted).toBe(1);
    expect(result.kept).toBe(0);
    expect(result.demotedIngestIds).toEqual(["ingest-1"]);

    // media_files row was soft-deactivated
    expect(state.mediaFiles[0].is_active).toBe(false);
    // ingest pointers were cleared and status flipped back to unmatched
    expect(state.ingest[0].match_status).toBe("unmatched");
    expect(state.ingest[0].matched_title_id).toBeNull();
    expect(state.ingest[0].promoted_media_file_id).toBeNull();

    // A demotion audit row was written with the old score preserved
    const demotionAudit = state.audits.find((a: any) => a.decision === "demoted") as any;
    expect(demotionAudit).toBeTruthy();
    expect(demotionAudit.scores.oldScore).toBe(0.91);
    expect(typeof demotionAudit.scores.newScore).toBe("number");
    expect(demotionAudit.scores.newScore).toBeLessThan(settings.threshold);
    expect(demotionAudit.threshold).toBe(settings.threshold);

  });

  it("keeps a file whose recomputed score still clears the threshold", async () => {
    const title = { id: "title-2", title: "The Bear", release_year: null, category: null };
    const state = {
      ingest: [
        {
          id: "ingest-2",
          parsed_title: "The Bear",
          parsed_year: null,
          parsed_category: null,
          parsed_season: null,
          parsed_episode: null,
          promoted_media_file_id: "mf-2",
          matched_title_id: "title-2",
          deleted_at: null,
          match_status: "promoted",
        },
      ],
      audits: [],
      mediaFiles: [{ id: "mf-2", is_active: true }],
    };
    const supabase = makeStub(state);
    const result = await revalidatePromotedForTitle(
      supabase as any,
      title,
      { ...DEFAULT_MATCHING_SETTINGS, threshold: 0.5 },
    );
    expect(result.kept).toBe(1);
    expect(result.demoted).toBe(0);
    expect(state.mediaFiles[0].is_active).toBe(true);
    expect(state.audits.length).toBe(0);
  });
});
