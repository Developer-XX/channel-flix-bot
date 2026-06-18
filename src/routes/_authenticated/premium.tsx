import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Crown, Upload, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getPremiumConfig, getMyPremiumStatus, submitPremiumPayment } from "@/lib/premium.functions";

export const Route = createFileRoute("/_authenticated/premium")({
  component: PremiumPage,
});

function PremiumPage() {
  const cfg = useServerFn(getPremiumConfig);
  const status = useServerFn(getMyPremiumStatus);
  const submit = useServerFn(submitPremiumPayment);
  const cfgQ = useQuery({ queryKey: ["premium-config"], queryFn: () => cfg(), retry: false });
  const statusQ = useQuery({ queryKey: ["premium-status"], queryFn: () => status(), retry: false });

  const [planId, setPlanId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);

  const c = cfgQ.data;
  const s = statusQ.data;
  const plan = c?.plans.find((p) => p.id === planId) ?? c?.plans[0] ?? null;

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!plan) throw new Error("Select a plan");
      if (!file) throw new Error("Upload payment screenshot");
      setUploading(true);
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const ext = file.name.split(".").pop() || "png";
      const path = `${u.user.id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from("payment-proofs").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      await submit({ data: { planId: plan.id, screenshotPath: path, userNote: note || null } });
    },
    onSuccess: () => {
      toast.success("Payment submitted — pending admin approval");
      setFile(null); setNote("");
      statusQ.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setUploading(false),
  });

  return (
    <div className="min-h-screen pt-20 pb-16 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <Crown className="h-6 w-6 text-amber-400" />
          <h1 className="text-2xl font-bold">Go Premium</h1>
        </div>

        {s?.isPremium && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
            <div className="font-semibold flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> You are Premium</div>
            <div className="text-muted-foreground text-xs mt-1">
              Plan: <span className="font-mono">{s.planName ?? "active"}</span>
              {s.premiumUntil && <> · expires {new Date(s.premiumUntil).toLocaleString()}</>}
            </div>
            <p className="text-xs mt-2">Token verification is skipped automatically for all downloads.</p>
          </div>
        )}

        {!c?.enabled && (
          <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
            Premium is currently disabled.
          </div>
        )}

        {c?.enabled && (
          <>
            <section className="grid gap-3 sm:grid-cols-3">
              {c.plans.map((p) => {
                const selected = (planId ?? c.plans[0]?.id) === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setPlanId(p.id)}
                    className={`text-left rounded-xl border p-4 transition ${selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-surface"}`}
                  >
                    <div className="text-sm font-semibold">{p.name}</div>
                    <div className="text-2xl font-bold mt-1">₹{p.price_inr}</div>
                    <div className="text-[11px] text-muted-foreground">{p.duration_days} days</div>
                    {p.description && <div className="text-xs text-muted-foreground mt-2">{p.description}</div>}
                  </button>
                );
              })}
            </section>

            <section className="rounded-xl border border-border p-4 space-y-3">
              <h2 className="font-semibold">How to pay</h2>
              {c.instructions && <p className="text-xs text-muted-foreground whitespace-pre-line">{c.instructions}</p>}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  {c.qrUrl ? (
                    <img src={c.qrUrl} alt="UPI QR" className="rounded-md border border-border max-w-[240px]" />
                  ) : (
                    <div className="rounded-md border border-dashed border-border p-6 text-xs text-muted-foreground">QR not configured yet</div>
                  )}
                </div>
                <div className="space-y-2 text-sm">
                  <div><span className="text-muted-foreground text-xs">UPI ID</span><div className="font-mono">{c.upiId ?? "—"}</div></div>
                  <div><span className="text-muted-foreground text-xs">Payee</span><div>{c.upiName ?? "—"}</div></div>
                  {plan && <div><span className="text-muted-foreground text-xs">Amount</span><div className="font-semibold">₹{plan.price_inr} ({plan.duration_days} days)</div></div>}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-border p-4 space-y-3">
              <h2 className="font-semibold">Upload payment screenshot</h2>
              <div className="space-y-1.5">
                <Label className="text-xs">Screenshot (image)</Label>
                <Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Note (optional)</Label>
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Transaction ID, UPI ref, etc." />
              </div>
              <Button onClick={() => submitMut.mutate()} disabled={!file || !plan || uploading || submitMut.isPending}>
                <Upload className="h-4 w-4 mr-1.5" />
                {uploading || submitMut.isPending ? "Submitting…" : "Submit for review"}
              </Button>
            </section>
          </>
        )}

        <section className="rounded-xl border border-border p-4 space-y-2">
          <h2 className="font-semibold text-sm">My recent payments</h2>
          {(!s?.payments || s.payments.length === 0) && <p className="text-xs text-muted-foreground">No payments yet.</p>}
          <ul className="space-y-1.5 text-xs">
            {s?.payments?.map((p: any) => (
              <li key={p.id} className="flex items-center gap-2 border-t border-border/50 pt-1.5">
                {p.status === "pending" && <Clock className="h-3.5 w-3.5 text-amber-500" />}
                {p.status === "approved" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                {p.status === "rejected" && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                <span>{p.plan_name} · ₹{p.amount_inr}</span>
                <span className="ml-auto text-muted-foreground">{new Date(p.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="text-center">
          <Link to="/" className="text-xs text-primary">← Back home</Link>
        </div>
      </div>
    </div>
  );
}
