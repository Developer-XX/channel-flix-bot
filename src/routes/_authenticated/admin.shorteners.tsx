import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw, Link2, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getShortenerReport, updateShortenerConfig } from "@/lib/shortener-admin.functions";

export const Route = createFileRoute("/_authenticated/admin/shorteners")({
  component: AdminShortenersPage,
});

function AdminShortenersPage() {
  const fn = useServerFn(getShortenerReport);
  const update = useServerFn(updateShortenerConfig);
  const q = useQuery({ queryKey: ["shortener-report"], queryFn: () => fn(), refetchInterval: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);

  const patch = async (provider: string, body: Record<string, unknown>) => {
    setBusy(provider);
    try {
      await update({ data: { provider, ...body } } as never);
      toast.success("Saved");
      await q.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Link2 className="h-6 w-6" /> Shortener performance
        </h1>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          <RefreshCw className={`h-4 w-4 mr-1 ${q.isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Per-provider success rate and latency for token verification. Toggle providers off to take them
        out of the rotation immediately; lower priority numbers go first.
      </p>

      {q.error ? (
        <div
          data-testid="shortener-error-state"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <div className="font-semibold">Could not load shortener report</div>
          <div className="mt-1 text-xs opacity-90 break-all">
            {(q.error as Error).message}
          </div>
          <div className="mt-2 text-xs opacity-80">
            This is a backend error — the query failed. Check the admin error log.
          </div>
        </div>
      ) : !q.isLoading && (q.data?.providers.length ?? 0) === 0 ? (
        <div
          data-testid="shortener-empty-state"
          className="rounded-md border border-border bg-muted/30 p-4 text-sm"
        >
          <div className="font-semibold">No shortener providers configured</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Add rows to <code>shortener_configs</code> to start rotating providers.
          </div>
        </div>
      ) : !q.isLoading && (q.data?.sampleCount ?? 0) === 0 ? (
        <div
          data-testid="shortener-empty-state"
          className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
        >
          <div className="font-semibold text-amber-600 dark:text-amber-400">
            No health samples in the last 30 days
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Providers are listed below but success rate, latency, and attempt
            counts will stay blank until <code>shortener_health_log</code>
            receives entries (run a token verification, then refresh).
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {q.data?.providers.map((p: any) => (
          <div key={p.provider} className="rounded-md border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{p.provider}</div>
              <Button
                size="sm"
                variant={p.enabled ? "default" : "outline"}
                disabled={busy === p.provider}
                onClick={() => patch(p.provider, { enabled: !p.enabled })}
              >
                {p.enabled ? <><ToggleRight className="h-4 w-4 mr-1" /> Enabled</> : <><ToggleLeft className="h-4 w-4 mr-1" /> Disabled</>}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="Success (7d)" value={p.successRate7 != null ? `${p.successRate7}%` : "—"} />
              <Stat label="Success (30d)" value={p.successRate30 != null ? `${p.successRate30}%` : "—"} />
              <Stat label="Avg latency 7d" value={p.avgLatencyMs7 != null ? `${p.avgLatencyMs7}ms` : "—"} />
              <Stat label="Avg latency 30d" value={p.avgLatencyMs30 != null ? `${p.avgLatencyMs30}ms` : "—"} />
              <Stat label="Attempts 7d" value={String(p.attempts7)} testId="shortener-attempts-7d" />
              <Stat label="Attempts 30d" value={String(p.attempts30)} testId="shortener-attempts-30d" />
            </div>


            <div className="flex items-end gap-2">
              <label className="text-xs flex-1">
                Priority
                <Input
                  type="number"
                  defaultValue={p.priority}
                  className="mt-1"
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== p.priority) patch(p.provider, { priority: v });
                  }}
                />
              </label>
              <label className="text-xs flex-1">
                Weight
                <Input
                  type="number"
                  defaultValue={p.weight}
                  className="mt-1"
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== p.weight) patch(p.provider, { weight: v });
                  }}
                />
              </label>
            </div>

            {p.lastFailure && (
              <div className="text-xs text-destructive break-all">
                Last failure {new Date(p.lastFailure.at).toLocaleString()}: {p.lastFailure.error ?? "(no message)"}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
