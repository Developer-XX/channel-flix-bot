import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatAuthError, logAuthError } from "@/lib/auth-errors";
import { requestPasswordReset, signInWithBotCheck, signUpWithBotCheck } from "@/lib/auth.functions";

type AuthMode = "signin" | "signup" | "forgot";

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
      if (mode === "forgot") {
        const result = await requestPasswordReset({ data: { email, origin: window.location.origin, website, startedAt } });
        if (!result.ok) throw result.error;
        toast.success("Password reset link sent. Check your email for the one-time link.");
        switchMode("signin");
        return;
      }

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
      // Full reload guarantees the _authenticated gate re-evaluates with the fresh session.
      window.location.replace(redirectTo);
    } catch (error) {
      toast.error(formatAuthError(error));
      logAuthError("[auth]", error);
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "forgot" ? "Reset your password" : mode === "signin" ? "Welcome back" : "Create your account";
  const description = mode === "forgot"
    ? "Enter your email and we’ll send a one-time reset link."
    : mode === "signin"
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

          <form onSubmit={submit} className="mt-6 space-y-4">
            <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" aria-hidden="true" />
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-11 w-full rounded-md bg-surface px-3 text-sm outline-none border border-border focus:border-ring focus:ring-2 focus:ring-ring/40 transition" />
            </div>
            {mode !== "forgot" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Password</label>
                <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 h-11 w-full rounded-md bg-surface px-3 text-sm outline-none border border-border focus:border-ring focus:ring-2 focus:ring-ring/40 transition" />
              </div>
            )}
            <Button type="submit" disabled={busy} className="w-full h-11 bg-gradient-primary text-primary-foreground border-0 hover:opacity-90">
              {busy ? "Please wait…" : mode === "forgot" ? "Send reset link" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="mt-6 space-y-3 text-center text-sm">
            {mode === "signin" && (
              <button onClick={() => switchMode("forgot")} className="text-muted-foreground hover:text-foreground transition-colors">
                Forgot password?
              </button>
            )}
            <button onClick={() => switchMode(mode === "signin" ? "signup" : "signin")} className="block w-full text-muted-foreground hover:text-foreground transition-colors">
              {mode === "signin" ? "Need an account? Sign up" : "Back to sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
