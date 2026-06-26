import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from "recharts";
import { Send, MousePointerClick } from "lucide-react";
import { getEngagementSummary } from "@/lib/engagement-analytics.functions";

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function EngagementWidget() {
  const fetcher = useServerFn(getEngagementSummary);
  const q = useQuery({
    queryKey: ["engagement-summary"],
    queryFn: () => fetcher(),
    refetchInterval: 60_000,
    retry: false,
  });
  const data = q.data;

  return (
    <section className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <MousePointerClick className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm">
          Support popup & Download preflight — last 24h
        </h2>
        <span className="ml-auto text-[11px] text-muted-foreground">7-day chart below</span>
      </div>

      {q.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {q.error && (
        <p className="text-xs text-destructive">{(q.error as Error).message}</p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <Stat
              label="Support popup"
              primary={`${data.totals.supportPopupImpressions} views`}
              secondary={`${data.totals.supportPopupJoinClicks} joins (${pct(data.rates.supportJoinRate)})`}
              icon={<Send className="h-3 w-3 text-[#229ED9]" />}
            />
            <Stat
              label="Preflight verify"
              primary={`${data.totals.preflightImpressions} views`}
              secondary={`${data.totals.preflightVerifyClicks} verify (${pct(data.rates.preflightVerifyRate)})`}
            />
            <Stat
              label="Preflight join"
              primary={`${data.totals.preflightJoinClicks} joins`}
              secondary={`${pct(data.rates.preflightJoinRate)} of views`}
            />
          </div>

          {data.daily.length > 0 && (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.daily} margin={{ top: 6, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="support_impr"     name="Support views"    stroke="#229ED9" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="support_join"     name="Support joins"    stroke="#0d6fa1" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="preflight_impr"   name="Preflight views"  stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="preflight_verify" name="Verify clicks"    stroke="#22c55e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="preflight_join"   name="Join clicks"      stroke="#f59e0b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {data.daily.length === 0 && (
            <p className="text-xs text-muted-foreground">No engagement events yet.</p>
          )}
        </>
      )}
    </section>
  );
}

function Stat({
  label, primary, secondary, icon,
}: { label: string; primary: string; secondary: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface/40 p-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className="font-semibold mt-0.5">{primary}</div>
      <div className="text-[11px] text-muted-foreground">{secondary}</div>
    </div>
  );
}
