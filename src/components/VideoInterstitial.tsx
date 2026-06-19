import { useEffect, useRef, useState, useCallback } from "react";
import { X, AlertTriangle, Volume2, VolumeX, Play } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { listActiveAds, recordAdEvent, type Ad, type AdPlacement } from "@/lib/ads.functions";
import { pickAd as pickAdPure } from "@/lib/ad-rotation";

interface Props {
  placement: AdPlacement;
  cancelSeconds: number;
  onClose: (reason: "completed" | "cancelled" | "no-ad") => void;
}

type LoadState = "loading" | "ready" | "error";

/**
 * Lightweight client-side analytics beacon for interstitial events that
 * don't map to the server-side `recordAdEvent` allow-list
 * (impression/click/dismiss/complete/view). Fires a CustomEvent so any
 * listener (GA wrapper, debug overlay, e2e tests) can pick it up.
 */
function emitClientAdEvent(
  name:
    | "ad_load_start"
    | "ad_load_success"
    | "ad_load_error"
    | "ad_play_success"
    | "ad_autoplay_blocked"
    | "ad_mute"
    | "ad_unmute"
    | "ad_video_error"
    | "ad_timeout"
    | "ad_retry",
  detail: Record<string, unknown>,
) {
  try {
    window.dispatchEvent(new CustomEvent(`interstitial:${name}`, { detail }));
    // eslint-disable-next-line no-console
    if (import.meta.env.DEV) console.debug(`[interstitial] ${name}`, detail);
  } catch {
    /* noop */
  }
}

const LOAD_TIMEOUT_MS = 8000;
const MAX_RETRIES = 1;

export function VideoInterstitial({ placement, cancelSeconds, onClose }: Props) {
  const listFn = useServerFn(listActiveAds);
  const trackFn = useServerFn(recordAdEvent);

  const [ad, setAd] = useState<Ad | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number>(cancelSeconds);
  const [muted, setMuted] = useState(true);
  const [needsTap, setNeedsTap] = useState(false);
  const [retries, setRetries] = useState(0);

  const impressionLogged = useRef(false);
  const playLogged = useRef(false);
  const closedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lock body scroll while interstitial is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Load a video ad for this placement (with retry).
  const loadAd = useCallback(async () => {
    setLoadState("loading");
    setErrorMsg(null);
    emitClientAdEvent("ad_load_start", { placement });
    try {
      const r = await listFn({ data: { placement } });
      const videoAds = (r.ads ?? []).filter((a) => a.kind === "video" && a.video_url);
      const picked = pickAdPure(videoAds, placement, Date.now());
      if (!picked) {
        emitClientAdEvent("ad_load_error", { placement, reason: "no-eligible-ad" });
        closedRef.current = true;
        onClose("no-ad");
        return;
      }
      setAd(picked);
      setLoadState("ready");
      emitClientAdEvent("ad_load_success", { placement, ad_id: picked.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load ad";
      setErrorMsg(msg);
      setLoadState("error");
      emitClientAdEvent("ad_load_error", { placement, reason: msg });
    }
  }, [listFn, onClose, placement]);

  useEffect(() => {
    void loadAd();
  }, [loadAd]);

  // Watchdog: if the video never reaches a playable state within
  // LOAD_TIMEOUT_MS after the ad metadata loads, treat it as a timeout.
  useEffect(() => {
    if (loadState !== "ready" || !ad) return;
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => {
      if (!playLogged.current && !closedRef.current) {
        emitClientAdEvent("ad_timeout", { placement, ad_id: ad.id, ms: LOAD_TIMEOUT_MS });
        // Surface a tap-to-play affordance rather than hard-failing.
        setNeedsTap(true);
      }
    }, LOAD_TIMEOUT_MS);
    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
  }, [loadState, ad, placement]);

  // Countdown for the cancel-button reveal.
  useEffect(() => {
    if (loadState !== "ready") return;
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearTimeout(t);
  }, [loadState, remaining]);

  // Log impression once the ad is mounted.
  useEffect(() => {
    if (!ad || impressionLogged.current) return;
    impressionLogged.current = true;
    trackFn({ data: { ad_id: ad.id, placement, event_type: "impression" } }).catch(() => {});
  }, [ad, placement, trackFn]);

  const close = (reason: "completed" | "cancelled") => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (ad) {
      trackFn({
        data: { ad_id: ad.id, placement, event_type: reason === "completed" ? "complete" : "dismiss" },
      }).catch(() => {});
    }
    onClose(reason);
  };

  const openLink = () => {
    if (!ad?.link_url) return;
    trackFn({ data: { ad_id: ad.id, placement, event_type: "click" } }).catch(() => {});
    window.open(ad.link_url, "_blank", "noopener,noreferrer");
  };

  const tryPlay = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    // iOS Safari requires muted + playsInline + the play() call from a
    // user gesture or from within a `canplay` handler. We always start muted
    // so the first play attempt is allowed by every modern browser.
    try {
      v.muted = true;
      await v.play();
      setNeedsTap(false);
      if (!playLogged.current && ad) {
        playLogged.current = true;
        emitClientAdEvent("ad_play_success", { placement, ad_id: ad.id });
        trackFn({ data: { ad_id: ad.id, placement, event_type: "view" } }).catch(() => {});
      }
    } catch (err) {
      setNeedsTap(true);
      emitClientAdEvent("ad_autoplay_blocked", {
        placement,
        ad_id: ad?.id,
        reason: err instanceof Error ? err.message : "blocked",
      });
    }
  }, [ad, placement, trackFn]);

  const toggleMute = async () => {
    const v = videoRef.current;
    if (!v) return;
    const next = !muted;
    setMuted(next);
    v.muted = next;
    if (!next) {
      // Unmuting requires a user gesture; we're already in one here.
      try {
        await v.play();
        emitClientAdEvent("ad_unmute", { placement, ad_id: ad?.id });
      } catch {
        // Roll back to muted playback if the browser blocks the unmuted play.
        setMuted(true);
        v.muted = true;
        void v.play().catch(() => {});
        emitClientAdEvent("ad_autoplay_blocked", { placement, ad_id: ad?.id, reason: "unmute-blocked" });
      }
    } else {
      emitClientAdEvent("ad_mute", { placement, ad_id: ad?.id });
    }
  };

  const handleVideoError = () => {
    const v = videoRef.current;
    const code = v?.error?.code ?? null;
    emitClientAdEvent("ad_video_error", { placement, ad_id: ad?.id, code });
    if (retries < MAX_RETRIES) {
      setRetries((n) => n + 1);
      emitClientAdEvent("ad_retry", { placement, ad_id: ad?.id, attempt: retries + 1 });
      // Force a reload of the same source.
      if (v) {
        try {
          v.load();
        } catch {
          /* noop */
        }
      }
      return;
    }
    setErrorMsg("This ad couldn't be played.");
    setLoadState("error");
  };

  const retry = () => {
    setRetries(0);
    playLogged.current = false;
    emitClientAdEvent("ad_retry", { placement, ad_id: ad?.id, attempt: "manual" });
    void loadAd();
  };

  // Consistent dialog frame used by every state to prevent layout shift.
  const Frame: React.FC<{ children: React.ReactNode; label: string }> = ({ children, label }) => (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-testid={`interstitial-${placement}`}
      className="fixed inset-0 z-[100] grid place-items-center bg-black/95 backdrop-blur-sm p-3 sm:p-6"
    >
      <div className="relative w-full max-w-[min(100vw,1100px)]">{children}</div>
    </div>
  );

  // Skeleton player container — same aspect ratio as the real video so the
  // dialog occupies the final size before bytes arrive.
  const PlayerSkeleton = () => (
    <div className="relative w-full aspect-video rounded-lg bg-white/5 overflow-hidden">
      <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-white/0 via-white/10 to-white/0" />
      <div className="absolute inset-0 grid place-items-center text-xs text-white/70">Loading ad…</div>
    </div>
  );

  if (loadState === "loading") {
    return (
      <Frame label="Loading advertisement">
        <div className="absolute -top-2 left-2 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/80">
          Ad
        </div>
        <PlayerSkeleton />
        <div className="mt-2 h-4 w-32 rounded bg-white/10 animate-pulse" />
      </Frame>
    );
  }

  if (loadState === "error" || !ad) {
    return (
      <Frame label="Advertisement failed to load">
        <div className="w-full aspect-video rounded-lg bg-black/80 border border-white/10 grid place-items-center p-6 text-center">
          <div className="space-y-3 max-w-sm">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-400" />
            <div className="text-sm text-white">
              {errorMsg ?? "We couldn't play this ad."}
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={retry}
                className="rounded-md bg-white/10 hover:bg-white/20 text-white text-xs px-3 py-1.5"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => {
                  closedRef.current = true;
                  onClose("no-ad");
                }}
                className="rounded-md bg-white text-black text-xs px-3 py-1.5"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      </Frame>
    );
  }

  const canCancel = remaining <= 0;

  return (
    <Frame label="Sponsored video">
      <div className="absolute -top-2 left-2 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/80">
        Ad
      </div>

      {canCancel ? (
        <button
          type="button"
          aria-label="Close advertisement"
          data-testid="interstitial-close"
          onClick={() => close("cancelled")}
          className="absolute -top-2 -right-2 z-10 grid h-9 w-9 place-items-center rounded-full bg-white text-black shadow-lg hover:scale-105 transition-transform"
        >
          <X className="h-5 w-5" />
        </button>
      ) : (
        <div
          aria-live="polite"
          data-testid="interstitial-countdown"
          className="absolute -top-2 -right-2 z-10 grid h-9 min-w-9 px-2 place-items-center rounded-full bg-white/15 text-white text-xs font-medium border border-white/20"
        >
          {remaining}s
        </div>
      )}

      <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={ad.video_url!}
          autoPlay
          muted={muted}
          playsInline
          // iOS Safari + WeChat / X5 (Android) hints to keep playback inline
          // and avoid the OS-level fullscreen takeover.
          {...({
            "webkit-playsinline": "true",
            "x5-playsinline": "true",
            "x5-video-player-type": "h5-page",
          } as Record<string, string>)}
          preload="auto"
          controls={false}
          onCanPlay={tryPlay}
          onLoadedMetadata={tryPlay}
          onPlaying={() => {
            if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
            setNeedsTap(false);
          }}
          onError={handleVideoError}
          onEnded={() => close("completed")}
          className="absolute inset-0 h-full w-full object-contain"
        />

        {needsTap && (
          <button
            type="button"
            onClick={() => void tryPlay()}
            className="absolute inset-0 grid place-items-center gap-2 bg-black/50 text-white text-sm font-medium"
          >
            <Play className="h-10 w-10" />
            <span>Tap to play ad</span>
          </button>
        )}

        {!needsTap && (
          <button
            type="button"
            aria-label={muted ? "Unmute ad" : "Mute ad"}
            onClick={() => void toggleMute()}
            className="absolute bottom-2 left-2 grid h-9 w-9 place-items-center rounded-full bg-black/70 hover:bg-black/85 text-white"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-white/60">
        <span className="truncate">{ad.name}</span>
        {ad.link_url && (
          <button
            type="button"
            onClick={openLink}
            className="rounded-md bg-white/10 hover:bg-white/20 text-white px-2 py-1 transition-colors"
          >
            Learn more
          </button>
        )}
      </div>
    </Frame>
  );
}
