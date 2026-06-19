import { useEffect, useRef, useState, useCallback } from "react";
import { X, AlertTriangle, Volume2, VolumeX, Play } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { listActiveAds, recordAdEvent, type Ad, type AdPlacement } from "@/lib/ads.functions";
import { recordAdPerfEvent, issueInterstitialRequest, type AdPerfMetric } from "@/lib/ad-perf.functions";
import { pickAd as pickAdPure } from "@/lib/ad-rotation";

// Fire-and-forget beacon to the server-validated perf endpoint. Uses
// sendBeacon when available so it survives tab close / navigation; falls
// back to fetch keepalive.
function sendBeacon(requestId: string | null, phase: string, value?: number) {
  if (!requestId || typeof window === "undefined") return;
  try {
    const payload = JSON.stringify({ request_id: requestId, phase, value });
    const url = "/api/public/hooks/interstitial-beacon";
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      return;
    }
    void fetch(url, { method: "POST", body: payload, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
  } catch {
    /* noop */
  }
}

interface Props {
  placement: AdPlacement;
  cancelSeconds: number;
  onClose: (reason: "completed" | "cancelled" | "no-ad") => void;
}

type LoadState = "loading" | "ready" | "error";

export type ClientAdEventName =
  | "ad_load_start"
  | "ad_load_success"
  | "ad_load_error"
  | "ad_play_success"
  | "ad_autoplay_blocked"
  | "ad_mute"
  | "ad_unmute"
  | "ad_video_error"
  | "ad_timeout"
  | "ad_retry";

/**
 * Lightweight client-side analytics beacon for interstitial events. Fires a
 * CustomEvent so any listener (debug overlay, e2e tests, GA wrapper) can pick
 * it up. Server-side events use the closed allow-list on `recordAdEvent` and
 * `recordAdPerfEvent`.
 */
function emitClientAdEvent(name: ClientAdEventName, detail: Record<string, unknown>) {
  try {
    window.dispatchEvent(new CustomEvent(`interstitial:${name}`, { detail }));
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
  const perfFn = useServerFn(recordAdPerfEvent);
  const issueFn = useServerFn(issueInterstitialRequest);

  const [ad, setAd] = useState<Ad | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number>(cancelSeconds);
  const [muted, setMuted] = useState(true);
  const [needsTap, setNeedsTap] = useState(false);
  const [retries, setRetries] = useState(0);

  const impressionLogged = useRef(false);
  const playLogged = useRef(false);
  const ttffLogged = useRef(false);
  const closedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountTimeRef = useRef<number>(0);
  const bufferStartRef = useRef<number | null>(null);
  const bufferTotalRef = useRef<number>(0);
  const requestIdRef = useRef<string | null>(null);
  const firstByteSentRef = useRef(false);

  // Best-effort perf send. Bounded by RLS WITH CHECK on the server.
  const sendPerf = useCallback(
    (metric: AdPerfMetric, value: number) => {
      try {
        const ua = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 256) : undefined;
        void perfFn({
          data: {
            ad_id: ad?.id ?? null,
            placement,
            metric,
            value: Math.max(0, Math.min(600000, Math.round(value))),
            user_agent: ua,
            request_id: requestIdRef.current,
          },
        }).catch(() => {});
      } catch {
        /* noop */
      }
    },
    [ad, perfFn, placement],
  );

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

  // Start TTFF clock the moment the player mounts, and issue a server-side
  // correlation request_id so beacons can reconcile the true TTFF/buffering.
  useEffect(() => {
    if (loadState !== "ready" || !ad) return;
    mountTimeRef.current = performance.now();
    let cancelled = false;
    void issueFn({
      data: {
        ad_id: ad.id,
        placement,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 256) : undefined,
      },
    })
      .then((r) => {
        if (cancelled) return;
        requestIdRef.current = r?.request_id ?? null;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loadState, ad, issueFn, placement]);

  // Watchdog: if the video never reaches a playable state within
  // LOAD_TIMEOUT_MS after the ad metadata loads, treat it as a timeout.
  useEffect(() => {
    if (loadState !== "ready" || !ad) return;
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => {
      if (!playLogged.current && !closedRef.current) {
        emitClientAdEvent("ad_timeout", { placement, ad_id: ad.id, ms: LOAD_TIMEOUT_MS });
        sendPerf("autoplay_blocked", 1);
        setNeedsTap(true);
      }
    }, LOAD_TIMEOUT_MS);
    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
  }, [loadState, ad, placement, sendPerf]);

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

  const flushPlaybackMetrics = useCallback(() => {
    // Buffer total (sum of waiting→playing gaps).
    if (bufferStartRef.current != null) {
      bufferTotalRef.current += performance.now() - bufferStartRef.current;
      bufferStartRef.current = null;
    }
    if (bufferTotalRef.current > 0) {
      sendPerf("buffer_ms", bufferTotalRef.current);
      bufferTotalRef.current = 0;
    }
    // Dropped frames (HTMLVideoElement.getVideoPlaybackQuality).
    const v = videoRef.current as (HTMLVideoElement & {
      getVideoPlaybackQuality?: () => { droppedVideoFrames: number };
      webkitDroppedFrameCount?: number;
    }) | null;
    if (v) {
      let dropped = 0;
      if (typeof v.getVideoPlaybackQuality === "function") {
        try {
          dropped = v.getVideoPlaybackQuality().droppedVideoFrames ?? 0;
        } catch {
          /* noop */
        }
      } else if (typeof v.webkitDroppedFrameCount === "number") {
        dropped = v.webkitDroppedFrameCount;
      }
      if (dropped > 0) {
        sendPerf("dropped_frames", dropped);
        sendBeacon(requestIdRef.current, "dropped_frame", dropped);
      }
    }
    sendBeacon(requestIdRef.current, "end");
  }, [sendPerf]);

  const close = (reason: "completed" | "cancelled") => {
    if (closedRef.current) return;
    closedRef.current = true;
    flushPlaybackMetrics();
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
      sendPerf("autoplay_blocked", 1);
    }
  }, [ad, placement, trackFn, sendPerf]);

  // Single-gesture user-initiated play, used by the "Play video" fallback.
  const playWithSound = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.muted = false;
      setMuted(false);
      await v.play();
      setNeedsTap(false);
      if (!playLogged.current && ad) {
        playLogged.current = true;
        emitClientAdEvent("ad_play_success", { placement, ad_id: ad.id });
        trackFn({ data: { ad_id: ad.id, placement, event_type: "view" } }).catch(() => {});
      }
    } catch {
      // Degrade to muted playback.
      try {
        v.muted = true;
        setMuted(true);
        await v.play();
        setNeedsTap(false);
        if (!playLogged.current && ad) {
          playLogged.current = true;
          emitClientAdEvent("ad_play_success", { placement, ad_id: ad.id, fallback: "muted" });
          trackFn({ data: { ad_id: ad.id, placement, event_type: "view" } }).catch(() => {});
        }
      } catch (err2) {
        emitClientAdEvent("ad_autoplay_blocked", {
          placement,
          ad_id: ad?.id,
          reason: err2 instanceof Error ? err2.message : "blocked-after-gesture",
        });
        sendPerf("autoplay_blocked", 1);
      }
    }
  }, [ad, placement, trackFn, sendPerf]);

  const toggleMute = async () => {
    const v = videoRef.current;
    if (!v) return;
    const next = !muted;
    setMuted(next);
    v.muted = next;
    if (!next) {
      try {
        await v.play();
        emitClientAdEvent("ad_unmute", { placement, ad_id: ad?.id });
      } catch {
        setMuted(true);
        v.muted = true;
        void v.play().catch(() => {});
        emitClientAdEvent("ad_autoplay_blocked", { placement, ad_id: ad?.id, reason: "unmute-blocked" });
        sendPerf("autoplay_blocked", 1);
      }
    } else {
      emitClientAdEvent("ad_mute", { placement, ad_id: ad?.id });
    }
  };

  const handleVideoError = () => {
    const v = videoRef.current;
    const code = v?.error?.code ?? null;
    emitClientAdEvent("ad_video_error", { placement, ad_id: ad?.id, code });
    sendPerf("video_error", 1);
    if (retries < MAX_RETRIES) {
      setRetries((n) => n + 1);
      emitClientAdEvent("ad_retry", { placement, ad_id: ad?.id, attempt: retries + 1 });
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
    ttffLogged.current = false;
    emitClientAdEvent("ad_retry", { placement, ad_id: ad?.id, attempt: "manual" });
    void loadAd();
  };

  const canCancel = remaining <= 0;

  if (loadState === "loading") {
    return (
      <Frame placement={placement} label="Loading advertisement">
        <div className="absolute -top-2 left-2 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/80">
          Ad
        </div>
        <PlayerSkeleton />
        <div className="mt-2 h-4 w-32 rounded bg-white/10 animate-pulse" />
      </Frame>
    );
  }


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
        <div
          data-testid="interstitial-error"
          className="w-full aspect-video rounded-lg bg-black/80 border border-white/10 grid place-items-center p-6 text-center"
        >
          <div className="space-y-3 max-w-sm">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-400" />
            <div className="text-sm text-white">
              {errorMsg ?? "We couldn't play this ad."}
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                data-testid="interstitial-retry"
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
          poster={ad.image_url ?? undefined}
          autoPlay
          muted={muted}
          playsInline
          {...({
            "webkit-playsinline": "true",
            "x5-playsinline": "true",
            "x5-video-player-type": "h5-page",
          } as Record<string, string>)}
          preload="auto"
          controls={false}
          onCanPlay={tryPlay}
          onLoadedMetadata={tryPlay}
          onLoadedData={() => {
            if (!firstByteSentRef.current) {
              firstByteSentRef.current = true;
              sendBeacon(requestIdRef.current, "first_byte");
            }
          }}
          onWaiting={() => {
            if (bufferStartRef.current == null) bufferStartRef.current = performance.now();
            sendBeacon(requestIdRef.current, "buffer_start");
          }}
          onPlaying={() => {
            if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
            setNeedsTap(false);
            if (bufferStartRef.current != null) {
              bufferTotalRef.current += performance.now() - bufferStartRef.current;
              bufferStartRef.current = null;
              sendBeacon(requestIdRef.current, "buffer_end");
            }
            if (!ttffLogged.current && mountTimeRef.current > 0) {
              ttffLogged.current = true;
              sendPerf("ttff_ms", performance.now() - mountTimeRef.current);
              sendBeacon(requestIdRef.current, "first_frame");
            }
          }}
          onError={() => {
            sendBeacon(requestIdRef.current, "error");
            handleVideoError();
          }}
          onEnded={() => {
            sendBeacon(requestIdRef.current, "end");
            close("completed");
          }}
          className="absolute inset-0 h-full w-full object-contain"
        />

        {needsTap && (
          <button
            type="button"
            data-testid="interstitial-play-fallback"
            onClick={() => void playWithSound()}
            className="absolute inset-0 grid place-items-center bg-black/70"
            style={
              ad.image_url
                ? { backgroundImage: `url(${ad.image_url})`, backgroundSize: "cover", backgroundPosition: "center" }
                : undefined
            }
          >
            <div className="absolute inset-0 bg-black/55" />
            <div className="relative flex flex-col items-center gap-3 text-white">
              <div className="grid h-20 w-20 place-items-center rounded-full bg-white text-black shadow-2xl">
                <Play className="h-9 w-9 ml-1" />
              </div>
              <div className="text-sm font-semibold tracking-wide">Play video</div>
              <div className="text-[11px] uppercase tracking-wider text-white/70">Sponsored · {ad.name}</div>
            </div>
          </button>
        )}

        {!needsTap && (
          <button
            type="button"
            aria-label={muted ? "Unmute ad" : "Mute ad"}
            data-testid="interstitial-mute"
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
