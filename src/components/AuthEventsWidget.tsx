import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, RefreshCw } from "lucide-react";
import { getAuthEventsAnalytics, type AuthEventsAnalytics } from "@/lib/auth-events.functions";
import { Button } from "@/components/ui/button";

type Range = "24h" | "7d" | "30d";
type Provider = "all" | "email" | "google";

export function AuthEventsWidget() {
  const fn = useServerFn(getAuthEventsAnalytics);
  const [range, setRange] = useState<Range>("7d");
  const [provider, setProvider] = useState<Provider>("all");

  const q = useQuery({
    queryKey: ["admin-auth-events", range, provider],
    queryFn: () => fn({ data: { range, provider } } as never),
    refetchInterval: 60_000,
  });
  const a: AuthEventsAnalytics | undefined = q.data;

  const max = Math.max(
    1,
    ...((a?.timeseries ?? []).map((b) =>
      b.signin_success + b.signin_failed + b.signup_success + b.signup_failed + b.google_success + b.google_failed + b.signout,
    )),
  );

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-semibold">Authentication events</h2>
          {a && (
            <span className="text-[11px] text-muted-foreground">
              · updated {new Date(a.generatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="all">All providers</option>
            <option value="email">Email / password</option>
            <option value="google">Google</option>
          </select>
          <Button size="sm" variant="ghost" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      {q.error && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {(q.error as Error).message}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Tile label="Sign-in OK" value={a?.totals.signinSuccess} tone="ok" />
        <Tile label="Sign-in fail" value={a?.totals.signinFailed} tone="fail" />
        <Tile label="Sign-up OK" value={a?.totals.signupSuccess} tone="ok" />
        <Tile label="Sign-up fail" value={a?.totals.signupFailed} tone="fail" />
        <Tile label="Google OK" value={a?.totals.googleSuccess} tone="ok" />
        <Tile label="Google fail" value={a?.totals.googleFailed} tone="fail" />
        <Tile label="Sign-outs" value={a?.totals.signout} tone="muted" />
      </div>

      {/* Timeseries bars (stacked-ish via sum) */}
      <div className="mt-4">
        <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
          Events over time ({range === "24h" ? "hourly" : "daily"})
        </p>
        {(!a || a.timeseries.length === 0) ? (
          <p className="text-xs text-muted-foreground">No events in this range.</p>
        ) : (
          <div className="flex h-32 items-end gap-1">
            {a.timeseries.map((b) => {
              const okTotal = b.signin_success + b.signup_success + b.google_success;
              const failTotal = b.signin_failed + b.signup_failed + b.google_failed;
              const total = okTotal + failTotal + b.signout;
              const heightOk = (okTotal / max) * 100;
              const heightFail = (failTotal / max) * 100;
              const heightOut = (b.signout / max) * 100;
              return (
                <div key={b.bucket} className="flex flex-1 flex-col items-center justify-end" title={`${b.bucket}\nOK ${okTotal} · Fail ${failTotal} · Out ${b.signout}`}>
                  <div className="flex w-full max-w-[20px] flex-col-reverse">
                    <div className="bg-emerald-500/80" style={{ height: `${heightOk}%` }} />
                    <div className="bg-red-500/80" style={{ height: `${heightFail}%` }} />
                    <div className="bg-muted-foreground/40" style={{ height: `${heightOut}%` }} />
                  </div>
                  <span className="mt-1 text-[9px] text-muted-foreground">{total || ""}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 bg-emerald-500/80" /> Success</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 bg-red-500/80" /> Failure</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 bg-muted-foreground/40" /> Sign-out</span>
        </div>
      </div>

      {/* Failures by reason */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Failures by reason
          </p>
          {(a?.failuresByReason ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No failures recorded.</p>
          ) : (
            <ul className="space-y-1">
              {a!.failuresByReason.map((row) => (
                <li key={row.reason} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-foreground">{row.reason}</span>
                  <span className="tabular-nums text-muted-foreground">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Recent failures
          </p>
          {(a?.recentFailures ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No recent failures.</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-auto pr-1">
              {a!.recentFailures.slice(0, 8).map((row) => (
                <li key={row.id} className="text-[11px] text-muted-foreground">
                  <span className="mr-1 text-foreground">{row.action.replace("auth.", "")}</span>
                  <span className="font-mono">{row.failure_reason ?? "unknown"}</span>
                  {row.actor_email && <span className="ml-1">· {row.actor_email}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function Tile({ label, value, tone }: { label: string; value: number | undefined; tone: "ok" | "fail" | "muted" }) {
  const color =
    tone === "ok" ? "text-emerald-500" : tone === "fail" ? "text-red-500" : "text-muted-foreground";
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-display text-lg font-bold tabular-nums ${color}`}>
        {value ?? "—"}
      </div>
    </div>
  );
}
