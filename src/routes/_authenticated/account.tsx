import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Crown, Send, RefreshCw, Copy, ExternalLink, ShieldCheck, Clock, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import {
  getMyTelegramLink,
  requestLinkCode,
  unlinkTelegram,
} from "@/lib/downloads.functions";
import { getMyPremiumStatus } from "@/lib/premium.functions";
import { getVerificationStatus } from "@/lib/verification.functions";

export const Route = createFileRoute("/_authenticated/account")({
  component: AccountPage,
});

function useNowTick(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function AccountPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      setEmail(u.user.email ?? "");
      const { data: p } = await supabase.from("profiles").select("display_name").eq("id", u.user.id).maybeSingle();
      setDisplayName(p?.display_name ?? "");
    })();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setBusy(false); return; }
    const { error } = await supabase.from("profiles").upsert({ id: u.user.id, display_name: displayName });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Profile updated");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1 pt-24 pb-16">
        <div className="mx-auto max-w-2xl px-4 md:px-6 space-y-6">
          <h1 className="font-display text-3xl md:text-4xl font-bold">Your account</h1>

          <PremiumCard />
          <TelegramLinkCard />
          <VerificationCard />

          <Link to="/account/downloads" className="block rounded-xl border border-border bg-surface/40 p-4 hover:bg-surface/60 transition-colors">
            <div className="flex items-center gap-3">
              <Send className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <div className="font-medium text-sm">Download history</div>
                <div className="text-xs text-muted-foreground">See your sent files, resend with cooldown protection</div>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </div>
          </Link>

          <section className="rounded-xl border border-border bg-surface/40 p-5">
            <h2 className="font-display text-lg font-semibold">Profile</h2>
            <form onSubmit={save} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <input value={email} disabled className="mt-1 h-11 w-full rounded-md bg-surface px-3 text-sm border border-border opacity-60" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Display name</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={80}
                  className="mt-1 h-11 w-full rounded-md bg-surface px-3 text-sm outline-none border border-border focus:border-ring focus:ring-2 focus:ring-ring/40 transition"
                />
              </div>
              <div className="flex gap-3">
                <Button type="submit" disabled={busy} className="bg-gradient-primary text-primary-foreground border-0">
                  {busy ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    navigate({ to: "/" });
                  }}
                >
                  Sign out
                </Button>
              </div>
            </form>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function PremiumCard() {
  const fn = useServerFn(getMyPremiumStatus);
  const q = useQuery({ queryKey: ["my-premium"], queryFn: () => fn(), retry: false });
  const now = useNowTick(1000);
  const premiumUntil = q.data?.premiumUntil ? new Date(q.data.premiumUntil).getTime() : null;
  const remaining = premiumUntil != null ? premiumUntil - now : null;
  const isActive = !!q.data?.isPremium && (remaining == null || remaining > 0);

  return (
    <section className="rounded-xl border border-border bg-surface/40 p-5">
      <div className="flex items-center gap-2">
        <Crown className={`h-5 w-5 ${isActive ? "text-amber-400" : "text-muted-foreground"}`} />
        <h2 className="font-display text-lg font-semibold">Premium status</h2>
      </div>
      {q.isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : isActive ? (
        <div className="mt-3 space-y-1.5">
          <div className="text-sm">
            <span className="text-muted-foreground">Plan:</span>{" "}
            <span className="font-medium">{q.data?.planName ?? "Premium"}</span>
          </div>
          {premiumUntil ? (
            <>
              <div className="text-sm">
                <span className="text-muted-foreground">Expires on:</span>{" "}
                <span className="font-medium">{new Date(premiumUntil).toLocaleString()}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Time remaining:</span>{" "}
                <span className="font-mono font-medium text-amber-400">{formatRemaining(remaining ?? 0)}</span>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Lifetime access</div>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-muted-foreground">
            You're on the free plan. Premium removes ads and skips verification.
          </p>
          <Link to="/premium">
            <Button size="sm" className="bg-gradient-primary text-primary-foreground border-0">
              <Crown className="h-3.5 w-3.5 mr-1" /> Upgrade
            </Button>
          </Link>
        </div>
      )}
    </section>
  );
}

function TelegramLinkCard() {
  const linkFn = useServerFn(getMyTelegramLink);
  const codeFn = useServerFn(requestLinkCode);
  const unlinkFn = useServerFn(unlinkTelegram);
  const q = useQuery({ queryKey: ["my-tg-link"], queryFn: () => linkFn(), retry: false });
  const now = useNowTick(1000);
  const [working, setWorking] = useState(false);

  const link = q.data?.link;
  const botUsername = q.data?.botUsername;
  const codeExpires = link?.link_code_expires_at ? new Date(link.link_code_expires_at).getTime() : null;
  const codeValid = !!(link?.link_code && codeExpires && codeExpires > now);
  const isLinked = !!link?.telegram_user_id;

  async function relink() {
    setWorking(true);
    try {
      const res = await codeFn();
      toast.success("New link code generated");
      // refetch to pull the new code into the card
      await q.refetch();
      // best-effort open bot
      if (res.botUsername) {
        window.open(`https://t.me/${res.botUsername}?start=link_${res.code}`, "_blank", "noopener,noreferrer");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't generate code");
    } finally {
      setWorking(false);
    }
  }

  async function unlink() {
    if (!confirm("Unlink your Telegram account?")) return;
    setWorking(true);
    try {
      await unlinkFn();
      toast.success("Unlinked");
      q.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface/40 p-5">
      <div className="flex items-center gap-2">
        <Send className="h-5 w-5 text-primary" />
        <h2 className="font-display text-lg font-semibold">Telegram delivery</h2>
      </div>

      {q.isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : isLinked ? (
        <div className="mt-3 space-y-3">
          <div className="text-sm">
            Linked to{" "}
            <span className="font-medium">
              {link?.telegram_first_name ?? link?.telegram_username ?? "Telegram user"}
            </span>{" "}
            {link?.telegram_username && (
              <span className="text-muted-foreground">@{link.telegram_username}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            If a recent delivery didn't arrive, generate a fresh code and re-link the bot.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={relink} disabled={working}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${working ? "animate-spin" : ""}`} />
              Relink &amp; retry
            </Button>
            <Button size="sm" variant="ghost" onClick={unlink} disabled={working}>Unlink</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            Link your Telegram account so the bot can DM your downloads.
          </p>
          {codeValid ? (
            <CodeBlock code={link!.link_code!} botUsername={botUsername} expiresInMs={codeExpires! - now} />
          ) : (
            <Button size="sm" onClick={relink} disabled={working}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${working ? "animate-spin" : ""}`} />
              Generate link code
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function CodeBlock({ code, botUsername, expiresInMs }: { code: string; botUsername?: string | null; expiresInMs: number }) {
  const tgUrl = botUsername ? `https://t.me/${botUsername}?start=link_${code}` : null;
  return (
    <div className="rounded-md border border-border bg-surface/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Your code</div>
      <div className="font-mono text-2xl font-bold tracking-widest">{code}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">
        Expires in {formatRemaining(expiresInMs)}
      </div>
      <div className="flex gap-2 mt-2">
        {tgUrl && (
          <Button size="sm" asChild>
            <a href={tgUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open bot
            </a>
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(`/start link_${code}`);
            toast.success("Command copied");
          }}
        >
          <Copy className="h-3.5 w-3.5 mr-1" /> Copy command
        </Button>
      </div>
    </div>
  );
}

function VerificationCard() {
  const fn = useServerFn(getVerificationStatus);
  const q = useQuery({ queryKey: ["my-verification"], queryFn: () => fn(), retry: false, refetchInterval: 15000 });
  const now = useNowTick(1000);

  if (q.isLoading) {
    return (
      <section className="rounded-xl border border-border bg-surface/40 p-5">
        <h2 className="font-display text-lg font-semibold">Verification</h2>
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      </section>
    );
  }

  const v = q.data;
  const expires = v?.expiresAt ? new Date(v.expiresAt).getTime() : null;
  const remaining = expires ? expires - now : 0;
  const isPremium = !!v?.premium;
  const verified = !!v?.verified;

  return (
    <section className="rounded-xl border border-border bg-surface/40 p-5">
      <div className="flex items-center gap-2">
        {verified ? (
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-amber-400" />
        )}
        <h2 className="font-display text-lg font-semibold">Download verification</h2>
      </div>

      {isPremium ? (
        <p className="mt-3 text-sm text-emerald-400">
          Premium — verification is bypassed.
        </p>
      ) : verified ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-emerald-400">Verified ✓</p>
          {expires && (
            <div className="text-sm">
              <span className="text-muted-foreground">Active for the next</span>{" "}
              <span className="font-mono font-medium">
                <Clock className="inline h-3.5 w-3.5 mr-0.5 -mt-0.5" />
                {formatRemaining(remaining)}
              </span>
            </div>
          )}
          {(v?.graceRemainingMs ?? 0) > 0 && (
            <p className="text-[11px] text-muted-foreground">
              You're inside the new-user grace window.
            </p>
          )}
          {v?.lastProvider && v.lastProvider !== "premium" && (
            <p className="text-[11px] text-muted-foreground">Last verified via {v.lastProvider}.</p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-amber-400">Not verified yet.</p>
          <p className="text-xs text-muted-foreground">
            Click Download on any title and complete one shortener link to unlock downloads for 24 hours.
          </p>
        </div>
      )}
    </section>
  );
}
