import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Crown, Check, X, Search, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  adminListPayments, adminReviewPayment, adminGrantPremium, adminRevokePremium,
  adminSearchUsers, adminListPlans, adminUpsertPlan, adminDeletePlan,
} from "@/lib/premium.functions";
import { listAppSettings, updateAppSetting } from "@/lib/runtime-settings.functions";

export const Route = createFileRoute("/_authenticated/admin/premium")({
  component: PremiumAdmin,
});

function PremiumAdmin() {
  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Link to="/admin"><Button size="sm" variant="ghost"><ArrowLeft className="h-3 w-3 mr-1" /> Admin</Button></Link>
        <h1 className="text-lg sm:text-2xl font-bold flex items-center gap-2"><Crown className="h-5 w-5 text-amber-400" /> Premium</h1>
      </div>
      <PaymentsPanel />
      <UsersPanel />
      <PlansPanel />
      <UpiSettingsPanel />
    </div>
  );
}

function PaymentsPanel() {
  const list = useServerFn(adminListPayments);
  const review = useServerFn(adminReviewPayment);
  const [status, setStatus] = useState<"pending"|"approved"|"rejected"|"all">("pending");
  const q = useQuery({ queryKey: ["admin-payments", status], queryFn: () => list({ data: { status } }), retry: false });
  const mut = useMutation({
    mutationFn: (vars: { id: string; action: "approve"|"reject"; note?: string }) =>
      review({ data: { paymentId: vars.id, action: vars.action, adminNote: vars.note ?? null } }),
    onSuccess: () => { toast.success("Updated"); q.refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold text-sm">Payment submissions</h2>
        <div className="ml-auto flex gap-1">
          {(["pending","approved","rejected","all"] as const).map((s) => (
            <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>{s}</Button>
          ))}
        </div>
      </div>
      {q.error && <p className="text-xs text-destructive">{(q.error as Error).message}</p>}
      <div className="space-y-2">
        {(q.data ?? []).map((p: any) => (
          <div key={p.id} className="rounded-md border border-border p-3 grid sm:grid-cols-[120px_1fr_auto] gap-3">
            {p.screenshot_signed_url
              ? <a href={p.screenshot_signed_url} target="_blank" rel="noreferrer"><img src={p.screenshot_signed_url} className="rounded border border-border h-24 w-24 object-cover" /></a>
              : <div className="h-24 w-24 rounded border border-dashed border-border text-[10px] grid place-items-center text-muted-foreground">no preview</div>}
            <div className="text-xs space-y-0.5 min-w-0">
              <div className="font-semibold text-sm">{p.plan_name} · ₹{p.amount_inr} ({p.duration_days}d)</div>
              <div className="text-muted-foreground">User: {p.user_display_name ?? p.user_id}</div>
              {p.user_note && <div className="text-muted-foreground">Note: {p.user_note}</div>}
              {p.admin_note && <div className="text-muted-foreground">Admin: {p.admin_note}</div>}
              <div className="text-muted-foreground">{new Date(p.created_at).toLocaleString()} · {p.status}</div>
            </div>
            {p.status === "pending" && (
              <div className="flex sm:flex-col gap-1 items-end">
                <Button size="sm" onClick={() => mut.mutate({ id: p.id, action: "approve" })}><Check className="h-3 w-3 mr-1" /> Approve</Button>
                <Button size="sm" variant="outline" onClick={() => {
                  const note = window.prompt("Reason (optional)") ?? undefined;
                  mut.mutate({ id: p.id, action: "reject", note });
                }}><X className="h-3 w-3 mr-1" /> Reject</Button>
              </div>
            )}
          </div>
        ))}
        {(q.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">No payments.</p>}
      </div>
    </section>
  );
}

function UsersPanel() {
  const search = useServerFn(adminSearchUsers);
  const grant = useServerFn(adminGrantPremium);
  const revoke = useServerFn(adminRevokePremium);
  const [qStr, setQStr] = useState("");
  const usersQ = useQuery({ queryKey: ["admin-users", qStr], queryFn: () => search({ data: { q: qStr } }), retry: false });

  return (
    <section className="rounded-md border border-border p-3 space-y-3">
      <h2 className="font-semibold text-sm">Manage users</h2>
      <div className="flex gap-2">
        <Input placeholder="Search by display name…" value={qStr} onChange={(e) => setQStr(e.target.value)} />
        <Button onClick={() => usersQ.refetch()}><Search className="h-4 w-4" /></Button>
      </div>
      <div className="overflow-x-auto -mx-3 sm:mx-0">
        <table className="w-full text-xs min-w-[640px]">
          <thead className="text-muted-foreground"><tr className="text-left">
            <th className="p-1.5">Name</th><th className="p-1.5">User ID</th><th className="p-1.5">Premium</th><th className="p-1.5">Until</th><th className="p-1.5"></th>
          </tr></thead>
          <tbody>
            {(usersQ.data ?? []).map((u: any) => (
              <tr key={u.id} className="border-t border-border/50">
                <td className="p-1.5">{u.display_name ?? "(no name)"}</td>
                <td className="p-1.5 font-mono text-[10px] truncate max-w-[160px]">{u.id}</td>
                <td className="p-1.5">{u.is_premium ? "✅" : "—"}</td>
                <td className="p-1.5">{u.premium_until ? new Date(u.premium_until).toLocaleDateString() : "—"}</td>
                <td className="p-1.5 flex gap-1 justify-end">
                  <Button size="sm" variant="outline" onClick={async () => {
                    const days = Number(window.prompt("Days to grant?", "30") ?? "");
                    if (!days || days < 1) return;
                    try { await grant({ data: { userId: u.id, days, planName: "manual" } }); toast.success("Granted"); usersQ.refetch(); }
                    catch (e: any) { toast.error(e?.message ?? "Failed"); }
                  }}>Grant</Button>
                  {u.is_premium && (
                    <Button size="sm" variant="outline" onClick={async () => {
                      if (!confirm("Revoke premium?")) return;
                      try { await revoke({ data: { userId: u.id } }); toast.success("Revoked"); usersQ.refetch(); }
                      catch (e: any) { toast.error(e?.message ?? "Failed"); }
                    }}>Revoke</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlansPanel() {
  const list = useServerFn(adminListPlans);
  const upsert = useServerFn(adminUpsertPlan);
  const del = useServerFn(adminDeletePlan);
  const q = useQuery({ queryKey: ["admin-plans"], queryFn: () => list(), retry: false });

  async function save(p: any) {
    try { await upsert({ data: p }); toast.success("Saved"); q.refetch(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  return (
    <section className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold text-sm">Plans</h2>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => save({
          name: "New plan", description: "", price_inr: 99, duration_days: 30, sort_order: 99, is_active: true,
        })}><Plus className="h-3 w-3 mr-1" /> Add</Button>
      </div>
      <div className="space-y-2">
        {(q.data ?? []).map((p: any) => (
          <PlanRow key={p.id} plan={p} onSave={save} onDelete={async () => {
            if (!confirm("Delete plan?")) return;
            try { await del({ data: { id: p.id } }); toast.success("Deleted"); q.refetch(); }
            catch (e: any) { toast.error(e?.message ?? "Failed"); }
          }} />
        ))}
      </div>
    </section>
  );
}

function PlanRow({ plan, onSave, onDelete }: { plan: any; onSave: (p: any) => void; onDelete: () => void }) {
  const [d, setD] = useState(plan);
  return (
    <div className="grid sm:grid-cols-6 gap-2 items-end border border-border rounded p-2">
      <div><Label className="text-[10px]">Name</Label><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></div>
      <div className="sm:col-span-2"><Label className="text-[10px]">Description</Label><Input value={d.description ?? ""} onChange={(e) => setD({ ...d, description: e.target.value })} /></div>
      <div><Label className="text-[10px]">Price ₹</Label><Input type="number" value={d.price_inr} onChange={(e) => setD({ ...d, price_inr: Number(e.target.value) })} /></div>
      <div><Label className="text-[10px]">Days</Label><Input type="number" value={d.duration_days} onChange={(e) => setD({ ...d, duration_days: Number(e.target.value) })} /></div>
      <div className="flex items-center gap-1">
        <Switch checked={d.is_active} onCheckedChange={(v) => setD({ ...d, is_active: v })} />
        <Button size="sm" onClick={() => onSave({ id: d.id, name: d.name, description: d.description, price_inr: d.price_inr, duration_days: d.duration_days, sort_order: d.sort_order ?? 0, is_active: d.is_active })}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
      </div>
    </div>
  );
}

function UpiSettingsPanel() {
  const list = useServerFn(listAppSettings);
  const upd = useServerFn(updateAppSetting);
  const q = useQuery({ queryKey: ["app-settings-premium"], queryFn: () => list(), retry: false });
  const [vals, setVals] = useState<Record<string, string>>({});
  const KEYS = ["PREMIUM_ENABLED","PREMIUM_UPI_ID","PREMIUM_UPI_NAME","PREMIUM_QR_URL","PREMIUM_INSTRUCTIONS"];

  const get = (k: string) => vals[k] ?? q.data?.find((r) => r.key === k)?.value ?? "";

  async function save(k: string, v: string) {
    try { await upd({ data: { key: k, value: v || null } }); toast.success("Saved"); q.refetch(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  async function uploadQr(file: File) {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const path = `qr/${Date.now()}.${file.name.split(".").pop() || "png"}`;
    const { error: upErr } = await supabase.storage.from("premium-assets").upload(path, file, { upsert: true });
    if (upErr) { toast.error(upErr.message); return; }
    const { data: pub } = await supabase.storage.from("premium-assets").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
    if (pub?.signedUrl) {
      setVals((p) => ({ ...p, PREMIUM_QR_URL: pub.signedUrl }));
      await save("PREMIUM_QR_URL", pub.signedUrl);
    }
  }

  return (
    <section className="rounded-md border border-border p-3 space-y-3">
      <h2 className="font-semibold text-sm">UPI / QR settings</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {KEYS.map((k) => (
          <div key={k} className="space-y-1.5">
            <Label className="text-xs">{k}</Label>
            <div className="flex gap-1">
              <Input value={get(k)} onChange={(e) => setVals((p) => ({ ...p, [k]: e.target.value }))} />
              <Button size="sm" onClick={() => save(k, get(k))}>Save</Button>
            </div>
          </div>
        ))}
        <div className="space-y-1.5">
          <Label className="text-xs">Upload QR image</Label>
          <Input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadQr(e.target.files[0])} />
          {get("PREMIUM_QR_URL") && <img src={get("PREMIUM_QR_URL")} alt="QR" className="mt-1 max-w-[120px] rounded border border-border" />}
        </div>
      </div>
    </section>
  );
}
