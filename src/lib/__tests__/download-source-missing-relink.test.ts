import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverWithRetry } from "@/lib/delivery.server";
import { tryRelinkByIngest } from "@/lib/downloads.functions";

vi.mock("@/lib/runtime-settings.server", () => ({
  getSetting: vi.fn(async (key: string) => (key === "TELEGRAM_BOT_TOKEN" ? "test-token" : null)),
}));

type Row = Record<string, any>;

function makeSupabase(state: Record<string, Row[]>) {
  const rowsFor = (table: string) => state[table] ?? [];

  class Builder {
    private filters: Array<(row: Row) => boolean> = [];
    private orderBy: { column: string; ascending: boolean } | null = null;
    private limitBy: number | null = null;

    constructor(private table: string) {}

    select() { return this; }
    eq(column: string, value: any) {
      this.filters.push((row) => row[column] === value);
      return this;
    }
    neq(column: string, value: any) {
      this.filters.push((row) => row[column] !== value);
      return this;
    }
    is(column: string, value: any) {
      this.filters.push((row) => (value === null ? row[column] == null : row[column] === value));
      return this;
    }
    not(column: string, op: string, value: any) {
      if (op === "is" && value === null) this.filters.push((row) => row[column] != null);
      return this;
    }
    order(column: string, opts: { ascending?: boolean } = {}) {
      this.orderBy = { column, ascending: opts.ascending ?? true };
      return this;
    }
    limit(value: number) {
      this.limitBy = value;
      return this;
    }
    private materialize() {
      let out = rowsFor(this.table).filter((row) => this.filters.every((f) => f(row)));
      if (this.orderBy) {
        const { column, ascending } = this.orderBy;
        out = [...out].sort((a, b) => (ascending ? 1 : -1) * ((a[column] ?? 0) - (b[column] ?? 0)));
      }
      if (this.limitBy != null) out = out.slice(0, this.limitBy);
      return out;
    }
    maybeSingle() {
      return Promise.resolve({ data: this.materialize()[0] ?? null, error: null });
    }
    update(patch: Row) {
      const tableRows = rowsFor(this.table);
      return {
        eq: (column: string, value: any) => {
          for (const row of tableRows) if (row[column] === value) Object.assign(row, patch);
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    then(resolve: any) {
      return Promise.resolve({ data: this.materialize(), error: null }).then(resolve);
    }
  }

  return { from: (table: string) => new Builder(table) };
}

describe("source_missing resend self-heal", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("re-links media_files by telegram_file_unique_id after stale source_missing and retries delivery successfully", async () => {
    const calls: Array<{ messageId: number; caption?: string }> = [];
    globalThis.fetch = vi.fn(async (_input: any, init: any) => {
      const body = JSON.parse(init?.body ?? "{}");
      calls.push({ messageId: body.message_id, caption: body.caption });
      if (body.message_id === 101) {
        return new Response(JSON.stringify({ ok: false, description: "Bad Request: message to copy not found" }), { status: 400 });
      }
      if (body.message_id === 202) {
        return new Response(JSON.stringify({ ok: true, result: { message_id: 9090 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, description: "unexpected message" }), { status: 400 });
    }) as any;

    const state = {
      media_files: [
        {
          id: "media-1",
          title_id: "title-1",
          episode_id: "episode-12",
          channel_id: "channel-row",
          telegram_message_id: 101,
          telegram_file_id: "old-file-id",
          telegram_file_unique_id: "same-physical-file",
          file_name: "Old.Name.S01E12.480p.mkv",
          caption: "Old Name S01E12 480p Hindi",
          resolution: "480p",
          language: "Hindi",
          is_active: true,
        },
      ],
      telegram_channels: [{ id: "channel-row", channel_id: -1001234567890 }],
      telegram_ingest: [
        {
          id: "ingest-new",
          channel_id: "channel-row",
          telegram_channel_id: -1001234567890,
          telegram_message_id: 202,
          telegram_file_id: "new-file-id",
          telegram_file_unique_id: "same-physical-file",
          file_name: "Fixed.Name.S01E12.720p.mkv",
          caption: "Fixed Name S01E12 720p Hindi",
          file_size: 720_000_000,
          mime_type: "video/x-matroska",
          duration_seconds: 1500,
          parsed_quality: null,
          parsed_resolution: "720p",
          parsed_language: "Hindi",
          matched_title_id: "different-title-would-not-match-without-unique-id",
          deleted_at: null,
        },
      ],
    };
    const supabase = makeSupabase(state) as any;

    const stale = await deliverWithRetry({ toChatId: 555, fromChatId: -1001234567890, messageId: 101 });
    expect(stale.result).toMatchObject({ ok: false, kind: "not_found" });

    const healed = await tryRelinkByIngest(supabase, {
      mediaFileId: "media-1",
      telegramFileUniqueId: "same-physical-file",
      channelRowId: "channel-row",
      episodeId: "episode-12",
      titleId: "title-1",
      resolution: "480p",
      language: "Hindi",
      currentMessageId: 101,
    });
    expect(healed).toBe(true);
    expect(state.media_files[0]).toMatchObject({
      id: "media-1",
      telegram_message_id: 202,
      telegram_file_id: "new-file-id",
      telegram_file_unique_id: "same-physical-file",
      file_name: "Fixed.Name.S01E12.720p.mkv",
      caption: "Fixed Name S01E12 720p Hindi",
      resolution: "720p",
      language: "Hindi",
      is_active: true,
    });

    const retried = await deliverWithRetry({
      toChatId: 555,
      fromChatId: -1001234567890,
      messageId: state.media_files[0].telegram_message_id,
      caption: `📥 <b>${state.media_files[0].file_name}</b>`,
    });

    expect(retried.result).toEqual({ ok: true, messageId: 9090 });
    expect(state.media_files.filter((row) => row.telegram_file_unique_id === "same-physical-file" && row.is_active)).toHaveLength(1);
    expect(calls.map((call) => call.messageId)).toEqual([101, 202]);
  });
});