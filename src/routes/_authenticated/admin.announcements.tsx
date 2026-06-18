import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Megaphone, Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  adminListAnnouncements, adminUpsertAnnouncement, adminDeleteAnnouncement,
} from "@/lib/announcements.functions";

export const Route = createFileRoute("/_authenticated/admin/announcements")({
  component: AnnouncementsAdmin,
});

function AnnouncementsAdmin() {
  const list = useServerFn(adminListAnnouncements);
  const upsert = useServerFn(adminUpsertAnnouncement);
  const del = useServerFn(adminDeleteAnnouncement);
  const q = useQuery({ queryKey: ["admin-announcements"], queryFn: () => list(), retry: false });

  async function save(a: any) {
    try { await upsert({ data: a }); toast.success("Saved"); q.refetch(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/admin"><Button size="sm" variant="ghost"><ArrowLeft className="h-3 w-3 mr-1" /> Admin</Button></Link>
        <h1 className="text-lg sm:text-2xl font-bold flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" /> Announcements</h1>
        <Button size="sm" className="ml-auto" onClick={() => save({ body: "New announcement", variant: "info", is_active: true })}>
          <Plus className="h-3 w-3 mr-1" /> New
        </Button>
      </div>
      <div className="space-y-2">
        {(q.data ?? []).map((a: any) => (
          <Row key={a.id} a={a} onSave={save} onDelete={async () => {
            if (!confirm("Delete?")) return;
            try { await del({ data: { id: a.id } }); toast.success("Deleted"); q.refetch(); }
            catch (e: any) { toast.error(e?.message ?? "Failed"); }
          }} />
        ))}
        {(q.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">No announcements yet.</p>}
      </div>
    </div>
  );
}

function Row({ a, onSave, onDelete }: { a: any; onSave: (a: any) => void; onDelete: () => void }) {
  const [d, setD] = useState(a);
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <Textarea rows={2} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} />
      <div className="grid sm:grid-cols-3 gap-2">
        <div><Label className="text-[10px]">Link URL</Label><Input value={d.link_url ?? ""} onChange={(e) => setD({ ...d, link_url: e.target.value || null })} /></div>
        <div>
          <Label className="text-[10px]">Variant</Label>
          <select className="flex h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  value={d.variant} onChange={(e) => setD({ ...d, variant: e.target.value })}>
            {["info","success","warning","promo"].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex items-center gap-1.5"><Switch checked={d.is_active} onCheckedChange={(v) => setD({ ...d, is_active: v })} /><span className="text-xs">Active</span></div>
          <Button size="sm" className="ml-auto" onClick={() => onSave({
            id: d.id, body: d.body, link_url: d.link_url || null, variant: d.variant,
            is_active: d.is_active, starts_at: d.starts_at ?? null, ends_at: d.ends_at ?? null,
          })}><Save className="h-3 w-3 mr-1" /> Save</Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
        </div>
      </div>
    </div>
  );
}
