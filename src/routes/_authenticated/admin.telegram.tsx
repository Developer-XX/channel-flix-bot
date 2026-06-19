import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { CATEGORIES, type CategorySlug } from "@/lib/categories";
import {
  listTelegramIngest,
  updateIngest,
  promoteIngest,
  ignoreIngest,
  setTelegramWebhook,
  getTelegramWebhookInfo,
  runBackfillNow,
  getBotState,
  searchMasterTitles,
  listTelegramChannels,
  verifyTelegramChannel,
  saveTelegramChannel,
  deleteTelegramChannel,
  setBotAdminIds,
  addTitleAlias,
  rematchUnmatched,
  getMatchingSettings,
  updateMatchingSettings,
  diagnoseIngest,
  rematchOne,
  bulkAssignTitle,
  bulkAddAlias,
  forceRematchAndPublish,
  rebuildWebsiteIndexes,
  deleteIngestRows,
  deleteAllIngest,
  restoreIngestRows,
  resyncChannels,
  reparseIngest,
  reparseChannelFromCaptions,
} from "@/lib/telegram.functions";
import { IngestErrorBanner, PermissionDiagnostic } from "@/components/PermissionDiagnostic";
import { Switch } from "@/components/ui/switch";


export const Route = createFileRoute("/_authenticated/admin/telegram")({
  component: TelegramAdmin,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Error: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type IngestRow = Awaited<ReturnType<typeof listTelegramIngest>>[number];

function TelegramAdmin() {
  const router = useRouter();
  const list = useServerFn(listTelegramIngest);
  const update = useServerFn(updateIngest);
  const promote = useServerFn(promoteIngest);
  const ignore = useServerFn(ignoreIngest);
  const setHook = useServerFn(setTelegramWebhook);
  const getHook = useServerFn(getTelegramWebhookInfo);
  const backfill = useServerFn(runBackfillNow);
  const botState = useServerFn(getBotState);
  const search = useServerFn(searchMasterTitles);
  const addAlias = useServerFn(addTitleAlias);
  const rematch = useServerFn(rematchUnmatched);
  const rematchSingle = useServerFn(rematchOne);
  const diagnose = useServerFn(diagnoseIngest);
  const bulkAssign = useServerFn(bulkAssignTitle);
  const bulkAlias = useServerFn(bulkAddAlias);
  const forcePublish = useServerFn(forceRematchAndPublish);
  const rebuildIdx = useServerFn(rebuildWebsiteIndexes);
  const delRows = useServerFn(deleteIngestRows);
  const delAll = useServerFn(deleteAllIngest);
  const restore = useServerFn(restoreIngestRows);
  const listChannels = useServerFn(listTelegramChannels);
  const reparseOne = useServerFn(reparseIngest);
  const reparseAllCaptions = useServerFn(reparseChannelFromCaptions);

  const [statusFilter, setStatusFilter] =
    useState<"all" | "pending" | "matched" | "unmatched" | "ignored">("unmatched");
  const [trash, setTrash] = useState(false);
  const [filters, setFilters] = useState({
    q: "",
    channelId: "",
    quality: "",
    language: "",
    season: "" as number | "",
    episode: "" as number | "",
    dateFrom: "",
    dateTo: "",
  });
  const STABLE_DEV_URL = "https://project--d54ff009-ac17-477f-85a3-112a949d0888-dev.lovable.app";
  const [baseUrl, setBaseUrl] = useState(STABLE_DEV_URL);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const channelsQ = useQuery({ queryKey: ["tg-channels"], queryFn: () => listChannels() });

  const ingest = useQuery({
    queryKey: ["tg-ingest", statusFilter, trash, filters],
    queryFn: () =>
      list({
        data: {
          status: trash ? "all" : statusFilter,
          trash,
          q: filters.q || undefined,
          channelId: filters.channelId || undefined,
          quality: filters.quality || undefined,
          language: filters.language || undefined,
          season: filters.season === "" ? undefined : Number(filters.season),
          episode: filters.episode === "" ? undefined : Number(filters.episode),
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        },
      }),
  });
  const totalRows = ingest.data?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => (ingest.data ?? []).slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [ingest.data, currentPage, pageSize],
  );
  const pageIds = useMemo(() => pageRows.map((r) => r.id), [pageRows]);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleSelectPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const hook = useQuery({ queryKey: ["tg-webhook-info"], queryFn: () => getHook() });
  const state = useQuery({ queryKey: ["tg-bot-state"], queryFn: () => botState() });


  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Telegram Sync</h1>
        <p className="text-sm text-muted-foreground">
          Posts from configured channels appear here. Review parsed metadata, edit corrections, then promote into the catalog.
        </p>
      </div>

      <section className="rounded-lg border border-border p-4 space-y-3">
        <h2 className="font-semibold">Webhook</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://project--<id>-dev.lovable.app"
            className="max-w-md"
          />
          <Button
            onClick={async () => {
              try {
                const r = await setHook({ data: { baseUrl } });
                toast.success(`Webhook set: ${r.url}`);
                hook.refetch();
              } catch (e: any) {
                toast.error(e?.message ?? "Failed to set webhook");
              }
            }}
          >
            Register webhook
          </Button>
          <Button variant="outline" onClick={() => hook.refetch()}>Refresh info</Button>
        </div>
        <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-64">
          {hook.isLoading ? "Loading..." : JSON.stringify(hook.data ?? hook.error, null, 2)}
        </pre>
        <p className="text-xs text-muted-foreground">
          Telegram cannot reach <code>id-preview--…</code> URLs (auth-bridged).
          Use the stable <code>project--&lt;id&gt;-dev.lovable.app</code> URL above
          (already filled in), and make sure the bot is added as an
          <strong> admin</strong> of every channel you want to ingest from —
          otherwise Telegram does not deliver <code>channel_post</code> updates.
        </p>
      </section>

      <ChannelWizard />


      <section className="rounded-lg border border-border p-4 space-y-3">
        <h2 className="font-semibold">Backfill</h2>
        <div className="text-xs text-muted-foreground">
          {state.data ? (
            <>
              Last run: {state.data.last_run_at ?? "never"} · status: {state.data.last_run_status ?? "—"}
              {state.data.last_run_error ? ` · error: ${state.data.last_run_error}` : ""} · last update_id: {state.data.last_update_id}
            </>
          ) : "Loading..."}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={async () => {
              try {
                const r = await backfill();
                toast.success(`Backfill: processed ${r.processed}, last_update_id=${r.newLastUpdateId}`);
                state.refetch();
                ingest.refetch();
              } catch (e: any) {
                toast.error(e?.message ?? "Backfill failed");
              }
            }}
          >
            Run backfill now
          </Button>
          <Button variant="outline" onClick={() => state.refetch()}>Refresh state</Button>
          <Button
            variant="outline"
            title="Re-parse the most recent ingest rows from their stored captions (caption-priority) and re-run the matcher. Use this after a parser change or to sweep up caption edits that arrived without a webhook event. Runs in batches of 200 with rate limiting so it is safe on large channels."
            onClick={async () => {
              const channelRowId = filters.channelId || undefined;
              const batch = 200;
              let offset = 0;
              let totalScanned = 0, totalChanged = 0, totalPromoted = 0, totalDemoted = 0, totalUnmatched = 0, totalErrors = 0;
              let totalRows = 0;
              try {
                let safety = 50; // hard cap: 50 batches = 10k rows
                while (safety-- > 0) {
                  const r = await reparseAllCaptions({ data: { limit: batch, offset, channelRowId, sleepMs: 25 } });
                  if (!r || typeof r.scanned !== "number") {
                    throw new Error("Server returned no result (request likely failed — check Admin → Error log).");
                  }
                  totalScanned += r.scanned;
                  totalChanged += r.changed;
                  totalPromoted += r.promoted;
                  totalDemoted += r.demoted;
                  totalUnmatched += r.unmatched;
                  totalErrors += r.errors;
                  totalRows = r.totalRows;
                  toast.message(
                    `Re-parsing… ${Math.min(r.nextOffset, r.totalRows)}/${r.totalRows}`,
                    { description: `changed ${totalChanged} · promoted ${totalPromoted} · demoted ${totalDemoted} · unmatched ${totalUnmatched}${totalErrors ? ` · errors ${totalErrors}` : ""}` },
                  );
                  if (!r.hasMore || r.scanned === 0) break;
                  offset = r.nextOffset;
                }
                toast.success(
                  `Re-parsed ${totalScanned}/${totalRows} · changed ${totalChanged} · promoted ${totalPromoted} · demoted ${totalDemoted} · unmatched ${totalUnmatched}${totalErrors ? ` · errors ${totalErrors}` : ""}`,
                );
                ingest.refetch();
                router.invalidate();
              } catch (e: any) {
                toast.error(`Re-parse failed at offset ${offset}: ${e?.message ?? "unknown"}`);
              }
            }}
          >
            Re-parse all from captions
          </Button>

        </div>
        <p className="text-xs text-muted-foreground">
          A scheduled job also runs this endpoint periodically to catch posts missed by the webhook.
        </p>
      </section>

      <MatchingSettingsPanel />

      <section className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={!trash ? "default" : "outline"}
            size="sm"
            onClick={() => { setTrash(false); setSelected(new Set()); setPage(1); }}
          >Files</Button>
          <Button
            variant={trash ? "default" : "outline"}
            size="sm"
            onClick={() => { setTrash(true); setSelected(new Set()); setPage(1); }}
          >🗑 Trash (24h)</Button>
          <span className="mx-1 h-5 w-px bg-border" />
          {(["all", "pending", "matched", "unmatched", "ignored"] as const).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s && !trash ? "default" : "outline"}
              size="sm"
              disabled={trash}
              onClick={() => { setStatusFilter(s); setSelected(new Set()); setPage(1); }}
            >
              {s}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => ingest.refetch()}>Refresh</Button>
          {!trash && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    const r = await rematch();
                    toast.success(`Reindex: promoted ${r.promoted}/${r.scanned}, still unmatched ${r.stillUnmatched}`);
                    ingest.refetch();
                    router.invalidate();
                  } catch (e: any) {
                    toast.error(e?.message ?? "Reindex failed");
                  }
                }}
              >
                Reindex / Refresh website
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    const r = await rebuildIdx();
                    toast.success(`Rebuilt indexes · ${r.latest ?? 0} latest · ${r.trending ?? 0} trending · ${r.search ?? 0} search`);
                    router.invalidate();
                  } catch (e: any) {
                    toast.error(e?.message ?? "Rebuild failed");
                  }
                }}
              >
                Rebuild website indexes
              </Button>
            </>
          )}
          {trash && selected.size > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  const r = await restore({ data: { ingestIds: Array.from(selected) } });
                  toast.success(`Restored ${r.restored} · skipped ${r.skipped}`);
                  setSelected(new Set());
                  ingest.refetch();
                  router.invalidate();
                } catch (e: any) {
                  toast.error(e?.message ?? "Restore failed");
                }
              }}
            >
              Restore selected
            </Button>
          )}
        </div>

        {/* Filter bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-md border border-border p-3 bg-surface/40">
          <Input
            placeholder="Search file name / title / caption"
            value={filters.q}
            onChange={(e) => { setFilters((f) => ({ ...f, q: e.target.value })); setPage(1); }}
            className="md:col-span-2"
          />
          <Select
            value={filters.channelId || "__all"}
            onValueChange={(v) => { setFilters((f) => ({ ...f, channelId: v === "__all" ? "" : v })); setPage(1); }}
          >
            <SelectTrigger><SelectValue placeholder="Channel" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All channels</SelectItem>
              {(channelsQ.data ?? []).map((c: any) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Quality (e.g. 1080p)"
            value={filters.quality}
            onChange={(e) => { setFilters((f) => ({ ...f, quality: e.target.value })); setPage(1); }}
          />
          <Input
            placeholder="Language"
            value={filters.language}
            onChange={(e) => { setFilters((f) => ({ ...f, language: e.target.value })); setPage(1); }}
          />
          <Input
            type="number" min={0} placeholder="Season"
            value={filters.season}
            onChange={(e) => { setFilters((f) => ({ ...f, season: e.target.value === "" ? "" : Number(e.target.value) })); setPage(1); }}
          />
          <Input
            type="number" min={0} placeholder="Episode"
            value={filters.episode}
            onChange={(e) => { setFilters((f) => ({ ...f, episode: e.target.value === "" ? "" : Number(e.target.value) })); setPage(1); }}
          />
          <Input
            type="date" value={filters.dateFrom}
            onChange={(e) => { setFilters((f) => ({ ...f, dateFrom: e.target.value })); setPage(1); }}
          />
          <Input
            type="date" value={filters.dateTo}
            onChange={(e) => { setFilters((f) => ({ ...f, dateTo: e.target.value })); setPage(1); }}
          />
          <div className="md:col-span-4 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => { setFilters({ q: "", channelId: "", quality: "", language: "", season: "", episode: "", dateFrom: "", dateTo: "" }); setPage(1); }}>
              Reset filters
            </Button>
          </div>
        </div>


        {selected.size > 0 && (
          <BulkActionBar
            count={selected.size}
            ingestIds={Array.from(selected)}
            search={search}
            onClear={() => setSelected(new Set())}
            onAssign={async (titleId) => {
              const r = await bulkAssign({ data: { ingestIds: Array.from(selected), titleId, promote: true } });
              toast.success(`Assigned ${r.assigned} · promoted ${r.promoted}`);
              setSelected(new Set());
              ingest.refetch();
              router.invalidate();
            }}
            onAddAlias={async (titleId) => {
              const r = await bulkAlias({ data: { ingestIds: Array.from(selected), titleId } });
              const re = await rematch({ data: { ingestIds: Array.from(selected) } });
              toast.success(`Added ${r.added} alias(es) · promoted ${re.promoted}`);
              setSelected(new Set());
              ingest.refetch();
              router.invalidate();
            }}
            onPromoteSelected={async () => {
              const r = await rematch({ data: { ingestIds: Array.from(selected) } });
              toast.success(`Promoted ${r.promoted}/${r.scanned}`);
              setSelected(new Set());
              ingest.refetch();
              router.invalidate();
            }}
            onDeleteSelected={async () => {
              const ids = Array.from(selected);
              if (!confirm(`Permanently delete ${ids.length} file(s) and any media they promoted?`)) return;
              try {
                const r = await delRows({ data: { ingestIds: ids } });
                toast.success(`Deleted ${r.deletedIngest} ingest · ${r.deletedMedia} media`);
                setSelected(new Set());
                ingest.refetch();
                router.invalidate();
              } catch (e: any) {
                toast.error(e?.message ?? "Delete failed");
              }
            }}
          />
        )}

        {/* Pagination + bulk toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="Select all on this page"
              checked={allOnPageSelected}
              onChange={toggleSelectPage}
            />
            <span className="text-muted-foreground">
              {totalRows} total · page {currentPage}/{totalPages}
            </span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="h-8 w-[90px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}/page</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</Button>
            <Button size="sm" variant="outline" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={async () => {
                const phrase = prompt('Type "DELETE ALL FILES" to wipe every ingest row and media file.');
                if (phrase !== "DELETE ALL FILES") {
                  toast.message("Cancelled — phrase did not match.");
                  return;
                }
                try {
                  const r = await delAll({ data: { confirm: "DELETE ALL FILES" } });
                  toast.success(`Wiped ${r.deletedIngest} ingest · ${r.deletedMedia} media`);
                  setSelected(new Set());
                  ingest.refetch();
                  router.invalidate();
                } catch (e: any) {
                  toast.error(e?.message ?? "Delete-all failed");
                }
              }}
            >
              Delete ALL files
            </Button>
          </div>
        </div>

        {ingest.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {ingest.error && (
          <IngestErrorBanner
            error={ingest.error as Error}
            onRetry={() => ingest.refetch()}
          />
        )}

        <div className="space-y-2">
          {pageRows.map((row) => (
            <IngestCard
              key={row.id}
              row={row}
              expanded={expanded === row.id}
              selected={selected.has(row.id)}
              onSelectToggle={() => toggleSel(row.id)}
              onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
              onUpdate={async (patch) => {
                await update({ data: { ingestId: row.id, ...patch } });
                ingest.refetch();
              }}
              onRematch={async () => {
                const r = await rematchSingle({ data: { ingestId: row.id, autoPromote: true } });
                if (r.match.matchedTitleId) toast.success(`Matched · score ${r.match.matchScore?.toFixed(2)}${r.promoted ? " · promoted" : ""}`);
                else toast.message(`No match · best score ${(r.match.matchScore ?? 0).toFixed(2)}`);
                ingest.refetch();
                router.invalidate();
              }}
              onReparse={async () => {
                try {
                  const r = await reparseOne({ data: { ingestId: row.id, autoPromote: true } });
                  const bits = [
                    `title="${r.parsed.title}"`,
                    r.parsed.season != null ? `S${String(r.parsed.season).padStart(2,"0")}${r.parsed.episode != null ? `E${String(r.parsed.episode).padStart(2,"0")}` : ""}` : null,
                  ].filter(Boolean).join(" · ");
                  if (r.match.matchedTitleId) toast.success(`Re-parsed · ${bits}${r.promoted ? " · promoted" : ""}${r.demoted ? " · demoted old" : ""}`);
                  else toast.message(`Re-parsed · ${bits} · no match`);
                  ingest.refetch();
                  router.invalidate();
                } catch (e: any) { toast.error(e?.message ?? "Re-parse failed"); }
              }}
              onDiagnose={() => diagnose({ data: { ingestId: row.id } })}
              onForcePublish={async (assignTitleId) => {
                try {
                  const r = await forcePublish({ data: { ingestId: row.id, assignTitleId } });
                  if (r.promoted) toast.success(`✅ Force published · ${r.reason}`);
                  else toast.error(`Not published · ${r.reason}`);
                  ingest.refetch();
                  router.invalidate();
                } catch (e: any) { toast.error(e?.message ?? "Force publish failed"); }
              }}
              onPromote={async (titleId, overrides) => {
                await promote({ data: { ingestId: row.id, titleId, overrides } });
                toast.success("Promoted to media_files");
                router.invalidate();
                ingest.refetch();
              }}
              onSaveAliasAndPromote={async (titleId, alias) => {
                await addAlias({ data: { titleId, alias } });
                const r = await rematch();
                toast.success(`Saved alias · promoted ${r.promoted}`);
                router.invalidate();
                ingest.refetch();
              }}
              onIgnore={async () => {
                await ignore({ data: { ingestId: row.id } });
                ingest.refetch();
              }}
              search={search}
            />
          ))}
          {ingest.data && ingest.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No ingest rows for this filter.</p>
          )}
        </div>
      </section>
    </div>
  );

}

function IngestCard({
  row, expanded, selected, onSelectToggle, onToggle, onUpdate, onPromote,
  onSaveAliasAndPromote, onIgnore, onRematch, onReparse, onDiagnose, onForcePublish, search,
}: {
  row: IngestRow;
  expanded: boolean;
  selected: boolean;
  onSelectToggle: () => void;
  onToggle: () => void;
  onUpdate: (patch: Record<string, any>) => Promise<void>;
  onPromote: (titleId: string, overrides?: any) => Promise<void>;
  onSaveAliasAndPromote: (titleId: string, alias: string) => Promise<void>;
  onIgnore: () => Promise<void>;
  onRematch: () => Promise<void>;
  onReparse: () => Promise<void>;
  onDiagnose: () => Promise<any>;
  onForcePublish: (assignTitleId?: string) => Promise<void>;
  search: (args: { data: { q: string } }) => Promise<Array<{ id: string; title: string; release_year: number | null; category: string }>>;
}) {
  const [diag, setDiag] = useState<any>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const [draft, setDraft] = useState({
    parsed_title: row.parsed_title ?? "",
    parsed_year: row.parsed_year ?? ("" as number | ""),
    parsed_season: row.parsed_season ?? ("" as number | ""),
    parsed_episode: row.parsed_episode ?? ("" as number | ""),
    parsed_resolution: row.parsed_resolution ?? "",
    parsed_quality: row.parsed_quality ?? "",
    parsed_codec: row.parsed_codec ?? "",
    parsed_language: row.parsed_language ?? "",
    parsed_category: (row.parsed_category as CategorySlug | null) ?? null,
  });
  const [searchQ, setSearchQ] = useState(row.parsed_title ?? "");
  const [results, setResults] = useState<Array<{ id: string; title: string; release_year: number | null; category: string }>>([]);
  const [selectedTitleId, setSelectedTitleId] = useState<string | null>(row.matched_title_id);

  const dirty = useMemo(() => {
    return (
      draft.parsed_title !== (row.parsed_title ?? "") ||
      String(draft.parsed_year) !== String(row.parsed_year ?? "") ||
      String(draft.parsed_season) !== String(row.parsed_season ?? "") ||
      String(draft.parsed_episode) !== String(row.parsed_episode ?? "") ||
      draft.parsed_resolution !== (row.parsed_resolution ?? "") ||
      draft.parsed_quality !== (row.parsed_quality ?? "") ||
      draft.parsed_codec !== (row.parsed_codec ?? "") ||
      draft.parsed_language !== (row.parsed_language ?? "") ||
      draft.parsed_category !== ((row.parsed_category as CategorySlug | null) ?? null)
    );
  }, [draft, row]);

  return (
    <div className={`rounded-lg border p-3 text-sm ${selected ? "border-primary bg-primary/5" : "border-border"}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1.5 h-4 w-4 accent-primary"
          checked={selected}
          onChange={onSelectToggle}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select row"
        />
        <div className="flex items-start justify-between gap-3 flex-1 min-w-0">

        <button onClick={onToggle} className="text-left min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{row.parsed_title ?? row.file_name ?? "(no title)"}</span>
            <Badge variant="secondary">{row.match_status}</Badge>
            {row.parsed_category && <Badge>{row.parsed_category}</Badge>}
            {row.parsed_year && <Badge variant="outline">{row.parsed_year}</Badge>}
            {row.parsed_season != null && (
              <Badge variant="outline">
                S{String(row.parsed_season).padStart(2, "0")}
                {row.parsed_episode != null ? `E${String(row.parsed_episode).padStart(2, "0")}` : ""}
              </Badge>
            )}
            {row.parsed_resolution && <Badge variant="outline">{row.parsed_resolution}</Badge>}
            {row.parsed_quality && <Badge variant="outline">{row.parsed_quality}</Badge>}
            {row.parsed_codec && <Badge variant="outline">{row.parsed_codec}</Badge>}
            {row.parsed_language && <Badge variant="outline">{row.parsed_language}</Badge>}
            {row.match_score != null && (
              <span className="text-xs text-muted-foreground">score {Number(row.match_score).toFixed(2)}</span>
            )}
          </div>
          {row.caption && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{row.caption}</p>}
          <p className="text-xs text-muted-foreground mt-1">
            ch {row.telegram_channel_id} · msg {row.telegram_message_id}
            {row.file_size ? ` · ${(row.file_size / 1024 / 1024).toFixed(1)} MB` : ""}
            {row.promoted_media_file_id ? " · promoted" : ""}
          </p>
          {(row as any).deleted_at && <TrashCountdown deletedAt={(row as any).deleted_at} />}
        </button>
        <Button size="sm" variant="ghost" onClick={onToggle}>{expanded ? "Close" : "Review"}</Button>
        </div>
      </div>


      {expanded && (
        <div className="mt-4 grid gap-3 border-t border-border pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Title">
              <Input value={draft.parsed_title} onChange={(e) => setDraft({ ...draft, parsed_title: e.target.value })} />
            </Field>
            <Field label="Year">
              <Input
                inputMode="numeric"
                value={String(draft.parsed_year ?? "")}
                onChange={(e) => setDraft({ ...draft, parsed_year: e.target.value ? Number(e.target.value) : "" })}
              />
            </Field>
            <Field label="Season">
              <Input
                inputMode="numeric"
                value={String(draft.parsed_season ?? "")}
                onChange={(e) => setDraft({ ...draft, parsed_season: e.target.value ? Number(e.target.value) : "" })}
              />
            </Field>
            <Field label="Episode">
              <Input
                inputMode="numeric"
                value={String(draft.parsed_episode ?? "")}
                onChange={(e) => setDraft({ ...draft, parsed_episode: e.target.value ? Number(e.target.value) : "" })}
              />
            </Field>
            <Field label="Resolution">
              <Input value={draft.parsed_resolution ?? ""} onChange={(e) => setDraft({ ...draft, parsed_resolution: e.target.value })} />
            </Field>
            <Field label="Quality">
              <Input value={draft.parsed_quality ?? ""} onChange={(e) => setDraft({ ...draft, parsed_quality: e.target.value })} />
            </Field>
            <Field label="Codec">
              <Input value={draft.parsed_codec ?? ""} onChange={(e) => setDraft({ ...draft, parsed_codec: e.target.value })} />
            </Field>
            <Field label="Language">
              <Input value={draft.parsed_language ?? ""} onChange={(e) => setDraft({ ...draft, parsed_language: e.target.value })} />
            </Field>
            <Field label="Category">
              <Select
                value={draft.parsed_category ?? "none"}
                onValueChange={(v) => setDraft({ ...draft, parsed_category: v === "none" ? null : (v as CategorySlug) })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {CATEGORIES.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!dirty}
              onClick={async () => {
                try {
                  await onUpdate({
                    parsed_title: draft.parsed_title,
                    parsed_year: draft.parsed_year === "" ? null : Number(draft.parsed_year),
                    parsed_season: draft.parsed_season === "" ? null : Number(draft.parsed_season),
                    parsed_episode: draft.parsed_episode === "" ? null : Number(draft.parsed_episode),
                    parsed_resolution: draft.parsed_resolution || null,
                    parsed_quality: draft.parsed_quality || null,
                    parsed_codec: draft.parsed_codec || null,
                    parsed_language: draft.parsed_language || null,
                    parsed_category: draft.parsed_category,
                  });
                  toast.success("Saved corrections");
                } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
              }}
            >
              Save corrections
            </Button>
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <Label className="text-xs uppercase text-muted-foreground">Link to master title</Label>
            <div className="flex gap-2">
              <Input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search master titles…"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const r = await search({ data: { q: searchQ } });
                    setResults(r);
                  } catch (e: any) { toast.error(e?.message ?? "Search failed"); }
                }}
              >
                Search
              </Button>
            </div>
            {results.length > 0 && (
              <div className="max-h-48 overflow-auto space-y-1">
                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedTitleId(r.id)}
                    className={`w-full text-left text-xs px-2 py-1 rounded border ${selectedTitleId === r.id ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    {r.title}{r.release_year ? ` (${r.release_year})` : ""} · {r.category}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                disabled={!selectedTitleId}
                onClick={async () => {
                  if (!selectedTitleId) return;
                  try {
                    await onPromote(selectedTitleId, {
                      quality: draft.parsed_quality || null,
                      resolution: draft.parsed_resolution || null,
                      language: draft.parsed_language || null,
                    });
                  } catch (e: any) { toast.error(e?.message ?? "Promote failed"); }
                }}
              >
                Promote to media_files
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!selectedTitleId || !draft.parsed_title}
                title="Save this parsed title as an alias for the selected master title, then auto-promote every matching unmatched file"
                onClick={async () => {
                  if (!selectedTitleId) return;
                  try {
                    await onSaveAliasAndPromote(selectedTitleId, draft.parsed_title);
                  } catch (e: any) { toast.error(e?.message ?? "Save alias failed"); }
                }}
              >
                Save as alias + auto-promote all
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try { await onIgnore(); toast.success("Ignored"); }
                  catch (e: any) { toast.error(e?.message ?? "Failed"); }
                }}
              >
                Ignore
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try { await onRematch(); } catch (e: any) { toast.error(e?.message ?? "Rematch failed"); }
                }}
              >
                Rematch now
              </Button>
              <Button
                size="sm"
                variant="outline"
                title="Re-parse this row from its stored caption (caption-priority), then re-run the matcher. Demotes the old promotion if the title changes or no longer matches."
                onClick={onReparse}
              >
                Re-parse caption
              </Button>
              <Button
                size="sm"
                variant="default"
                title="Re-run the matcher for just this file, write an audit row, promote on success, and bump the website cache version."
                onClick={async () => {
                  await onForcePublish(selectedTitleId ?? undefined);
                }}
              >
                Force rematch &amp; publish
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  setDiagLoading(true);
                  try { setDiag(await onDiagnose()); }
                  catch (e: any) { toast.error(e?.message ?? "Diagnose failed"); }
                  finally { setDiagLoading(false); }
                }}
              >
                {diagLoading ? "Diagnosing…" : "Diagnose"}
              </Button>
            </div>
          </div>

          {diag && (
            <div className="border-t border-border pt-3 space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">Diagnostics</Label>
              <div className="text-xs text-muted-foreground">
                Threshold: <code>{diag.threshold}</code> · Best score: <code>{(diag.matchScore ?? 0).toFixed(3)}</code>
                {diag.matchedVia ? <> · Matched via <Badge variant="secondary">{diag.matchedVia}</Badge></> : <> · <span className="text-amber-500">no match (below threshold)</span></>}
              </div>
              <div className="text-xs">
                Parsed: <code>"{diag.parsed.parsed_title}"</code>
                {diag.parsed.parsed_year ? ` · year ${diag.parsed.parsed_year}` : ""}
                {diag.parsed.parsed_season != null ? ` · S${String(diag.parsed.parsed_season).padStart(2,"0")}${diag.parsed.parsed_episode != null ? `E${String(diag.parsed.parsed_episode).padStart(2,"0")}` : ""}` : ""}
                {diag.parsed.parsed_category ? ` · ${diag.parsed.parsed_category}` : ""}
              </div>

              {/* Caption-priority breakdown: shows what each raw source parses to
                  independently so admins can confirm caption wins, or which
                  source fed each field as a fallback. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 rounded-md border border-border/60 p-2 bg-surface/30">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                    Caption parse
                    {diag.titleSource === "caption" && <Badge variant="default" className="h-4 px-1 text-[10px]">title source</Badge>}
                  </div>
                  <div className="text-xs font-mono break-all text-muted-foreground line-clamp-2" title={diag.captionRaw}>
                    {diag.captionRaw ? `"${diag.captionRaw}"` : "— no caption —"}
                  </div>
                  {diag.captionParsed ? (
                    <div className="text-xs mt-1">
                      → <code>"{diag.captionParsed.title}"</code>
                      {diag.captionParsed.year ? ` · ${diag.captionParsed.year}` : ""}
                      {diag.captionParsed.season != null ? ` · S${String(diag.captionParsed.season).padStart(2,"0")}${diag.captionParsed.episode != null ? `E${String(diag.captionParsed.episode).padStart(2,"0")}` : ""}` : ""}
                      {diag.captionParsed.resolution ? ` · ${diag.captionParsed.resolution}` : ""}
                      {diag.captionParsed.language ? ` · ${diag.captionParsed.language}` : ""}
                    </div>
                  ) : <div className="text-xs text-muted-foreground mt-1">— skipped —</div>}
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                    Filename parse
                    {diag.titleSource === "filename" && <Badge variant="default" className="h-4 px-1 text-[10px]">title source (fallback)</Badge>}
                  </div>
                  <div className="text-xs font-mono break-all text-muted-foreground line-clamp-2" title={diag.filenameRaw}>
                    {diag.filenameRaw ? `"${diag.filenameRaw}"` : "— no filename —"}
                  </div>
                  {diag.filenameParsed ? (
                    <div className="text-xs mt-1">
                      → <code>"{diag.filenameParsed.title}"</code>
                      {diag.filenameParsed.year ? ` · ${diag.filenameParsed.year}` : ""}
                      {diag.filenameParsed.season != null ? ` · S${String(diag.filenameParsed.season).padStart(2,"0")}${diag.filenameParsed.episode != null ? `E${String(diag.filenameParsed.episode).padStart(2,"0")}` : ""}` : ""}
                      {diag.filenameParsed.resolution ? ` · ${diag.filenameParsed.resolution}` : ""}
                      {diag.filenameParsed.language ? ` · ${diag.filenameParsed.language}` : ""}
                    </div>
                  ) : <div className="text-xs text-muted-foreground mt-1">— skipped —</div>}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase text-muted-foreground mt-2">Alias hits ({diag.aliasHits.length})</div>
                {diag.aliasHits.length === 0 && <div className="text-xs text-muted-foreground">— no aliases matched —</div>}
                {diag.aliasHits.map((a: any, i: number) => (
                  <div key={i} className="text-xs font-mono">
                    {a.exact ? "✓ exact" : "≈ contained"} · "{a.alias}" → {a.titleId.slice(0, 8)}…
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mt-2">Top fuzzy candidates ({diag.candidates.length})</div>
                {diag.candidates.length === 0 && <div className="text-xs text-muted-foreground">— no candidates found (head token did not match any master title) —</div>}
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th className="text-left">Title</th><th>Adj</th><th>Jacc</th><th>Cont</th><th>Sub</th><th>Year</th><th>Cat</th><th></th></tr>
                  </thead>
                  <tbody>
                    {diag.candidates.map((c: any) => (
                      <tr key={c.titleId} className="border-t border-border/50">
                        <td className="py-1">{c.title} {c.release_year ? `(${c.release_year})` : ""}</td>
                        <td className="text-center font-semibold">{c.adjustedScore.toFixed(2)}</td>
                        <td className="text-center">{c.parts.jaccard.toFixed(2)}</td>
                        <td className="text-center">{c.parts.containment.toFixed(2)}</td>
                        <td className="text-center">{c.parts.substring.toFixed(2)}</td>
                        <td className="text-center">{c.yearOk ? "✓" : "✗"}</td>
                        <td className="text-center">{c.categoryOk ? "✓" : "✗"}</td>
                        <td>
                          <Button size="sm" variant="ghost" onClick={() => onPromote(c.titleId)}>Use</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ChannelWizard() {
  const list = useServerFn(listTelegramChannels);
  const verify = useServerFn(verifyTelegramChannel);
  const save = useServerFn(saveTelegramChannel);
  const del = useServerFn(deleteTelegramChannel);
  const setAdmins = useServerFn(setBotAdminIds);
  const state = useServerFn(getBotState);

  const channels = useQuery({ queryKey: ["tg-channels"], queryFn: () => list() });
  const botState = useQuery({ queryKey: ["tg-bot-state-wizard"], queryFn: () => state() });
  const resync = useServerFn(resyncChannels);

  const [ref, setRef] = useState("");
  const [check, setCheck] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [adminIds, setAdminIds] = useState("");
  const [pickedChannels, setPickedChannels] = useState<Set<string>>(new Set());
  const [resyncing, setResyncing] = useState(false);
  const togglePick = (id: string) => setPickedChannels((prev) => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  return (
    <section className="rounded-lg border border-border p-4 space-y-4">
      <div>
        <h2 className="font-semibold">Channel wizard</h2>
        <p className="text-xs text-muted-foreground">
          Verify the bot has admin rights on a channel, then save it so posts get ingested.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="@channel_username or -100123456789"
          className="max-w-md"
        />
        <Button
          disabled={busy || !ref.trim()}
          onClick={async () => {
            setBusy(true); setCheck(null);
            try {
              const r = await verify({ data: { ref: ref.trim() } });
              setCheck(r);
              if (!r.ok) toast.error(r.error);
            } catch (e: any) { toast.error(e?.message ?? "Verify failed"); }
            finally { setBusy(false); }
          }}
        >
          Verify
        </Button>
      </div>

      {check && check.ok && (
        <div className="rounded-md border border-border p-3 text-sm space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{check.chat.type}</Badge>
            <span className="font-medium">{check.chat.title ?? check.chat.username ?? check.chat.id}</span>
            <span className="text-xs text-muted-foreground font-mono">{check.chat.id}</span>
          </div>
          <div className="text-xs">
            Bot: <code>@{check.bot.username}</code> · Member status: <code>{check.memberStatus}</code>
          </div>
          {check.isAdmin ? (
            <div className="text-emerald-500 text-sm">✓ Bot is an administrator — channel posts will be received.</div>
          ) : (
            <div className="text-amber-500 text-sm">
              ⚠ Bot is <b>not</b> an administrator of this channel. Open the channel in Telegram → Manage → Administrators → Add @{check.bot.username}, then re-verify.
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              disabled={!check.isAdmin}
              onClick={async () => {
                try {
                  await save({ data: {
                    channel_id: check.chat.id,
                    name: check.chat.title ?? check.chat.username ?? String(check.chat.id),
                    username: check.chat.username,
                    description: check.chat.description,
                    is_active: true,
                  }});
                  toast.success("Channel saved");
                  setCheck(null); setRef("");
                  channels.refetch();
                } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
              }}
            >
              Save channel
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCheck(null)}>Cancel</Button>
          </div>
          <div className="text-xs text-muted-foreground pt-2 border-t border-border">
            <b>Next:</b> post a file in this channel with a clear caption like
            <code className="mx-1">Demon Slayer S01E02 1080p WEB-DL Hindi+English</code>.
            The bot will react 👀 and the row will appear in the list below.
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs uppercase text-muted-foreground">Connected channels</div>
          <Button
            size="sm"
            variant="secondary"
            disabled={resyncing || pickedChannels.size === 0}
            onClick={async () => {
              setResyncing(true);
              try {
                const r = await resync({ data: { channelIds: Array.from(pickedChannels) } });
                toast.success(`Resynced ${pickedChannels.size} channel(s) · scanned ${r.scanned} · backfilled ${r.backfillProcessed} · metadata updated ${r.metadataUpdated}`);
                setPickedChannels(new Set());
                channels.refetch();
              } catch (e: any) {
                toast.error(e?.message ?? "Resync failed");
              } finally { setResyncing(false); }
            }}
          >
            {resyncing ? "Resyncing…" : `Resync selected (${pickedChannels.size})`}
          </Button>
        </div>
        {channels.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {(channels.data ?? []).length === 0 && !channels.isLoading && (
          <div className="text-sm text-muted-foreground">No channels yet.</div>
        )}
        {(channels.data ?? []).map((c: any) => (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <input
                type="checkbox"
                checked={pickedChannels.has(c.id)}
                onChange={() => togglePick(c.id)}
                aria-label={`Select ${c.name}`}
              />
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {c.is_active ? "🟢" : "⚪"} {c.name} {c.username ? <span className="text-muted-foreground">@{c.username}</span> : null}
                </div>
                <div className="text-xs text-muted-foreground font-mono">{c.channel_id}</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await save({ data: {
                      channel_id: c.channel_id, name: c.name, username: c.username,
                      description: c.description, is_active: c.is_active,
                      confirm_with_reply: !c.confirm_with_reply,
                    }});
                    channels.refetch();
                  } catch (e: any) { toast.error(e?.message ?? "Failed"); }
                }}
              >
                Reply: {c.confirm_with_reply ? "on" : "off"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (!confirm(`Remove ${c.name}?`)) return;
                  try { await del({ data: { id: c.id } }); channels.refetch(); }
                  catch (e: any) { toast.error(e?.message ?? "Failed"); }
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border pt-3 space-y-2">
        <div className="text-xs uppercase text-muted-foreground">DM /broadcast admin user IDs</div>
        <div className="text-xs text-muted-foreground">
          Telegram user IDs allowed to run <code>/broadcast</code> in DM. Use <code>/id</code> in DM to get yours.
          Current: {(botState.data?.admin_telegram_user_ids ?? []).join(", ") || "none"}
        </div>
        <div className="flex gap-2">
          <Input
            value={adminIds}
            onChange={(e) => setAdminIds(e.target.value)}
            placeholder="123456789, 987654321"
            className="max-w-md"
          />
          <Button
            onClick={async () => {
              const ids = adminIds.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
              try {
                await setAdmins({ data: { ids } });
                toast.success(`Saved ${ids.length} admin id(s)`);
                botState.refetch();
                setAdminIds("");
              } catch (e: any) { toast.error(e?.message ?? "Failed"); }
            }}
          >
            Save admins
          </Button>
        </div>
      </div>
    </section>
  );
}

function MatchingSettingsPanel() {
  const get = useServerFn(getMatchingSettings);
  const upd = useServerFn(updateMatchingSettings);
  const q = useQuery({ queryKey: ["tg-matching-settings"], queryFn: () => get() });
  const [draft, setDraft] = useState<any>(null);
  const s = draft ?? q.data;

  return (
    <section className="rounded-lg border border-border p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Matching rules</h2>
        <p className="text-xs text-muted-foreground">Tune when an ingested file maps to a master title.</p>
      </div>
      {!s ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs">Match threshold: <code>{Number(s.threshold).toFixed(2)}</code></Label>
            <input type="range" min={0} max={1} step={0.05} value={s.threshold}
              onChange={(e) => setDraft({ ...s, threshold: Number(e.target.value) })}
              className="w-full" />
            <p className="text-[11px] text-muted-foreground">Lower = more aggressive. Higher = stricter.</p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Year window: ±<code>{s.year_window}</code></Label>
            <Input type="number" min={0} max={10} value={s.year_window}
              onChange={(e) => setDraft({ ...s, year_window: Number(e.target.value) })} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-2">
            <Label className="text-sm">Use aliases</Label>
            <Switch checked={s.use_aliases} onCheckedChange={(v) => setDraft({ ...s, use_aliases: v })} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-2">
            <Label className="text-sm">Jaccard token overlap</Label>
            <Switch checked={s.use_jaccard} onCheckedChange={(v) => setDraft({ ...s, use_jaccard: v })} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-2">
            <Label className="text-sm">Containment scoring</Label>
            <Switch checked={s.use_containment} onCheckedChange={(v) => setDraft({ ...s, use_containment: v })} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-2">
            <Label className="text-sm">Substring boost</Label>
            <Switch checked={s.use_substring} onCheckedChange={(v) => setDraft({ ...s, use_substring: v })} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-2 md:col-span-2">
            <Label className="text-sm">Require category to match</Label>
            <Switch checked={s.require_category_match} onCheckedChange={(v) => setDraft({ ...s, require_category_match: v })} />
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!draft}
          onClick={async () => {
            try { await upd({ data: draft }); toast.success("Saved"); setDraft(null); q.refetch(); }
            catch (e: any) { toast.error(e?.message ?? "Save failed"); }
          }}
        >Save rules</Button>
        <Button size="sm" variant="ghost" disabled={!draft} onClick={() => setDraft(null)}>Reset</Button>
      </div>
    </section>
  );
}

function BulkActionBar({
  count, ingestIds, search, onClear, onAssign, onAddAlias, onPromoteSelected, onDeleteSelected,
}: {
  count: number;
  ingestIds: string[];
  search: (args: { data: { q: string } }) => Promise<Array<{ id: string; title: string; release_year: number | null; category: string }>>;
  onClear: () => void;
  onAssign: (titleId: string) => Promise<void>;
  onAddAlias: (titleId: string) => Promise<void>;
  onPromoteSelected: () => Promise<void>;
  onDeleteSelected: () => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; title: string; release_year: number | null; category: string }>>([]);
  const [pick, setPick] = useState<string | null>(null);
  return (
    <div className="sticky top-2 z-10 rounded-lg border border-primary bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-medium">{count} selected ({ingestIds.length} ids)</div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="secondary" onClick={onPromoteSelected}>Rematch & promote selected</Button>
          <Button size="sm" variant="destructive" onClick={onDeleteSelected}>Delete selected</Button>
          <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
        </div>
      </div>
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search master title to assign…" />
        <Button size="sm" variant="outline" onClick={async () => setResults(await search({ data: { q } }))}>Search</Button>
      </div>
      {results.length > 0 && (
        <div className="max-h-32 overflow-auto space-y-1">
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => setPick(r.id)}
              className={`w-full text-left text-xs px-2 py-1 rounded border ${pick === r.id ? "border-primary bg-primary/10" : "border-border"}`}
            >
              {r.title}{r.release_year ? ` (${r.release_year})` : ""} · {r.category}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={!pick} onClick={() => pick && onAssign(pick)}>Assign master title (+ promote)</Button>
        <Button size="sm" variant="outline" disabled={!pick} onClick={() => pick && onAddAlias(pick)}>Add as alias (+ rematch)</Button>
      </div>
    </div>
  );
}

// Trash undo-window countdown. Shows time remaining before hard-delete
// (deleted_at + 24h). Updates every second.
function TrashCountdown({ deletedAt }: { deletedAt: string }) {
  const expiresAt = new Date(deletedAt).getTime() + 24 * 60 * 60 * 1000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = expiresAt - now;
  if (remaining <= 0) {
    return <span className="mt-1 inline-block text-[11px] text-red-500">⏱ expired — purging soon</span>;
  }
  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);
  const urgent = remaining < 60 * 60 * 1000;
  const label = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  return (
    <span className={`mt-1 inline-block text-[11px] ${urgent ? "text-red-500 font-medium" : "text-amber-500"}`}>
      ⏱ restore window: {label} left
    </span>
  );
}


