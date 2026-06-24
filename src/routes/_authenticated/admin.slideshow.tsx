import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Images, Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  adminListSlides,
  adminUpsertSlide,
  adminDeleteSlide,
  DEFAULT_SECTION_ORDER,
} from "@/lib/homepage.functions";
import { listAppSettings, updateAppSetting } from "@/lib/runtime-settings.functions";

export const Route = createFileRoute("/_authenticated/admin/slideshow")({
  component: SlideshowAdmin,
});

function SlideshowAdmin() {
  const qc = useQueryClient();
  const list = useServerFn(adminListSlides);
  const upsert = useServerFn(adminUpsertSlide);
  const del = useServerFn(adminDeleteSlide);
  const listSettings = useServerFn(listAppSettings);
  const updateSetting = useServerFn(updateAppSetting);

  const q = useQuery({ queryKey: ["admin-slides"], queryFn: () => list(), retry: false });
  const s = useQuery({ queryKey: ["admin-homepage-settings"], queryFn: () => listSettings(), retry: false });

  const order = s.data?.find((x: any) => x.key === "HOMEPAGE_SECTION_ORDER")?.value ?? DEFAULT_SECTION_ORDER.join(",");
  const enabled = (s.data?.find((x: any) => x.key === "HOMEPAGE_SLIDESHOW_ENABLED")?.value ?? "true") !== "false";

  const [orderDraft, setOrderDraft] = useState<string | null>(null);

  async function save(a: any) {
    try {
      await upsert({ data: a });
      toast.success("Slide saved");
      q.refetch();
      qc.invalidateQueries({ queryKey: ["homepage-layout"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  }

  async function setSetting(key: string, value: string | null) {
    try {
      await updateSetting({ data: { key, value } });
      toast.success("Saved");
      s.refetch();
      qc.invalidateQueries({ queryKey: ["homepage-layout"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  }

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Link to="/admin"><Button size="sm" variant="ghost"><ArrowLeft className="h-3 w-3 mr-1" /> Admin</Button></Link>
        <h1 className="text-lg sm:text-2xl font-bold flex items-center gap-2">
          <Images className="h-5 w-5 text-primary" /> Homepage slideshow
        </h1>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() =>
            save({
              title: "New slide",
              image_url: "https://placehold.co/1600x900",
              sort_order: (q.data?.length ?? 0) * 10,
              is_active: true,
              duration_ms: 5000,
            })
          }
        >
          <Plus className="h-3 w-3 mr-1" /> New slide
        </Button>
      </div>

      <section className="rounded-md border border-border p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => setSetting("HOMEPAGE_SLIDESHOW_ENABLED", v ? "true" : "false")}
          />
          <span className="text-sm">Slideshow visible on homepage</span>
        </div>
        <div>
          <Label className="text-xs">Section order (comma separated)</Label>
          <p className="text-[11px] text-muted-foreground">
            Known keys: trending, latest, movies, series, anime, kdrama. Remove a key to hide that row.
          </p>
          <div className="flex gap-2 mt-1">
            <Input
              value={orderDraft ?? order}
              onChange={(e) => setOrderDraft(e.target.value)}
              placeholder={DEFAULT_SECTION_ORDER.join(",")}
            />
            <Button
              size="sm"
              onClick={() => setSetting("HOMEPAGE_SECTION_ORDER", (orderDraft ?? order).trim() || null).then(() => setOrderDraft(null))}
            >
              <Save className="h-3 w-3 mr-1" /> Save
            </Button>
          </div>
        </div>
      </section>

      <div className="space-y-2">
        {(q.data ?? []).map((a: any) => (
          <SlideRow
            key={a.id}
            a={a}
            onSave={save}
            onDelete={async () => {
              if (!confirm("Delete this slide?")) return;
              try { await del({ data: { id: a.id } }); toast.success("Deleted"); q.refetch(); }
              catch (e: any) { toast.error(e?.message ?? "Failed"); }
            }}
          />
        ))}
        {(q.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">No slides yet.</p>}
      </div>
    </div>
  );
}

function SlideRow({ a, onSave, onDelete }: { a: any; onSave: (a: any) => void; onDelete: () => void }) {
  const [d, setD] = useState(a);
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px]">Title</Label>
          <Input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
        </div>
        <div>
          <Label className="text-[10px]">CTA label (optional)</Label>
          <Input value={d.cta_label ?? ""} onChange={(e) => setD({ ...d, cta_label: e.target.value || null })} />
        </div>
      </div>
      <div>
        <Label className="text-[10px]">Subtitle</Label>
        <Textarea rows={2} value={d.subtitle ?? ""} onChange={(e) => setD({ ...d, subtitle: e.target.value || null })} />
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px]">Image URL</Label>
          <Input value={d.image_url} onChange={(e) => setD({ ...d, image_url: e.target.value })} />
        </div>
        <div>
          <Label className="text-[10px]">Link URL (optional)</Label>
          <Input value={d.link_url ?? ""} onChange={(e) => setD({ ...d, link_url: e.target.value || null })} />
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-2 items-end">
        <div>
          <Label className="text-[10px]">Sort order</Label>
          <Input
            type="number"
            value={d.sort_order}
            onChange={(e) => setD({ ...d, sort_order: parseInt(e.target.value || "0", 10) })}
          />
        </div>
        <div>
          <Label className="text-[10px]">Duration (ms)</Label>
          <Input
            type="number"
            value={d.duration_ms}
            onChange={(e) => setD({ ...d, duration_ms: parseInt(e.target.value || "5000", 10) })}
          />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex items-center gap-1.5">
            <Switch checked={d.is_active} onCheckedChange={(v) => setD({ ...d, is_active: v })} />
            <span className="text-xs">Active</span>
          </div>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() =>
              onSave({
                id: d.id,
                title: d.title,
                subtitle: d.subtitle || null,
                image_url: d.image_url,
                link_url: d.link_url || null,
                cta_label: d.cta_label || null,
                sort_order: d.sort_order ?? 0,
                is_active: d.is_active,
                duration_ms: d.duration_ms ?? 5000,
              })
            }
          >
            <Save className="h-3 w-3 mr-1" /> Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
        </div>
      </div>
    </div>
  );
}
