import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeFullOAuthTest } from "@/lib/google-oauth-admin.functions";
import { z } from "zod";

const SearchSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/admin/google-oauth-callback")({
  component: CallbackPage,
  validateSearch: (s) => SearchSchema.parse(s),
});

function CallbackPage() {
  const search = useSearch({ from: "/_authenticated/admin/google-oauth-callback" });
  const complete = useServerFn(completeFullOAuthTest);
  const [result, setResult] = useState<
    | { status: "pending" }
    | { status: "ok"; message: string; latencyMs?: number }
    | { status: "error"; message: string; errorCode?: string }
  >({ status: "pending" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (search.error) {
        setResult({
          status: "error",
          message: `Google returned an error: ${search.error_description ?? search.error}`,
          errorCode: search.error,
        });
        return;
      }
      if (!search.code || !search.state) {
        setResult({ status: "error", message: "Missing code or state in callback URL." });
        return;
      }
      const expectedState = sessionStorage.getItem("google-oauth-test-state");
      if (expectedState && expectedState !== search.state) {
        setResult({ status: "error", message: "State token mismatch — possible CSRF. Aborting." });
        return;
      }
      try {
        const r = await complete({ data: { code: search.code, state: search.state } });
        if (cancelled) return;
        sessionStorage.removeItem("google-oauth-test-state");
        if (r.ok) setResult({ status: "ok", message: r.message, latencyMs: r.latencyMs });
        else setResult({ status: "error", message: r.message, errorCode: r.errorCode });
      } catch (e: any) {
        if (!cancelled) setResult({ status: "error", message: e?.message ?? "Token exchange failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search.code, search.state, search.error, search.error_description, complete]);

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold font-display mb-2">Google OAuth test</h1>
      {result.status === "pending" && (
        <div className="rounded-md border border-border bg-card p-5 flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Exchanging authorization code with Google…
        </div>
      )}
      {result.status === "ok" && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 p-5">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-5 w-5 mt-0.5" />
            <div>
              <div className="font-semibold">Success</div>
              <div className="text-sm">{result.message}</div>
              {typeof result.latencyMs === "number" && (
                <div className="text-xs opacity-70 mt-1">Round trip: {result.latencyMs} ms</div>
              )}
            </div>
          </div>
        </div>
      )}
      {result.status === "error" && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-destructive p-5">
          <div className="flex items-start gap-2">
            <XCircle className="h-5 w-5 mt-0.5" />
            <div>
              <div className="font-semibold">OAuth test failed</div>
              <div className="text-sm">{result.message}</div>
              {result.errorCode && <div className="text-xs font-mono opacity-70 mt-1">code: {result.errorCode}</div>}
            </div>
          </div>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Link to="/admin/google-oauth"><Button variant="outline" size="sm">Back to Google OAuth settings</Button></Link>
        <Link to="/admin/google-oauth-help"><Button variant="ghost" size="sm">Setup help</Button></Link>
      </div>
    </div>
  );
}
