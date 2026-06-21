import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Plus, Trash2, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  listForceJoinChannels,
  upsertForceJoinChannel,
  deleteForceJoinChannel,
  verifyForceJoinChannel,
  type ForceJoinChannelRow,
} from "@/lib/force-join.functions";
import { CATEGORIES, type CategorySlug } from "@/lib/categories";

export const Route = createFileRoute("/_authenticated/admin/force-join")({
  component: ForceJoinAdmin,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Error: {error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type Draft = {
  id?: string;
  title: string;
  chat_id: string;
  invite_url: string;
  categories: CategorySlug[];
  is_active: boolean;
  priority: number;
};

function emptyDraft(): Draft {
  return { title: "", chat_id: "", invite_url: "", categories: [], is_active: true, priority: 0 };
}

function ForceJoinAdmin() {
  const list = useServerFn(listForceJoinChannels);
  const upsert = useServerFn(upsertForceJoinChannel);
  const del = useServerFn(deleteForceJoinChannel);
  const verify = useServerFn(verifyForceJoinChannel);

  const q = useQuery({
    queryKey: ["force-join-channels"],
    queryFn: () => list(),
  });

  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);

  function startEdit(row: ForceJoinChannelRow) {
    setDraft({
      id: row.id,
      title: row.title,
      chat_id: row.chat_id,
      invite_url: row.invite_url ?? "",
      categories: (row.categories as CategorySlug[]) ?? [],
      is_active: row.is_active,
      priority: row.priority,
    });
  }

  function toggleCategory(cat: CategorySlug) {
    setDraft((d) => ({
      ...d,
      categories: d.categories.includes(cat) ? d.categories.filter((c) => c !== cat) : [...d.categories, cat],
    }));
  }

  async function handleSave() {
    if (!draft.title.trim() || !draft.chat_id.trim()) {
      toast.error("Title and chat id are required");
      return;
    }
    setSaving(true);
    try {
      await upsert({
        data: {
          id: draft.id,
          title: draft.title.trim(),
          chat_id: draft.chat_id.trim(),
          invite_url: draft.invite_url.trim() || null,
          categories: draft.categories,
          is_active: draft.is_active,
          priority: draft.priority,
        },
      });
      toast.success(draft.id ? "Channel updated" : "Channel added");
      setDraft(emptyDraft());
      q.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify() {
    if (!draft.chat_id.trim()) return;
    setVerifying(true);
    try {
      const r: any = await verify({ data: { chat_id: draft.chat_id.trim() } });
      if (r.ok) {
        toast.success(`✅ Bot can see "${r.title}" (${r.type})`);
        if (!draft.title.trim() && r.title) setDraft((d) => ({ ...d, title: r.title }));
      } else {
        toast.error(`Verify failed: ${r.error}`);
      }
    } finally {
      setVerifying(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this force-join channel?")) return;
    try {
      await del({ data: { id } });
      toast.success("Deleted");
      q.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Link to="/admin">
          <Button size="sm" variant="ghost"><ArrowLeft className="h-3 w-3 mr-1" /> Admin</Button>
        </Link>
        <div className="ml-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Force-join channels</h1>
          <p className="text-xs text-muted-foreground">
            Require users to join one or more Telegram channels before the bot delivers files.
            Set the AND/OR rule and master on/off toggle in <Link to="/admin/settings" className="underline">Settings → Force Join</Link>.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          {draft.id ? "Edit channel" : "Add new channel"}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Display title</Label>
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="StreamVault Official"
            />
          </div>
          <div className="space-y-1">
            <Label>Telegram chat id or @handle</Label>
            <div className="flex gap-2">
              <Input
                value={draft.chat_id}
                onChange={(e) => setDraft({ ...draft, chat_id: e.target.value })}
                placeholder="@channel or -1001234567890"
              />
              <Button variant="outline" size="sm" onClick={handleVerify} disabled={!draft.chat_id.trim() || verifying}>
                {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : "Verify"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Bot must be admin in this chat so it can read membership.</p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Invite URL (shown to users)</Label>
            <Input
              value={draft.invite_url}
              onChange={(e) => setDraft({ ...draft, invite_url: e.target.value })}
              placeholder="https://t.me/your_channel"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Categories (empty = applies to all)</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const active = draft.categories.includes(c.slug);
                return (
                  <button
                    type="button"
                    key={c.slug}
                    onClick={() => toggleCategory(c.slug)}
                    className={`text-xs px-2 py-1 rounded-md border transition ${active ? "border-primary bg-primary/15 text-primary-foreground" : "border-border bg-surface/40 text-muted-foreground hover:text-foreground"}`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Priority</Label>
            <Input
              type="number"
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })}
            />
            <p className="text-[11px] text-muted-foreground">Higher = shown first in the join dialog.</p>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Switch checked={draft.is_active} onCheckedChange={(v) => setDraft({ ...draft, is_active: v })} />
            <Label className="!m-0">Active</Label>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
            {draft.id ? "Save changes" : "Add channel"}
          </Button>
          {draft.id && (
            <Button variant="ghost" onClick={() => setDraft(emptyDraft())}>Cancel</Button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Configured channels</div>
        {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {q.data && q.data.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No channels yet. Add one above — until then the bot falls back to the legacy single-channel settings.
          </div>
        )}
        <ul className="space-y-2">
          {(q.data ?? []).map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface/40 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{row.title}</span>
                  <Badge variant={row.is_active ? "default" : "outline"}>
                    {row.is_active ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
                    {row.is_active ? "Active" : "Disabled"}
                  </Badge>
                  {row.categories.length === 0 ? (
                    <Badge variant="outline">All categories</Badge>
                  ) : (
                    row.categories.map((c) => <Badge variant="outline" key={c}>{c}</Badge>)
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 truncate">
                  <code>{row.chat_id}</code>
                  {row.invite_url && <> · <a href={row.invite_url} target="_blank" rel="noreferrer" className="underline">{row.invite_url}</a></>}
                  {" · "}priority {row.priority}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="outline" onClick={() => startEdit(row)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(row.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
