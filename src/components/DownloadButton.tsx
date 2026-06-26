import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Send, Loader2, Copy, ExternalLink, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requestDownload, requestLinkCode, resolveEpisodeFile } from "@/lib/downloads.functions";
import { startVerification, getVerificationStatus } from "@/lib/verification.functions";
import { AdSlot } from "@/components/AdSlot";
import { triggerInterstitial } from "@/components/InterstitialController";
import { DownloadPreflightDialog } from "@/components/DownloadPreflightDialog";
import { getDownloadPreflightConfig, type DownloadPreflightConfig } from "@/lib/support-group.functions";


interface Props {
  mediaFileId: string;
  fileName?: string | null;
  size?: "sm" | "default";
  variant?: "outline" | "default";
  titleId?: string;
  season?: number | null;
  episode?: number | null;
}

export function DownloadButton({
  mediaFileId,
  fileName,
  size = "sm",
  variant = "outline",
  titleId,
  season,
  episode,
}: Props) {
  const navigate = useNavigate();
  const reqDownload = useServerFn(requestDownload);
  const reqCode = useServerFn(requestLinkCode);
  const resolveEp = useServerFn(resolveEpisodeFile);
  const startVerify = useServerFn(startVerification);
  const getStatus = useServerFn(getVerificationStatus);
  const getPreflight = useServerFn(getDownloadPreflightConfig);
  const [loading, setLoading] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflight, setPreflight] = useState<DownloadPreflightConfig | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{ message: string; detail?: string; cid: string } | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Force-join dialog state. When the server returns must_join_channel we
  // open a modal listing every required channel and start a polling loop
  // that re-tries `requestDownload` every few seconds — as soon as the user
  // taps Join in Telegram, the next poll succeeds and the file is sent.
  const [joinState, setJoinState] = useState<
    | null
    | {
        rule: "and" | "or";
        channels: Array<{ id: string; title: string; joinUrl: string; status: string }>;
        joined: Set<string>;
        secondsLeft: number;
        polling: boolean;
      }
  >(null);
  const joinPollRef = useRef<{ stop: boolean; cid: string } | null>(null);

  useEffect(() => {
    if (!cooldownUntil) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [cooldownUntil]);

  // Stop any active force-join polling when the dialog is dismissed or the
  // component unmounts.
  useEffect(() => {
    return () => {
      if (joinPollRef.current) joinPollRef.current.stop = true;
    };
  }, []);

  function newCorrelationId(): string {
    try {
      return (crypto as any).randomUUID().replace(/-/g, "").slice(0, 12);
    } catch {
      return Math.random().toString(36).slice(2, 14);
    }
  }

  const cooldownLeftSec =
    cooldownUntil && cooldownUntil > now ? Math.ceil((cooldownUntil - now) / 1000) : 0;
  const isCoolingDown = cooldownLeftSec > 0;



  function failWith(message: string, cid: string, detail?: string) {
    setErrorState({ message, detail, cid });
    toast.error(`${message} · ref ${cid}`, { description: detail });
  }
  function parseRateLimit(msg: string): { retryAfterMs: number; capacity: number; used: number } | null {
    const i = msg.indexOf("RATE_LIMITED:");
    if (i < 0) return null;
    try {
      return JSON.parse(msg.slice(i + "RATE_LIMITED:".length));
    } catch {
      return null;
    }
  }

  function formatRetry(ms: number): string {
    const min = Math.ceil(ms / 60000);
    if (min < 1) return "less than a minute";
    if (min === 1) return "1 minute";
    if (min < 60) return `${min} minutes`;
    const h = Math.ceil(min / 60);
    return h === 1 ? "1 hour" : `${h} hours`;
  }

  // Exponential backoff retry for transient verification failures.
  // Up to 4 attempts (≈ 0.5s, 1s, 2s gaps). Hard rate-limit aborts immediately.
  async function startVerifyWithBackoff(
    fileId: string,
    cid: string,
  ): Promise<{ redirectUrl: string } | null> {
    const MAX = 4;
    let lastErr: any = null;
    for (let i = 0; i < MAX; i++) {
      try {
        return await startVerify({ data: { mediaFileId: fileId } });
      } catch (e: any) {
        lastErr = e;
        const rl = parseRateLimit(String(e?.message ?? ""));
        if (rl) {
          failWith(
            `Verification limit reached — try again in ${formatRetry(rl.retryAfterMs)}.`,
            cid,
            `Used ${rl.used}/${rl.capacity} attempts in the current window.`,
          );
          return null;
        }
        // Backoff before next try (0.5s, 1s, 2s, …)
        if (i < MAX - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
      }
    }
    failWith("Couldn't start verification after several tries.", cid, lastErr?.message);
    return null;
  }

  // Auto re-check loop after the user clicks "Open channel" and joins. Polls
  // requestDownload every 4 seconds for up to ~3 minutes. The first call
  // that succeeds — i.e. the bot's getChatMember sees the user joined —
  // delivers the file and we close the dialog.
  function startJoinPolling(fileId: string, cid: string) {
    if (joinPollRef.current) joinPollRef.current.stop = true;
    const handle = { stop: false, cid };
    joinPollRef.current = handle;
    const start = Date.now();
    const MAX_MS = 180_000;
    const POLL_MS = 10_000; // stay well under the 10-req/min server rate limit

    const tick = async () => {
      if (handle.stop) return;
      const elapsed = Date.now() - start;
      const secondsLeft = Math.max(0, Math.ceil((MAX_MS - elapsed) / 1000));
      setJoinState((s) => (s ? { ...s, secondsLeft, polling: true } : s));
      if (elapsed > MAX_MS) {
        setJoinState((s) => (s ? { ...s, polling: false } : s));
        return;
      }
      try {
        const r: any = await reqDownload({ data: { mediaFileId: fileId } });
        if (handle.stop) return;
        if (r.ok) {
          const cd = Number(r.cooldownSec ?? 0);
          if (cd > 0) setCooldownUntil(Date.now() + cd * 1000);
          toast.success(`✅ ${fileName ?? "File"} sent to your Telegram`);
          setJoinState(null);
          handle.stop = true;
          return;
        }
        if (r.reason === "must_join_channel") {
          // Refresh per-channel status so the dialog shows green checks for
          // channels they've already joined.
          const channels = Array.isArray(r.channels) && r.channels.length
            ? r.channels
            : null;
          if (channels) {
            setJoinState((s) =>
              s
                ? {
                    ...s,
                    channels,
                    joined: new Set(channels.filter((c: any) => c.status === "joined").map((c: any) => c.id)),
                  }
                : s,
            );
          }
        } else {
          // Different terminal error — stop polling and surface it.
          setJoinState(null);
          handle.stop = true;
          failWith(`Couldn't deliver: ${r.reason ?? "unknown"}`, cid, (r as any)?.detail);
          return;
        }
      } catch (e: any) {
        // Network/auth blip — keep polling but note it.
        console.warn("[force-join poll] error:", e?.message);
      }
      setTimeout(tick, POLL_MS);
    };
    setTimeout(tick, 6_000); // small head-start so Telegram registers the join
  }

  function cancelJoinPolling() {
    if (joinPollRef.current) joinPollRef.current.stop = true;
    setJoinState(null);
  }

  async function handleClick() {
    // Auth gate first — don't show the preflight to a signed-out user, just
    // bounce them to /auth like before.
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        const returnTo = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
        navigate({ to: "/auth", search: { redirect: returnTo } });
        return;
      }
    } catch { /* fall through */ }
    // Fetch preflight config (tutorial + rotation hours + support group).
    // Cache the first response so subsequent clicks open instantly.
    if (!preflight) {
      try {
        const cfg = await getPreflight();
        setPreflight(cfg);
      } catch {
        // If the config call fails, skip the dialog and run the download.
        void runDownload();
        return;
      }
    }
    setPreflightOpen(true);
  }

  async function runDownload() {
    setLoading(true);

    const cid = newCorrelationId();
    setErrorState(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        const returnTo = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
        navigate({ to: "/auth", search: { redirect: returnTo } });
        return;
      }

      // Full-screen video interstitial before the download flow starts.
      // Cooldown + premium gating are enforced inside the controller; this
      // call is a no-op (resolves false) when an ad shouldn't be shown.
      try {
        await triggerInterstitial("interstitial_before_download");
      } catch {
        /* never block downloads on ad failures */
      }

      const isEpisode = !!titleId && (season != null || episode != null);
      let activeFileId = mediaFileId;
      if (isEpisode) {
        try {
          const res: any = await resolveEp({
            data: {
              titleId: titleId!,
              season: season ?? null,
              episode: episode ?? null,
              expectedFileId: mediaFileId,
              correlationId: cid,
            },
          });
          if (!res.ok) {
            if (res.reason === "parse_failed") {
              failWith(
                "Couldn't read season/episode for this file.",
                cid,
                res.detail ?? "Season/episode parse failed.",
              );
            } else if (res.reason === "not_found") {
              failWith(
                "No matching episode file in the library.",
                cid,
                res.detail ?? `S${season ?? "?"} · E${episode ?? "?"}`,
              );
            } else {
              failWith("This episode is no longer available.", cid, String(res.reason));
            }
            return;
          }
          activeFileId = res.file.id;
          if (res.changed) toast.message("Episode file was updated to the latest version.");
        } catch (e: any) {
          failWith("Couldn't verify the episode file. Please retry.", cid, e?.message);
          return;
        }
      }

      const r = await reqDownload({ data: { mediaFileId: activeFileId } });
      if (r.ok) {
        const cd = Number((r as any).cooldownSec ?? 0);
        if (cd > 0) setCooldownUntil(Date.now() + cd * 1000);
        if ((r as any).reused) {
          toast.message(`Already sent — check your Telegram (within ${cd || 8}s cooldown).`);
        } else if ((r as any).queued) {
          toast.message("Queued — we'll retry shortly. Check your Telegram in a minute.");
        } else {
          toast.success(`✅ ${fileName ?? "File"} sent to your Telegram`);
        }
        return;
      }
      if (r.reason === "needs_verification") {
        toast.message("Verification required — opening verification link…");
        const v = await startVerifyWithBackoff(activeFileId, cid);
        if (!v) return; // error already surfaced
        // Shorteners (nanolinks/adrinolinks) send X-Frame-Options: DENY,
        // so opening inside the Lovable preview iframe shows Firefox's
        // "Can't open this page" error. Always break out of frames.
        try {
          if (window.top && window.top !== window.self) {
            window.top.location.href = v.redirectUrl;
            return;
          }
        } catch {
          /* cross-origin top — fall through */
        }
        const w = window.open(v.redirectUrl, "_blank", "noopener,noreferrer");
        if (!w) {
          // Popup blocked — fall back to same-window nav
          window.location.href = v.redirectUrl;
        }
        return;
      }
      if (r.reason === "not_linked" || r.reason === "bot_blocked") {
        const codeRes = await reqCode();
        setCode(codeRes.code);
        setBotUsername(codeRes.botUsername);
        setLinkOpen(true);
        return;
      }
      if (r.reason === "must_join_channel") {
        const rr = r as any;
        const channels: Array<{ id: string; title: string; joinUrl: string; status: string }> =
          Array.isArray(rr.channels) && rr.channels.length
            ? rr.channels
            : [{ id: "legacy", title: rr.channelTitle || "Main channel", joinUrl: rr.joinUrl || "", status: "not_joined" }];
        const rule: "and" | "or" = rr.rule === "or" ? "or" : "and";
        const joined = new Set<string>(channels.filter((c) => c.status === "joined").map((c) => c.id));
        setJoinState({ rule, channels, joined, secondsLeft: 180, polling: true });
        // Auto-open the first not-joined channel for one-tap join.
        const first = channels.find((c) => c.status !== "joined" && c.joinUrl);
        if (first?.joinUrl) {
          try { window.open(first.joinUrl, "_blank", "noopener,noreferrer"); } catch { /* popup blocked */ }
        }
        startJoinPolling(activeFileId, cid);
        return;

      }
      // Note: cooldown is now handled server-side as a transparent re-use of
      // the prior delivery within DOWNLOAD_RESEND_COOLDOWN_SECONDS — the
      // server returns ok:true with reused:true and the bot's previous
      // message is still in the user's chat.
      const rr = r as any;
      const friendly =
        rr.reason === "source_missing"
          ? "This file isn't linked to a Telegram source yet."
          : rr.reason === "file_not_found"
            ? "File not found in the library."
            : rr.reason === "delivery_failed"
              ? "Telegram refused the delivery."
              : `Couldn't deliver: ${rr.reason}`;
      failWith(friendly, cid, rr.detail ?? rr.error ?? `reason=${rr.reason}`);
    } catch (e: any) {
      failWith(e?.message ?? "Download failed", cid);
    } finally {
      setLoading(false);
    }
  }

  const tgUrl = botUsername && code ? `https://t.me/${botUsername}?start=link_${code}` : null;

  return (
    <>
      <div className="flex flex-col gap-2 shrink-0">
        <AdSlot placement="before_download" className="max-w-[280px]" />
        <Button
          size={size}
          variant={variant}
          onClick={handleClick}
          disabled={loading || isCoolingDown}
          className="shrink-0"
          data-testid="download-btn"
          data-media-file-id={mediaFileId}
        >
          {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
          {isCoolingDown ? `Wait ${cooldownLeftSec}s` : "Download"}
        </Button>
        {isCoolingDown && (
          <p className="text-[11px] text-muted-foreground">
            Sent to Telegram — re-clicks within {cooldownLeftSec}s reuse the same delivery.
          </p>
        )}
        {errorState && (
          <div
            role="alert"
            className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] leading-tight text-red-300"
          >
            <div className="font-medium">{errorState.message}</div>
            {errorState.detail && <div className="opacity-80">{errorState.detail}</div>}
            <div className="mt-0.5 font-mono opacity-70">support ref: {errorState.cid}</div>
          </div>
        )}
      </div>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link your Telegram to download</DialogTitle>
            <DialogDescription>
              Our bot DMs files to you on Telegram. Open the bot and press Start with the code below, then click Download again.
            </DialogDescription>
          </DialogHeader>
          {code && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-surface/60 p-4 text-center">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Your code</div>
                <div className="font-mono text-3xl font-bold mt-1 tracking-widest">{code}</div>
                <div className="text-xs text-muted-foreground mt-2">Expires in 15 minutes</div>
              </div>
              <div className="flex gap-2">
                {tgUrl && (
                  <Button asChild className="flex-1">
                    <a href={tgUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1.5" /> Open Bot
                    </a>
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(`/start link_${code}`);
                    toast.success("Command copied");
                  }}
                >
                  <Copy className="h-4 w-4 mr-1.5" /> Copy command
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                After pressing Start in the bot, come back and click Download again.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!joinState}
        onOpenChange={(open) => {
          if (!open) cancelJoinPolling();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join to download</DialogTitle>
            <DialogDescription>
              {joinState?.rule === "or"
                ? "Join at least one of these Telegram channels — the bot will deliver your file automatically."
                : "Join all of these Telegram channels — the bot will deliver your file automatically once you've joined."}
            </DialogDescription>
          </DialogHeader>
          {joinState && (
            <div className="space-y-3">
              <ul className="space-y-2">
                {joinState.channels.map((c) => {
                  const ok = c.status === "joined";
                  return (
                    <li
                      key={c.id}
                      className={`flex items-center justify-between gap-2 rounded-md border p-2 ${ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-surface/40"}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {ok ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        ) : (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                        )}
                        <span className="text-sm truncate">{c.title}</span>
                      </div>
                      {!ok && c.joinUrl && (
                        <Button asChild size="sm" variant="outline">
                          <a href={c.joinUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4 mr-1.5" /> Open
                          </a>
                        </Button>
                      )}
                      {ok && <span className="text-[11px] text-emerald-400">Joined ✓</span>}
                    </li>
                  );
                })}
              </ul>
              <div className="rounded-md border border-border bg-surface/40 px-3 py-2 text-[12px] text-muted-foreground">
                {joinState.polling ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 inline animate-spin" />
                    Waiting for you to join — we'll auto-send the file when ready.{" "}
                    {joinState.secondsLeft > 0 && <span>({joinState.secondsLeft}s)</span>}
                  </>
                ) : (
                  <>Timed out waiting. Close this dialog and click Download again.</>
                )}
              </div>
              <div className="flex justify-end">
                <Button size="sm" variant="ghost" onClick={cancelJoinPolling}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <DownloadPreflightDialog
        open={preflightOpen}
        onOpenChange={setPreflightOpen}
        config={preflight}
        onContinue={() => { void runDownload(); }}
      />
    </>

  );
}
