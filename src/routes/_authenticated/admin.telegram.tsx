import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
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
} from "@/lib/telegram.functions";

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

  const [statusFilter, setStatusFilter] =
    useState<"all" | "pending" | "matched" | "unmatched" | "ignored">("unmatched");
  // Telegram needs a stable, externally reachable HTTPS URL. The `id-preview--…`
  // host goes through Lovable's auth bridge and is NOT reachable for Telegram.
  // Use the stable `project--<id>-dev.lovable.app` (preview) or
  // `project--<id>.lovable.app` (published) host instead.
  const STABLE_DEV_URL = "https://project--d54ff009-ac17-477f-85a3-112a949d0888-dev.lovable.app";
  const [baseUrl, setBaseUrl] = useState(STABLE_DEV_URL);
  const [expanded, setExpanded] = useState<string | null>(null);

  const ingest = useQuery({
    queryKey: ["tg-ingest", statusFilter],
    queryFn: () => list({ data: { status: statusFilter } }),
  });
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
        </div>
        <p className="text-xs text-muted-foreground">
          A scheduled job also runs this endpoint periodically to catch posts missed by the webhook.
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {(["all", "pending", "matched", "unmatched", "ignored"] as const).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => ingest.refetch()}>Refresh</Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                const r = await rematch();
                toast.success(`Rematch: promoted ${r.promoted}/${r.scanned}, still unmatched ${r.stillUnmatched}`);
                ingest.refetch();
                router.invalidate();
              } catch (e: any) {
                toast.error(e?.message ?? "Rematch failed");
              }
            }}
          >
            Rematch unmatched
          </Button>
        </div>

        {ingest.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {ingest.error && <p className="text-sm text-destructive">{(ingest.error as Error).message}</p>}

        <div className="space-y-2">
          {(ingest.data ?? []).map((row) => (
            <IngestCard
              key={row.id}
              row={row}
              expanded={expanded === row.id}
              onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
              onUpdate={async (patch) => {
                await update({ data: { ingestId: row.id, ...patch } });
                ingest.refetch();
              }}
              onPromote={async (titleId, overrides) => {
                await promote({ data: { ingestId: row.id, titleId, overrides } });
                toast.success("Promoted to media_files");
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
  row, expanded, onToggle, onUpdate, onPromote, onIgnore, search,
}: {
  row: IngestRow;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (patch: Record<string, any>) => Promise<void>;
  onPromote: (titleId: string, overrides?: any) => Promise<void>;
  onIgnore: () => Promise<void>;
  search: (args: { data: { q: string } }) => Promise<Array<{ id: string; title: string; release_year: number | null; category: string }>>;
}) {
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
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
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
        </button>
        <Button size="sm" variant="ghost" onClick={onToggle}>{expanded ? "Close" : "Review"}</Button>
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
                variant="outline"
                onClick={async () => {
                  try { await onIgnore(); toast.success("Ignored"); }
                  catch (e: any) { toast.error(e?.message ?? "Failed"); }
                }}
              >
                Ignore
              </Button>
            </div>
          </div>
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

  const [ref, setRef] = useState("");
  const [check, setCheck] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [adminIds, setAdminIds] = useState("");

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
        <div className="text-xs uppercase text-muted-foreground">Connected channels</div>
        {channels.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {(channels.data ?? []).length === 0 && !channels.isLoading && (
          <div className="text-sm text-muted-foreground">No channels yet.</div>
        )}
        {(channels.data ?? []).map((c: any) => (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
            <div className="min-w-0">
              <div className="font-medium truncate">
                {c.is_active ? "🟢" : "⚪"} {c.name} {c.username ? <span className="text-muted-foreground">@{c.username}</span> : null}
              </div>
              <div className="text-xs text-muted-foreground font-mono">{c.channel_id}</div>
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

