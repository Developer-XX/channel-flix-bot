import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatAuthError, logAuthError } from "@/lib/auth-errors";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset password — StreamVault" },
      { name: "description", content: "Set a new StreamVault password from your one-time reset link." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const type = hash.get("type");

    (async () => {
      try {
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (error) throw error;
          window.history.replaceState(null, "", window.location.pathname);
        }
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user || (type && type !== "recovery")) throw error ?? new Error("Invalid or expired reset link");
        setReady(true);
      } catch (error) {
        toast.error(formatAuthError(error, "Invalid or expired reset link"));
        logAuthError("[reset-password]", error);
        navigate({ to: "/auth" });
      }
    })();
  }, [navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated. Please sign in with your new password.");
      await supabase.auth.signOut();
      navigate({ to: "/auth" });
    } catch (error) {
      toast.error(formatAuthError(error, "Password update failed"));
      logAuthError("[reset-password]", error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-4 bg-background">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2 font-display text-xl font-bold">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-primary glow-primary"><Film className="h-5 w-5 text-primary-foreground" /></span>
          StreamVault
        </Link>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-card">
          <h1 className="font-display text-2xl font-bold">Set a new password</h1>
          <p className="mt-1 text-sm text-muted-foreground">This one-time reset link expires automatically.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">New password</label>
              <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 h-11 w-full rounded-md bg-surface px-3 text-sm outline-none border border-border focus:border-ring focus:ring-2 focus:ring-ring/40 transition" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Confirm password</label>
              <input type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-1 h-11 w-full rounded-md bg-surface px-3 text-sm outline-none border border-border focus:border-ring focus:ring-2 focus:ring-ring/40 transition" />
            </div>
            <Button type="submit" disabled={!ready || busy} className="w-full h-11 bg-gradient-primary text-primary-foreground border-0 hover:opacity-90">
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}