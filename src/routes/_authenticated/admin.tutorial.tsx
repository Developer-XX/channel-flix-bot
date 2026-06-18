import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, PlayCircle, Save, RotateCcw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { getTutorialConfig } from "@/lib/tutorial.functions";
import { listAppSettings, updateAppSetting } from "@/lib/runtime-settings.functions";

export const Route = createFileRoute("/_authenticated/admin/tutorial")({
  component: TutorialAdminPage,
});

const KEYS = [
  "TUTORIAL_ENABLED",
  "TUTORIAL_VIDEO_TYPE",
  "TUTORIAL_VIDEO_URL",
  "TUTORIAL_TITLE",
  "TUTORIAL_DESCRIPTION",
] as const;

type DraftKey = (typeof KEYS)[number];

function extractYouTubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1) || null;
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/\/(embed|shorts)\/([^/?#]+)/);
    return m ? m[2] : null;
  } catch { return null; }
}

function inferType(url: string): "youtube" | "mp4" {
  return /youtu\.?be/i.test(url) ? "youtube" : "mp4";
}

function TutorialAdminPage() {
  const list = useServerFn(listAppSettings);
  const update = useServerFn(updateAppSetting);
  const preview = useServerFn(getTutorialConfig);

  const settingsQ = useQuery({ queryKey: ["app-settings"], queryFn: () => list() });
  const previewQ = useQuery({ queryKey: ["tutorial-preview"], queryFn: () => preview() });

  const [draft, setDraft] = useState<Record<DraftKey, string>>({
    TUTORIAL_ENABLED: "",
    TUTORIAL_VIDEO_TYPE: "",
    TUTORIAL_VIDEO_URL: "",
    TUTORIAL_TITLE: "",
    TUTORIAL_DESCRIPTION: "",
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
        await update({ data: { key: k, value: draft[k] || null } });
      }
    },
    onSuccess: async () => {
      toast.success("Tutorial settings saved");
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

  function applyUrl(v: string) {
    set("TUTORIAL_VIDEO_URL", v);
    if (v && !draft.TUTORIAL_VIDEO_TYPE) {
      set("TUTORIAL_VIDEO_TYPE", inferType(v));
    }
  }

  const enabled = /^(1|true|yes|on)$/i.test(draft.TUTORIAL_ENABLED.trim() || "");
  const type = (draft.TUTORIAL_VIDEO_TYPE || (draft.TUTORIAL_VIDEO_URL ? inferType(draft.TUTORIAL_VIDEO_URL) : "")).toLowerCase();
  const ytId = type === "youtube" ? extractYouTubeId(draft.TUTORIAL_VIDEO_URL) : null;

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/admin"><Button size="sm" variant="ghost"><ArrowLeft className="h-3 w-3 mr-1" /> Admin</Button></Link>
        <h1 className="text-lg sm:text-2xl font-bold flex items-center gap-2">
          <PlayCircle className="h-5 w-5 text-primary" />
          How to download — tutorial video
        </h1>
      </div>
      <p className="text-xs text-muted-foreground">
        This video appears at the bottom of every title page and in the first-visit onboarding popup.
        Supports YouTube embeds, direct MP4/HLS URLs, or uploads in Lovable Cloud storage.
      </p>

      <section className="rounded-md border border-border p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm">Enabled</Label>
            <p className="text-xs text-muted-foreground">When off, the tutorial is hidden site-wide.</p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => set("TUTORIAL_ENABLED", v ? "true" : "false")}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Video URL</Label>
          <Input
            value={draft.TUTORIAL_VIDEO_URL}
            placeholder="https://youtu.be/... or https://cdn.example.com/intro.mp4"
            onChange={(e) => applyUrl(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            For YouTube paste a watch / share / shorts URL. For MP4 use a public HTTPS URL.
            For storage uploads, paste the public object URL from the Storage panel.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Video type</Label>
            <div className="flex gap-1">
              {(["youtube", "mp4", "storage"] as const).map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={type === t ? "default" : "outline"}
                  onClick={() => set("TUTORIAL_VIDEO_TYPE", t)}
                >
                  {t}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Section title</Label>
            <Input
              value={draft.TUTORIAL_TITLE}
              placeholder="How to download"
              onChange={(e) => set("TUTORIAL_TITLE", e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Description (shown under the title)</Label>
          <Textarea
            value={draft.TUTORIAL_DESCRIPTION}
            placeholder="Short paragraph shown above the video player."
            rows={2}
            onChange={(e) => set("TUTORIAL_DESCRIPTION", e.target.value)}
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => settingsQ.refetch()}
            disabled={save.isPending}
          >
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
            <p className="text-xs text-muted-foreground">
              Reflects your unsaved edits — this is exactly what visitors will see.
            </p>
          </div>
          {draft.TUTORIAL_VIDEO_URL && (
            <a
              className="text-xs text-primary inline-flex items-center gap-1"
              href={draft.TUTORIAL_VIDEO_URL}
              target="_blank"
              rel="noreferrer"
            >
              Open URL <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {!draft.TUTORIAL_VIDEO_URL ? (
          <p className="text-xs text-muted-foreground">Add a video URL to see the preview.</p>
        ) : (
          <div className="rounded-xl border border-border/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/60">
              <div className="text-sm font-semibold">{draft.TUTORIAL_TITLE || "How to download"}</div>
              {draft.TUTORIAL_DESCRIPTION && (
                <div className="text-xs text-muted-foreground mt-0.5">{draft.TUTORIAL_DESCRIPTION}</div>
              )}
            </div>
            <div className="relative w-full bg-black aspect-video">
              {ytId ? (
                <iframe
                  src={`https://www.youtube.com/embed/${ytId}?rel=0&modestbranding=1`}
                  title="Tutorial preview"
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : (
                <video
                  src={draft.TUTORIAL_VIDEO_URL}
                  controls
                  playsInline
                  preload="metadata"
                  className="absolute inset-0 h-full w-full object-contain"
                />
              )}
            </div>
          </div>
        )}
        {previewQ.data && (
          <p className="text-[11px] text-muted-foreground">
            Currently live: <span className="font-mono">{previewQ.data.enabled ? "enabled" : "disabled"}</span>
            {previewQ.data.type ? ` · type=${previewQ.data.type}` : ""}
            {previewQ.data.url ? ` · ${previewQ.data.url.slice(0, 60)}${previewQ.data.url.length > 60 ? "…" : ""}` : ""}
          </p>
        )}
      </section>
    </div>
  );
}
