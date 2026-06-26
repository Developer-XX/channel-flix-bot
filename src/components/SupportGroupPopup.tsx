import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSupportGroupConfig, type SupportGroupConfig } from "@/lib/support-group.functions";
import { openTelegramLink, parseTelegramLink } from "@/lib/telegram-link";
import { trackEngagement } from "@/lib/engagement-track";

const STORAGE_KEY = "sv:support-popup:lastShownAt";
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // show at most once per 24h per browser

function shouldShow(): boolean {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (!v) return true;
    const t = Number(v);
    return !Number.isFinite(t) || Date.now() - t > COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markShown(): void {
  try { window.localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* noop */ }
}

export function SupportGroupPopup() {
  const getCfg = useServerFn(getSupportGroupConfig);
  const [cfg, setCfg] = useState<SupportGroupConfig | null>(null);
  const [open, setOpen] = useState(false);

  // Load config once.
  useEffect(() => {
    let active = true;
    getCfg()
      .then((c) => { if (active) setCfg(c); })
      .catch(() => { /* silent — popup is purely optional */ });
    return () => { active = false; };
  }, [getCfg]);

  // Show on auth: SIGNED_IN (login/register) and on first visit when already signed-in.
  useEffect(() => {
    if (!cfg?.enabled || !cfg.url) return;
    let active = true;

    const maybeOpen = () => {
      if (!active) return;
      if (!shouldShow()) return;
      setOpen(true);
      markShown();
    };

    supabase.auth.getSession().then(({ data }) => { if (data.session) maybeOpen(); });
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        // Defer slightly so we don't race the redirect from /auth.
        setTimeout(maybeOpen, 800);
      }
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [cfg]);

  if (!cfg?.enabled || !cfg.url) return null;
  const info = parseTelegramLink(cfg.url);
  if (!info.valid || !info.https) return null;
  const httpsUrl = info.https;
  const deep = info.deep;

  // Fire impression once per open
  if (open) {
    // Defer to a microtask so we don't track during the render commit.
    queueMicrotask(() => trackEngagement("support_popup_impression", { surface: "popup" }));
  }

  const handleJoin = () => {
    trackEngagement("support_popup_join_click", { surface: "popup" });
    openTelegramLink(httpsUrl);
    setOpen(false);
  };
  const handleDismiss = () => {
    trackEngagement("support_popup_dismiss", { surface: "popup" });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : handleDismiss())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-[#229ED9]/15">
            {/* Telegram brand icon */}
            <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
              <path fill="#229ED9" d="M9.78 15.27 9.6 18.6c.27 0 .39-.12.54-.27l1.3-1.24 2.7 1.97c.49.27.84.13.97-.45l1.76-8.27c.18-.78-.28-1.09-.77-.91l-10.36 4c-.71.27-.7.66-.12.84l2.65.83 6.16-3.88c.29-.18.55-.08.34.12"/>
            </svg>
          </div>
          <DialogTitle className="text-center">{cfg.title}</DialogTitle>
          {cfg.description && (
            <DialogDescription className="text-center whitespace-pre-line">
              {cfg.description}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-2">
          <Button
            onClick={handleJoin}
            className="w-full h-11 text-white border-0"
            style={{ backgroundColor: "#229ED9" }}
          >
            <Send className="h-4 w-4 mr-2" />
            Join on Telegram
          </Button>
          {deep && (
            <Button
              variant="outline"
              onClick={() => { trackEngagement("support_popup_join_click", { surface: "popup_deep" }); openTelegramLink(deep); }}
              className="w-full h-10"
            >
              Open in Telegram app
            </Button>
          )}
          <Button variant="ghost" onClick={handleDismiss} className="w-full h-9 text-muted-foreground">
            <X className="h-4 w-4 mr-1.5" /> Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
