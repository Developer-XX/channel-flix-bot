import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { formatAuthError, logAuthError } from "@/lib/auth-errors";
import { signInWithBotCheck, signUpWithBotCheck } from "@/lib/auth.functions";
import { linkGoogleAccountByEmail, logAuthEvent } from "@/lib/auth-events.functions";

type AuthMode = "signin" | "signup";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — StreamVault" },
      { name: "description", content: "Sign in, create an account, or reset your StreamVault password." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

// Only allow same-origin relative paths to prevent open redirects.
function safeRedirect(target: string | undefined): string {
  if (!target) return "/";
  try {
    // Allow simple relative paths starting with "/" but not "//".
    if (target.startsWith("/") && !target.startsWith("//")) return target;
    // Allow absolute URLs only when origin matches.
    const url = new URL(target, window.location.origin);
    if (url.origin === window.location.origin) return url.pathname + url.search + url.hash;
  } catch {
    /* fall through */
  }
  return "/";
}

function AuthPage() {
  // navigate intentionally omitted — we use window.location.replace so the
  // _authenticated guard re-evaluates with the freshly stored session.
  const search = Route.useSearch();
  const redirectTo = safeRedirect(search.redirect);
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [website, setWebsite] = useState("");
  const [startedAt, setStartedAt] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        // Already signed in — go to the originally requested URL.
        window.location.replace(redirectTo);
      }
    });
  }, [redirectTo]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setPassword("");
    setWebsite("");
    setStartedAt(Date.now());
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = mode === "signup"
        ? await signUpWithBotCheck({ data: { email, password, origin: window.location.origin, website, startedAt } })
        : await signInWithBotCheck({ data: { email, password, origin: window.location.origin, website, startedAt } });

      if (!result.ok) throw result.error;
      if (result.session) {
        const { error } = await supabase.auth.setSession({
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token,
        });
        if (error) throw error;
      }

      toast.success(mode === "signup" ? "Account created. You're signed in." : "Welcome back.");
      window.location.replace(redirectTo);
    } catch (error) {
      toast.error(formatAuthError(error));
      logAuthError("[auth]", error);
    } finally {
      setBusy(false);
    }
  };

  // Polls supabase.auth.getSession() for up to ~3s after Google OAuth so the
  // setSession() write inside the lovable module has a chance to propagate
  // to localStorage before we redirect through the _authenticated gate.
  const waitForSession = async (timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { data, error } = await supabase.auth.getSession();
      if (error) return { session: null, error: error as Error };
      if (data.session) return { session: data.session, error: null };
      await new Promise((r) => setTimeout(r, 150));
    }
    return { session: null, error: null };
  };

  const signInWithGoogle = async () => {
    setBusy(true);
    setSessionError(null);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        const msg = (result.error as Error)?.message ?? String(result.error);
        const failure_reason =
          /network|fetch/i.test(msg) ? "network_error" :
          /token/i.test(msg) ? "invalid_token" :
          "provider_error";
        await logAuthEvent({
          data: { action: "auth.google.failed", message: msg, failure_reason },
        }).catch(() => undefined);
        setSessionError(`Google sign-in failed: ${msg}`);
        toast.error(formatAuthError(result.error));
        logAuthError("[auth:google]", result.error);
        setBusy(false);
        return;
      }
      if (result.redirected) return;

      // Session-persistence check: poll briefly, then surface a clear error
      // if the session never landed in browser storage.
      const { session, error: sessionLookupError } = await waitForSession();
      if (sessionLookupError || !session) {
        const reason = sessionLookupError ? "provider_error" : "session_missing";
        const msg = sessionLookupError?.message ?? "Session was not persisted after OAuth";
        await logAuthEvent({
          data: { action: "auth.google.failed", message: msg, failure_reason: reason },
        }).catch(() => undefined);
        setSessionError(
          "Google sign-in completed but no session was saved in this browser. " +
          "This can happen if cookies or local storage are blocked. Please retry, " +
          "or try a different browser if the issue persists.",
        );
        toast.error("Session was not saved. See the banner above for details.");
        setBusy(false);
        return;
      }

      const userEmail = session.user.email ?? undefined;
      await logAuthEvent({ data: { action: "auth.google.success", email: userEmail } }).catch(() => undefined);
      // Best-effort account linking for users who previously signed up with email/password.
      linkGoogleAccountByEmail().catch((e) => logAuthError("[auth:google-link]", e));

      toast.success("Signed in with Google.");
      window.location.replace(redirectTo);
    } catch (error) {
      const msg = (error as Error)?.message ?? String(error);
      const failure_reason = /network|fetch/i.test(msg) ? "network_error" : "provider_error";
      await logAuthEvent({
        data: { action: "auth.google.failed", message: msg, failure_reason },
      }).catch(() => undefined);
      setSessionError(`Google sign-in error: ${msg}`);
      toast.error(formatAuthError(error));
      logAuthError("[auth:google]", error);
      setBusy(false);
    }
  };



  const title = mode === "signin" ? "Welcome back" : "Create your account";
  const description = mode === "signin"
    ? "Sign in to request titles and unlock downloads."
    : "Join the vault — it’s free.";

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-background">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2 font-display text-xl font-bold">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-primary glow-primary">
            <Film className="h-5 w-5 text-primary-foreground" />
          </span>
          StreamVault
        </Link>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-card">
          <h1 className="font-display text-2xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>

          <Button
            type="button"
            onClick={signInWithGoogle}
            disabled={busy}
            variant="outline"
            className="mt-6 w-full h-11 gap-2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1S8.7 6 12 6c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.4 14.7 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12S6.7 21.6 12 21.6c6.9 0 9.5-4.8 9.5-7.3 0-.5-.1-.9-.1-1.2H12z"/>
            </svg>
            {busy ? "Please wait…" : `Continue with Google`}
          </Button>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" aria-hidden="true" />
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-11 w-full rounded-md bg-surface px-3 text-sm outline-none border border-border focus:border-ring focus:ring-2 focus:ring-ring/40 transition" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Password</label>
              <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 h-11 w-full rounded-md bg-surface px-3 text-sm outline-none border border-border focus:border-ring focus:ring-2 focus:ring-ring/40 transition" />
            </div>
            <Button type="submit" disabled={busy} className="w-full h-11 bg-gradient-primary text-primary-foreground border-0 hover:opacity-90">
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="mt-6 space-y-3 text-center text-sm">
            <button onClick={() => switchMode(mode === "signin" ? "signup" : "signin")} className="block w-full text-muted-foreground hover:text-foreground transition-colors">
              {mode === "signin" ? "Need an account? Sign up" : "Back to sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
