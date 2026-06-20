import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, XCircle, Loader2, ExternalLink, HelpCircle, Download, AlertCircle } from "lucide-react";
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
  const [exporting, setExporting] = useState(false);


  const cfgQ = useQuery({ queryKey: ["google-oauth-config"], queryFn: () => getCfg() });
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
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
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

      {/* Health checks */}

      <section className="mt-6 rounded-lg border border-border bg-card p-5 space-y-4">
        <h2 className="text-lg font-semibold">Health checks</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-md border border-border p-4 space-y-2">
            <div className="font-medium text-sm">Quick check</div>
            <p className="text-xs text-muted-foreground">
              Verifies the Client ID format, that Google's discovery endpoint is reachable, and that Google recognizes the Client ID + redirect URI. No consent screen.
            </p>
            <Button size="sm" onClick={onQuickCheck} disabled={checking || !cfg?.configured}>
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
              Opens Google's consent screen and completes a real authorization-code exchange against the saved Client Secret. Most accurate test.
            </p>
            <Button size="sm" variant="secondary" onClick={onStartFull} disabled={fullBusy || !cfg?.configured}>
              {fullBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              <ExternalLink className="h-3 w-3 mr-1" /> Run full OAuth test
            </Button>
          </div>
        </div>
      </section>

      {/* History */}
      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold mb-3">Recent health checks</h2>
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
