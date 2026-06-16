import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Send, Loader2, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { requestDownload, requestLinkCode, resolveEpisodeFile } from "@/lib/downloads.functions";
import { startVerification } from "@/lib/verification.functions";

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
  const reqDownload = useServerFn(requestDownload);
  const reqCode = useServerFn(requestLinkCode);
  const resolveEp = useServerFn(resolveEpisodeFile);
  const startVerify = useServerFn(startVerification);
  const [loading, setLoading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{ message: string; detail?: string; cid: string } | null>(null);

  function newCorrelationId(): string {
    try {
      return (crypto as any).randomUUID().replace(/-/g, "").slice(0, 12);
    } catch {
      return Math.random().toString(36).slice(2, 14);
    }
  }

  function failWith(message: string, cid: string, detail?: string) {
    setErrorState({ message, detail, cid });
    toast.error(`${message} · ref ${cid}`, { description: detail });
  }

  async function handleClick() {
    setLoading(true);
    const cid = newCorrelationId();
    setErrorState(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        toast.error("Please sign in to download.");
        return;
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
        toast.success(`✅ ${fileName ?? "File"} sent to your Telegram`);
        return;
      }
      if (r.reason === "needs_verification") {
        toast.message("Verification required — opening verification link…");
        const v = await startVerify({ data: { mediaFileId: activeFileId } });
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
      failWith(`Couldn't deliver: ${r.reason}`, cid, (r as any).error);
    } catch (e: any) {
      failWith(e?.message ?? "Download failed", cid);
    } finally {
      setLoading(false);
    }
  }

  const tgUrl = botUsername && code ? `https://t.me/${botUsername}?start=link_${code}` : null;

  return (
    <>
      <div className="flex flex-col gap-1 shrink-0">
        <Button size={size} variant={variant} onClick={handleClick} disabled={loading} className="shrink-0">
          {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
          via Bot
        </Button>
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
    </>
  );
}
