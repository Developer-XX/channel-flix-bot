import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Activity } from "lucide-react";
import { getOnboardingSeries } from "@/lib/onboarding-analytics.functions";

export function OnboardingChart() {
  const [bucket, setBucket] = useState<"day" | "week">("day");
  const [range, setRange] = useState(30);
  const fetcher = useServerFn(getOnboardingSeries);
  const q = useQuery({
    queryKey: ["onboarding-series", bucket, range],
    queryFn: () => fetcher({ data: { bucket, rangeDays: range } }),
    retry: false,
  });
  const series = q.data?.series ?? [];

  return (
    <section className="rounded-md border border-border p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="font-semibold text-sm">Onboarding tutorial — opens · completions · skipped</h2>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <div className="flex gap-1">
            {([["day","Day"],["week","Week"]] as const).map(([v,l]) => (
              <Button key={v} size="sm" variant={bucket === v ? "default" : "outline"} onClick={() => setBucket(v)}>{l}</Button>
            ))}
          </div>
          <div className="flex gap-1 ml-2">
            {[7, 30, 90].map((d) => (
              <Button key={d} size="sm" variant={range === d ? "default" : "outline"} onClick={() => setRange(d)}>{d}d</Button>
            ))}
          </div>
        </div>
      </div>
      {q.error && <p className="text-xs text-destructive">{(q.error as Error).message}</p>}
      {!q.isLoading && series.length === 0 && (
        <p className="text-xs text-muted-foreground">No events in this window yet.</p>
      )}
      {series.length > 0 && (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 6, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--background))", border: "1px solid hsl(var(--border))",
                  borderRadius: 8, fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="opened"    stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="completed" stroke="#22c55e"            strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="skipped"   stroke="#f59e0b"            strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
