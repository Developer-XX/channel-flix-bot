import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, XCircle, Loader2, ExternalLink, HelpCircle, Download, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getGoogleOAuthConfig,
  saveGoogleOAuthConfig,
  quickCheckGoogleOAuth,
  startFullOAuthTest,
  listGoogleOAuthHealth,
  exportGoogleOAuthHealthCsv,
  validateGoogleOAuthSetup,
  getGoogleOAuthSelfCheck,
  probeFullTokenExchange,
  smokeTestCallbackHandler,
} from "@/lib/google-oauth-admin.functions";

// Map a server error code to the OAuth flow step that failed.
const STEP_BY_CODE: Record<string, string> = {
  invalid_client_id_format: "Step 1 · Client ID format",
  discovery_failed: "Step 2 · Google discovery reachable",
  redirect_uri_mismatch: "Step 3 · Authorization endpoint (redirect URI)",
  invalid_client: "Step 3 · Authorization endpoint (client recognition)",
  exception: "Network / runtime",
  network_error: "Step 4 · Token exchange (network)",
  invalid_grant: "Step 4 · Token exchange (authorization code)",
  invalid_state: "Step 4 · Token exchange (state)",
  state_expired: "Step 4 · Token exchange (state expired)",
  missing_credentials: "Step 0 · Credentials saved",
};
function stepFor(code?: string | null) {
  if (!code) return "—";
  return STEP_BY_CODE[code] ?? `Other · ${code}`;
}


export const Route = createFileRoute("/_authenticated/admin/google-oauth")({
  component: GoogleOAuthAdminPage,
});

function GoogleOAuthAdminPage() {
  const getCfg = useServerFn(getGoogleOAuthConfig);
  const saveCfg = useServerFn(saveGoogleOAuthConfig);
  const quick = useServerFn(quickCheckGoogleOAuth);
  const startFull = useServerFn(startFullOAuthTest);
  const listLog = useServerFn(listGoogleOAuthHealth);
  const exportCsv = useServerFn(exportGoogleOAuthHealthCsv);
  const validateSetup = useServerFn(validateGoogleOAuthSetup);
  const selfCheck = useServerFn(getGoogleOAuthSelfCheck);
  const probeFull = useServerFn(probeFullTokenExchange);
  const [exporting, setExporting] = useState(false);
  const [probing, setProbing] = useState(false);


  const cfgQ = useQuery({ queryKey: ["google-oauth-config"], queryFn: () => getCfg() });
  const setupQ = useQuery({ queryKey: ["google-oauth-setup"], queryFn: () => validateSetup(), refetchInterval: 60_000 });
  const selfQ = useQuery({ queryKey: ["google-oauth-self-check"], queryFn: () => selfCheck(), refetchInterval: 60_000 });
  const logQ = useQuery({
    queryKey: ["google-oauth-health"],
    queryFn: () => listLog(),
    refetchInterval: 15_000,
  });

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [quickResult, setQuickResult] = useState<{ ok: boolean; message: string; latencyMs?: number } | null>(null);
  const [fullBusy, setFullBusy] = useState(false);

  // Hydrate the form once when config loads.
  const cfg = cfgQ.data;
  const hydrated = !!cfg && !!(clientId || clientSecret || redirectUri);
  if (cfg && !hydrated) {
    if (cfg.clientId) setClientId(cfg.clientId);
    if (cfg.redirectUri) setRedirectUri(cfg.redirectUri);
  }

  const defaultRedirect = typeof window !== "undefined" ? `${window.location.origin}/admin/google-oauth-callback` : "";

  async function onSave() {
    setSaving(true);
    try {
      await saveCfg({
        data: {
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          redirectUri: redirectUri.trim() || defaultRedirect,
        },
      });
      toast.success("Saved");
      setClientSecret("");
      cfgQ.refetch();
      setupQ.refetch();
      selfQ.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onProbeFull() {
    setProbing(true);
    try {
      const r = await probeFull();
      logQ.refetch();
      selfQ.refetch();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch (e: any) {
      toast.error(e?.message ?? "Probe failed");
    } finally {
      setProbing(false);
    }
  }

  async function onQuickCheck() {
    setChecking(true);
    setQuickResult(null);
    try {
      const r = await quick();
      setQuickResult(r);
      logQ.refetch();
      if (r.ok) toast.success("Quick check passed");
      else toast.error(r.message);
    } catch (e: any) {
      toast.error(e?.message ?? "Check failed");
    } finally {
      setChecking(false);
    }
  }

  async function onStartFull() {
    setFullBusy(true);
    try {
      const r = await startFull();
      sessionStorage.setItem("google-oauth-test-state", r.state);
      window.location.href = r.authUrl;
    } catch (e: any) {
      toast.error(e?.message ?? "Could not start OAuth test");
      setFullBusy(false);
    }
  }

  async function onExportCsv() {
    setExporting(true);
    try {
      const r = await exportCsv({ data: { days: 30 } });
      const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${r.rowCount} rows`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setExporting(false);
    }
  }


  return (
    <div className="p-4 sm:p-6 lg:p-10 max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <Link to="/admin">
          <Button size="sm" variant="ghost">
            <ArrowLeft className="h-3 w-3 mr-1" /> Admin
          </Button>
        </Link>
        <div className="ml-1 flex-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Google OAuth</h1>
          <p className="text-xs text-muted-foreground">Manage credentials and run health checks against Google's token exchange.</p>
        </div>
        <Link to="/admin/google-oauth-help">
          <Button size="sm" variant="outline"><HelpCircle className="h-3 w-3 mr-1" /> Setup help</Button>
        </Link>
      </div>

      {/* Credentials form */}
      <section className="mt-6 rounded-lg border border-border bg-card p-5 space-y-4">
        <h2 className="text-lg font-semibold">Credentials</h2>
        {cfg?.configured && (
          <div className="text-xs text-muted-foreground">
            Saved: <span className="font-mono">{cfg.clientSecretMasked}</span> · Updated {cfg.updatedAt ? new Date(cfg.updatedAt).toLocaleString() : "—"}
          </div>
        )}
        <div className="grid gap-3">
          <div>
            <Label>Client ID</Label>
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="123456789-abcdef.apps.googleusercontent.com"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div>
            <Label>Client Secret</Label>
            <Input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={cfg?.configured ? "Enter to replace existing secret" : "GOCSPX-..."}
              autoComplete="new-password"
              spellCheck={false}
            />
          </div>
          <div>
            <Label>Authorized Redirect URI</Label>
            <Input
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              placeholder={defaultRedirect}
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Add this exact URL to your OAuth client's <em>Authorized redirect URIs</em> in Google Cloud Console.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onSave} disabled={saving || !clientId || !clientSecret}>
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Save
            </Button>
            <Button variant="outline" onClick={() => setRedirectUri(defaultRedirect)} type="button">
              Use this app's URL
            </Button>
          </div>
        </div>
      </section>

      {/* Local diagnostics */}
      <DiagnosticsPanel clientId={clientId} clientSecret={clientSecret} redirectUri={redirectUri || defaultRedirect} latestError={logQ.data?.rows?.find((r: any) => r.status === "error") ?? null} />

      {/* Self-check report */}
      <SelfCheckReport
        data={selfQ.data}
        loading={selfQ.isFetching}
        onRetest={() => selfQ.refetch()}
      />

      {/* Setup gate banner */}
      {setupQ.data && !setupQ.data.enabled && (
        <section data-testid="oauth-setup-gate" className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive flex items-center gap-2">
            <XCircle className="h-4 w-4" /> Google OAuth is not ready
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Health checks are disabled until the saved configuration matches Google's requirements.
          </p>
          <ul className="mt-2 list-disc pl-5 text-xs space-y-1">
            {setupQ.data.problems.map((p, i) => (
              <li key={i}><span className="font-mono">[{p.field}]</span> {p.message}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Health checks */}

      <section className="mt-6 rounded-lg border border-border bg-card p-5 space-y-4">
        <h2 className="text-lg font-semibold">Health checks</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-md border border-border p-4 space-y-2">
            <div className="font-medium text-sm">Quick check</div>
            <p className="text-xs text-muted-foreground">
              Verifies the Client ID format, that Google's discovery endpoint is reachable, and that Google recognizes the Client ID + redirect URI. No consent screen.
            </p>
            <Button size="sm" onClick={onQuickCheck} disabled={checking || !setupQ.data?.enabled}>
              {checking && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Run quick check
            </Button>
            {quickResult && (
              <div
                data-testid={quickResult.ok ? "quick-check-ok" : "quick-check-error"}
                className={`text-xs rounded-md p-2 flex items-start gap-2 ${
                  quickResult.ok ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30" : "bg-destructive/10 text-destructive border border-destructive/30"
                }`}
              >
                {quickResult.ok ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5" /> : <XCircle className="h-3.5 w-3.5 mt-0.5" />}
                <div>
                  <div>{quickResult.message}</div>
                  {typeof quickResult.latencyMs === "number" && (
                    <div className="opacity-70 mt-0.5">{quickResult.latencyMs} ms</div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="rounded-md border border-border p-4 space-y-2">
            <div className="font-medium text-sm">Full token exchange</div>
            <p className="text-xs text-muted-foreground">
              Two modes: a <strong>safe probe</strong> validates Client ID + Secret + Redirect URI against Google's token endpoint without consent, or run the full consent-screen flow.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onProbeFull} disabled={probing || !setupQ.data?.enabled}>
                {probing && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Run safe probe
              </Button>
              <Button size="sm" variant="secondary" onClick={onStartFull} disabled={fullBusy || !setupQ.data?.enabled}>
                {fullBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                <ExternalLink className="h-3 w-3 mr-1" /> Full consent flow
              </Button>
            </div>
          </div>
        </div>
      </section>


      {/* History */}
      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-lg font-semibold">Recent health checks</h2>
          <Button size="sm" variant="outline" onClick={onExportCsv} disabled={exporting}>
            {exporting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
            Export CSV (30d)
          </Button>
        </div>
        {logQ.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {logQ.data?.rows?.length === 0 && (
          <div data-testid="oauth-health-empty" className="text-sm text-muted-foreground">No checks yet.</div>
        )}
        {logQ.data && logQ.data.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-3">When</th>
                  <th className="py-1 pr-3">Kind</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Latency</th>
                  <th className="py-1 pr-3">Failing step</th>
                  <th className="py-1">Detail</th>
                </tr>
              </thead>
              <tbody>
                {logQ.data.rows.map((r: any) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(r.checked_at).toLocaleString()}</td>
                    <td className="py-1.5 pr-3">{r.kind}</td>
                    <td className={`py-1.5 pr-3 ${r.status === "ok" ? "text-emerald-600" : "text-destructive"}`}>{r.status}</td>
                    <td className="py-1.5 pr-3">{r.latency_ms ?? "—"} ms</td>
                    <td className="py-1.5 pr-3 text-xs">{r.status === "ok" ? "—" : stepFor(r.error_code)}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">
                      {r.error_code ? <span className="font-mono">{r.error_code}</span> : null}
                      {r.error_message ? <span> · {r.error_message}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}

type DiagCheck = { label: string; ok: boolean | null; hint?: string };

function DiagnosticsPanel({
  clientId,
  clientSecret,
  redirectUri,
  latestError,
}: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  latestError: { error_code: string | null; error_message: string | null; checked_at: string } | null;
}) {
  const checks: DiagCheck[] = [
    {
      label: "Client ID format",
      ok: clientId ? /\.apps\.googleusercontent\.com$/i.test(clientId.trim()) : null,
      hint: "Must end with .apps.googleusercontent.com",
    },
    {
      label: "Client ID has numeric prefix",
      ok: clientId ? /^\d{6,}-/.test(clientId.trim()) : null,
      hint: "Google OAuth web clients start with the project number, e.g. 123456789-abc...",
    },
    {
      label: "Client Secret format",
      ok: clientSecret ? /^GOCSPX-[\w-]{10,}$/.test(clientSecret.trim()) : null,
      hint: "New Google secrets start with GOCSPX-. (Older legacy secrets are also accepted but won't pass this hint.)",
    },
    {
      label: "Redirect URI is HTTPS",
      ok: redirectUri ? /^https:\/\//i.test(redirectUri.trim()) : null,
      hint: "Google requires HTTPS for non-localhost redirect URIs.",
    },
    {
      label: "Redirect URI path is correct",
      ok: redirectUri ? /\/admin\/google-oauth-callback\/?$/.test(redirectUri.trim()) : null,
      hint: "Should end with /admin/google-oauth-callback",
    },
    {
      label: "No trailing whitespace",
      ok: clientId || clientSecret ? clientId.trim() === clientId && clientSecret.trim() === clientSecret : null,
      hint: "Copy-paste from Google Cloud Console can leave invisible whitespace.",
    },
  ];

  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> Diagnostics
        </h2>
        <span className="text-xs text-muted-foreground">Runs locally as you type — no network calls.</span>
      </div>
      <ul className="grid sm:grid-cols-2 gap-2">
        {checks.map((c) => (
          <li
            key={c.label}
            className={`flex items-start gap-2 rounded-md border p-2 text-xs ${
              c.ok === null
                ? "border-border text-muted-foreground"
                : c.ok
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                : "border-destructive/40 bg-destructive/5 text-destructive"
            }`}
          >
            {c.ok === null ? (
              <span className="h-3.5 w-3.5 mt-0.5 inline-block rounded-full border border-current opacity-50" />
            ) : c.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5 mt-0.5" />
            )}
            <div className="flex-1">
              <div className="font-medium text-foreground/90">{c.label}</div>
              {c.ok === false && c.hint && <div className="opacity-80 mt-0.5">{c.hint}</div>}
              {c.ok === null && <div className="opacity-60 mt-0.5">Fill in the field to validate</div>}
            </div>
          </li>
        ))}
      </ul>

      {latestError && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
          <div className="font-medium text-destructive">Last server-side failure</div>
          <div className="mt-1">
            <span className="font-mono">{latestError.error_code ?? "error"}</span> · {latestError.error_message ?? "(no message)"}
          </div>
          <div className="mt-1 text-muted-foreground">
            Failing step: <strong>{stepFor(latestError.error_code)}</strong> · {new Date(latestError.checked_at).toLocaleString()}
          </div>
        </div>
      )}
    </section>
  );
}


function StatusDot({ ok }: { ok: boolean | null | undefined }) {
  if (ok === true) return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (ok === false) return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  return <span className="h-2.5 w-2.5 inline-block rounded-full bg-muted" />;
}

function SelfCheckReport({
  data,
  loading,
  onRetest,
}: {
  data: any;
  loading: boolean;
  onRetest: () => void;
}) {
  const s = data?.sections;
  const rows: Array<{ key: string; label: string; ok: boolean | null; detail: React.ReactNode }> = s
    ? [
        {
          key: "config",
          label: "Saved configuration valid",
          ok: s.config.ok,
          detail: s.config.ok
            ? `Updated ${s.config.updatedAt ? new Date(s.config.updatedAt).toLocaleString() : "—"}`
            : (s.config.problems ?? []).map((p: any) => p.message).join(" · "),
        },
        {
          key: "callback",
          label: "Callback route ready",
          ok: s.callback.ok,
          detail: s.callback.ok
            ? `Path ${s.callback.expectedPath}`
            : `Expected ${s.callback.expectedPath}, got ${s.callback.actualPath ?? "—"}`,
        },
        {
          key: "discovery",
          label: "Google discovery reachable",
          ok: s.discovery.ok,
          detail: s.discovery.ok
            ? `HTTP ${s.discovery.status} · ${s.discovery.latencyMs}ms`
            : `${s.discovery.error ?? "unreachable"} (${s.discovery.latencyMs ?? "?"}ms)`,
        },
        {
          key: "latest",
          label: "Last health check",
          ok: s.latestHealth ? s.latestHealth.ok : null,
          detail: s.latestHealth
            ? `${s.latestHealth.kind} · ${new Date(s.latestHealth.checkedAt).toLocaleString()} · ${s.latestHealth.latencyMs ?? "?"}ms${s.latestHealth.errorCode ? ` · ${s.latestHealth.errorCode}` : ""}`
            : "No checks recorded yet",
        },
        {
          key: "cron",
          label: "Last cron run",
          ok: s.lastCron ? s.lastCron.ok : null,
          detail: s.lastCron
            ? `${new Date(s.lastCron.checkedAt).toLocaleString()} · ${s.lastCron.latencyMs ?? "?"}ms${s.lastCron.errorCode ? ` · ${s.lastCron.errorCode}` : ""}`
            : "Cron has not run yet",
        },
      ]
    : [];

  return (
    <section data-testid="oauth-self-check" className="mt-6 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Self-check report
          {data && (
            <span
              data-testid="oauth-self-check-overall"
              className={`text-xs rounded-full px-2 py-0.5 border ${
                data.overall === "ok"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-600"
              }`}
            >
              {data.overall === "ok" ? "All systems OK" : "Needs attention"}
            </span>
          )}
        </h2>
        <Button size="sm" variant="outline" onClick={onRetest} disabled={loading} data-testid="oauth-self-check-retest">
          {loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
          Re-test
        </Button>
      </div>
      {!data && <div className="text-sm text-muted-foreground">Loading…</div>}
      {data && (
        <ul className="grid sm:grid-cols-2 gap-2">
          {rows.map((r) => (
            <li
              key={r.key}
              data-testid={`oauth-self-check-${r.key}`}
              className="flex items-start gap-2 rounded-md border border-border p-2 text-xs"
            >
              <span className="mt-0.5"><StatusDot ok={r.ok} /></span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground/90">{r.label}</div>
                <div className="text-muted-foreground break-words">{r.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && (
        <div className="mt-3 text-[10px] text-muted-foreground">
          Generated {new Date(data.generatedAt).toLocaleString()}
        </div>
      )}
    </section>
  );
}
