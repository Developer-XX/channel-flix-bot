import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/debug/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Auth Debug" }, { name: "robots", content: "noindex" }] }),
  component: DebugAuth,
});

type Status = {
  hasSession: boolean;
  user: { id: string; email: string | null | undefined } | null;
  accessTokenPresent: boolean;
  refreshTokenPresent: boolean;
  accessTokenExpiresAt: string | null;
  accessTokenExpired: boolean | null;
  getUserOk: boolean;
  getUserError: string | null;
  storageKeys: string[];
  error: string | null;
};

function DebugAuth() {
  const [status, setStatus] = useState<Status | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const { data: s, error: sErr } = await supabase.auth.getSession();
      const { data: u, error: uErr } = await supabase.auth.getUser();
      const session = s.session;
      const exp = session?.expires_at ? new Date(session.expires_at * 1000) : null;
      const storageKeys = typeof localStorage !== "undefined"
        ? Object.keys(localStorage).filter((k) => k.includes("supabase") || k.startsWith("sb-"))
        : [];
      setStatus({
        hasSession: !!session,
        user: u.user ? { id: u.user.id, email: u.user.email } : null,
        accessTokenPresent: !!session?.access_token,
        refreshTokenPresent: !!session?.refresh_token,
        accessTokenExpiresAt: exp ? exp.toISOString() : null,
        accessTokenExpired: exp ? exp.getTime() < Date.now() : null,
        getUserOk: !uErr && !!u.user,
        getUserError: uErr?.message ?? null,
        storageKeys,
        error: sErr?.message ?? null,
      });
    } catch (e) {
      setStatus({
        hasSession: false, user: null, accessTokenPresent: false, refreshTokenPresent: false,
        accessTokenExpiresAt: null, accessTokenExpired: null, getUserOk: false,
        getUserError: null, storageKeys: [], error: (e as Error).message,
      });
    }
  };

  useEffect(() => {
    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => sub.subscription.unsubscribe();
  }, []);

  const doRefresh = async () => {
    setRefreshing(true);
    const { error } = await supabase.auth.refreshSession();
    if (error) alert(`Refresh failed: ${error.message}`);
    await load();
    setRefreshing(false);
  };

  const doSignOut = async () => {
    await supabase.auth.signOut();
    await load();
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="font-display text-2xl font-bold">Auth Debug</h1>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface">Reload</button>
          <button onClick={doRefresh} disabled={refreshing} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface">
            {refreshing ? "Refreshing…" : "Refresh session"}
          </button>
          <button onClick={doSignOut} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface">Sign out</button>
        </div>
        <pre className="overflow-auto rounded-lg border border-border bg-card p-4 text-xs">
{JSON.stringify(status, null, 2)}
        </pre>
        <p className="text-xs text-muted-foreground">
          Tip: sign in, then refresh this page. <code>hasSession</code> and <code>getUserOk</code> should stay true.
        </p>
      </div>
    </div>
  );
}
