import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, LifeBuoy, Save, RotateCcw, ExternalLink, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { listAppSettings, updateAppSetting } from "@/lib/runtime-settings.functions";
import { getSupportGroupConfig } from "@/lib/support-group.functions";

export const Route = createFileRoute("/_authenticated/admin/support-group")({
  component: SupportGroupAdminPage,
});

const KEYS = [
  "SUPPORT_GROUP_ENABLED",
  "SUPPORT_GROUP_URL",
  "SUPPORT_GROUP_TITLE",
  "SUPPORT_GROUP_DESCRIPTION",
] as const;

type DraftKey = (typeof KEYS)[number];

function SupportGroupAdminPage() {
  const list = useServerFn(listAppSettings);
  const update = useServerFn(updateAppSetting);
  const preview = useServerFn(getSupportGroupConfig);

  const settingsQ = useQuery({ queryKey: ["app-settings"], queryFn: () => list() });
  const previewQ = useQuery({ queryKey: ["support-group-preview"], queryFn: () => preview() });

  const [draft, setDraft] = useState<Record<DraftKey, string>>({
    SUPPORT_GROUP_ENABLED: "",
    SUPPORT_GROUP_URL: "",
    SUPPORT_GROUP_TITLE: "",
    SUPPORT_GROUP_DESCRIPTION: "",
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settingsQ.data) return;
    const map: any = { ...draft };
    for (const k of KEYS) {
      const row = settingsQ.data.find((r) => r.key === k);
      map[k] = row?.value ?? "";
    }
    setDraft(map);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQ.data]);

  const save = useMutation({
    mutationFn: async () => {
      for (const k of KEYS) {
        await update({ data: { key: k, value: draft[k]?.trim() ? draft[k].trim() : null } });
      }
    },
    onSuccess: async () => {
      toast.success("Support group settings saved");
      setDirty(false);
      await settingsQ.refetch();
      await previewQ.refetch();
    },
    onError: (e: Error) => toast.error(e?.message ?? "Save failed"),
  });

  function set<K extends DraftKey>(k: K, v: string) {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  }

  const enabled = /^(1|true|yes|on)$/i.test(draft.SUPPORT_GROUP_ENABLED.trim() || "");
  const url = draft.SUPPORT_GROUP_URL.trim();
  const looksValid = /^https?:\/\/(t\.me|telegram\.me|telegram\.dog)\//i.test(url) || /^@[A-Za-z0-9_]{4,}$/.test(url);

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/admin"><Button size="sm" variant="ghost"><ArrowLeft className="h-3 w-3 mr-1" /> Admin</Button></Link>
        <h1 className="text-lg sm:text-2xl font-bold flex items-center gap-2">
          <LifeBuoy className="h-5 w-5 text-primary" />
          Help &amp; Support Group popup
        </h1>
      </div>
      <p className="text-xs text-muted-foreground">
        Shown to users right after sign-in / registration and reachable from the download preflight dialog.
        Use a Telegram group/channel invite link (e.g. <code>https://t.me/your_group</code>).
      </p>

      <section className="rounded-md border border-border p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm">Enabled</Label>
            <p className="text-xs text-muted-foreground">When off, the popup is hidden site-wide.</p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => set("SUPPORT_GROUP_ENABLED", v ? "true" : "false")}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Telegram group / channel URL</Label>
          <Input
            value={draft.SUPPORT_GROUP_URL}
            placeholder="https://t.me/your_group"
            onChange={(e) => set("SUPPORT_GROUP_URL", e.target.value)}
          />
          {url && !looksValid && (
            <p className="text-[11px] text-amber-500">
              That doesn't look like a Telegram link. Use a <code>t.me/...</code> URL or a <code>@username</code>.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Popup title</Label>
          <Input
            value={draft.SUPPORT_GROUP_TITLE}
            placeholder="Join our Help & Support Group"
            onChange={(e) => set("SUPPORT_GROUP_TITLE", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Description</Label>
          <Textarea
            value={draft.SUPPORT_GROUP_DESCRIPTION}
            placeholder="Get fast help, request titles, and stay updated — join our Telegram support group."
            rows={2}
            onChange={(e) => set("SUPPORT_GROUP_DESCRIPTION", e.target.value)}
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => settingsQ.refetch()} disabled={save.isPending}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save changes
          </Button>
        </div>
      </section>

      <section className="rounded-md border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-sm">Live preview</h2>
            <p className="text-xs text-muted-foreground">Reflects your unsaved edits.</p>
          </div>
          {url && (
            <a className="text-xs text-primary inline-flex items-center gap-1" href={url} target="_blank" rel="noreferrer">
              Open URL <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="rounded-xl border border-border/60 p-5 bg-card max-w-md">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-9 w-9 rounded-full bg-[#229ED9]/15 text-[#229ED9] grid place-items-center">
              <Send className="h-4 w-4" />
            </div>
            <div className="text-base font-bold">
              {draft.SUPPORT_GROUP_TITLE || "Join our Help & Support Group"}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {draft.SUPPORT_GROUP_DESCRIPTION ||
              "Get fast help, request titles, and stay updated — join our Telegram support group."}
          </p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" variant="outline" className="flex-1">Later</Button>
            <Button
              size="sm"
              className="flex-1 bg-[#229ED9] hover:bg-[#1b87b8] text-white"
              disabled={!url}
            >
              <Send className="h-3.5 w-3.5 mr-1" /> Join on Telegram
            </Button>
          </div>
        </div>
        {previewQ.data && (
          <p className="text-[11px] text-muted-foreground">
            Currently live: <span className="font-mono">{previewQ.data.enabled ? "enabled" : "disabled"}</span>
            {previewQ.data.url ? ` · ${previewQ.data.url}` : " · no URL configured"}
          </p>
        )}
      </section>
    </div>
  );
}
