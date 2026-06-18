import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Megaphone, Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { adminListAds, adminUpsertAd, adminDeleteAd, adminAdStats, AD_PLACEMENTS } from "@/lib/ads.functions";
import { listAppSettings, updateAppSetting } from "@/lib/runtime-settings.functions";

export const Route = createFileRoute("/_authenticated/admin/ads")({
  component: AdsAdmin,
});

function AdsAdmin() {
  const list = useServerFn(adminListAds);
  const upsert = useServerFn(adminUpsertAd);
  const del = useServerFn(adminDeleteAd);
  const listSettings = useServerFn(listAppSettings);
  const updateSetting = useServerFn(updateAppSetting);
  const statsFn = useServerFn(adminAdStats);

  const q = useQuery({ queryKey: ["admin-ads"], queryFn: () => list(), retry: false });
  const s = useQuery({ queryKey: ["admin-ad-settings"], queryFn: () => listSettings(), retry: false });
  const stats = useQuery({ queryKey: ["admin-ad-stats"], queryFn: () => statsFn(), retry: false, staleTime: 60_000 });

  const adsEnabled = (s.data?.find((x: any) => x.key === "ADS_ENABLED")?.value ?? "true") !== "false";
  const statsById = new Map<string, any>((stats.data?.stats ?? []).map((r: any) => [r.ad_id, r]));

  async function save(a: any) {
    try { await upsert({ data: a }); toast.success("Saved"); q.refetch(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }
  async function setEnabled(v: boolean) {
    try { await updateSetting({ data: { key: "ADS_ENABLED", value: v ? "true" : "false" } }); toast.success("Saved"); s.refetch(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/admin"><Button size="sm" variant="ghost"><ArrowLeft className="h-3 w-3 mr-1" /> Admin</Button></Link>
        <h1 className="text-lg sm:text-2xl font-bold flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" /> Ads</h1>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => save({ name: "New ad", placement: "homepage_banner", kind: "image", image_url: "https://placehold.co/1200x300", is_active: true, sort_order: 0 })}
        >
          <Plus className="h-3 w-3 mr-1" /> New ad
        </Button>
      </div>

      <div className="rounded-md border border-border p-4 flex items-center gap-3">
        <Switch checked={adsEnabled} onCheckedChange={setEnabled} />
        <div className="text-sm">
          Ads globally enabled
          <p className="text-[11px] text-muted-foreground">Premium users never see ads regardless of this toggle.</p>
        </div>
      </div>

      <div className="rounded-md border border-border p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Analytics (last 30 days)</h2>
          <Button size="sm" variant="ghost" onClick={() => stats.refetch()}>Refresh</Button>
        </div>
        {(stats.data?.stats ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No impressions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-2">Ad</th>
                  <th className="py-1 pr-2">Placement</th>
                  <th className="py-1 pr-2 text-right">Impr.</th>
                  <th className="py-1 pr-2 text-right">Clicks</th>
                  <th className="py-1 text-right">CTR</th>
                </tr>
              </thead>
              <tbody>
                {(stats.data?.stats ?? []).map((r: any) => (
                  <tr key={r.ad_id} className="border-t border-border/60">
                    <td className="py-1 pr-2 truncate max-w-[160px]">{r.name}</td>
                    <td className="py-1 pr-2 text-muted-foreground">{r.placement}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{r.impressions}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{r.clicks}</td>
                    <td className="py-1 text-right tabular-nums">{(r.ctr * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {(q.data ?? []).map((a: any) => {
          const st = statsById.get(a.id);
          return (
            <AdRow
              key={a.id}
              a={a}
              stat={st}
              onSave={save}
              onDelete={async () => {
                if (!confirm("Delete this ad?")) return;
                try { await del({ data: { id: a.id } }); toast.success("Deleted"); q.refetch(); }
                catch (e: any) { toast.error(e?.message ?? "Failed"); }
              }}
            />
          );
        })}
        {(q.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">No ads yet.</p>}
      </div>
    </div>
  );
}

function AdRow({ a, stat, onSave, onDelete }: { a: any; stat?: any; onSave: (a: any) => void; onDelete: () => void }) {
  const [d, setD] = useState(a);
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      {stat && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span><span className="tabular-nums text-foreground">{stat.impressions}</span> impressions</span>
          <span><span className="tabular-nums text-foreground">{stat.clicks}</span> clicks</span>
          <span>CTR <span className="tabular-nums text-foreground">{(stat.ctr * 100).toFixed(1)}%</span></span>
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px]">Name</Label>
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </div>
        <div>
          <Label className="text-[10px]">Placement</Label>
          <select className="flex h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  value={d.placement} onChange={(e) => setD({ ...d, placement: e.target.value })}>
            {AD_PLACEMENTS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-[10px]">Kind</Label>
          <select className="flex h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>
            {["image","video","html"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      {d.kind === "html" ? (
        <div>
          <Label className="text-[10px]">HTML (sandboxed iframe)</Label>
          <Textarea rows={4} value={d.html ?? ""} onChange={(e) => setD({ ...d, html: e.target.value || null })} />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px]">{d.kind === "video" ? "Video URL (mp4)" : "Image URL"}</Label>
            <Input
              value={(d.kind === "video" ? d.video_url : d.image_url) ?? ""}
              onChange={(e) => setD(d.kind === "video"
                ? { ...d, video_url: e.target.value || null }
                : { ...d, image_url: e.target.value || null })}
            />
          </div>
          <div>
            <Label className="text-[10px]">Link URL</Label>
            <Input value={d.link_url ?? ""} onChange={(e) => setD({ ...d, link_url: e.target.value || null })} />
          </div>
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-2 items-end">
        <div>
          <Label className="text-[10px]">Sort order</Label>
          <Input type="number" value={d.sort_order} onChange={(e) => setD({ ...d, sort_order: parseInt(e.target.value || "0", 10) })} />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex items-center gap-1.5">
            <Switch checked={d.is_active} onCheckedChange={(v) => setD({ ...d, is_active: v })} />
            <span className="text-xs">Active</span>
          </div>
        </div>
        <div className="flex items-end gap-2 justify-end">
          <Button size="sm" onClick={() => onSave({
            id: d.id, name: d.name, placement: d.placement, kind: d.kind,
            image_url: d.image_url || null, video_url: d.video_url || null, html: d.html || null,
            link_url: d.link_url || null, sort_order: d.sort_order ?? 0, is_active: d.is_active,
            starts_at: d.starts_at ?? null, ends_at: d.ends_at ?? null,
          })}><Save className="h-3 w-3 mr-1" /> Save</Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
        </div>
      </div>
    </div>
  );
}
