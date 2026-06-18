import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { listActiveAds, recordAdEvent, type Ad, type AdPlacement } from "@/lib/ads.functions";
import { pickAd as pickAdPure } from "@/lib/ad-rotation";

interface Props {
  placement: AdPlacement;
  cancelSeconds: number;
  onClose: (reason: "completed" | "cancelled" | "no-ad") => void;
}

/**
 * Full-screen, page-blocking video interstitial.
 *
 * - Locks scroll + intercepts pointer events outside the dialog while open.
 * - Cancel icon appears only after `cancelSeconds`.
 * - If the video finishes before the cancel timer, we close as "completed".
 * - If there is no eligible ad for the placement, we report "no-ad" so the
 *   caller can immediately proceed without blocking the user.
 */
export function VideoInterstitial({ placement, cancelSeconds, onClose }: Props) {
  const listFn = useServerFn(listActiveAds);
  const trackFn = useServerFn(recordAdEvent);
  const [ad, setAd] = useState<Ad | null>(null);
  const [remaining, setRemaining] = useState<number>(cancelSeconds);
  const [ready, setReady] = useState(false);
  const impressionLogged = useRef(false);
  const closedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Lock body scroll while interstitial is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Load a video ad for this placement.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await listFn({ data: { placement } });
        if (cancelled) return;
        const videoAds = (r.ads ?? []).filter((a) => a.kind === "video" && a.video_url);
        const picked = pickAdPure(videoAds, placement, Date.now());
        if (!picked) {
          closedRef.current = true;
          onClose("no-ad");
          return;
        }
        setAd(picked);
        setReady(true);
      } catch {
        closedRef.current = true;
        onClose("no-ad");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [placement, listFn, onClose]);

  // Countdown for the cancel-button reveal.
  useEffect(() => {
    if (!ready) return;
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearTimeout(t);
  }, [ready, remaining]);

  // Log impression once the ad starts playing.
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

  if (!ad) {
    // Render a brief loading shroud so we don't flash content while we resolve.
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Loading advertisement"
        className="fixed inset-0 z-[100] grid place-items-center bg-black/95 backdrop-blur-sm"
      >
        <div className="text-xs text-white/70 animate-pulse">Loading…</div>
      </div>
    );
  }

  const canCancel = remaining <= 0;
  const onVideoClick = () => {
    if (!ad.link_url) return;
    trackFn({ data: { ad_id: ad.id, placement, event_type: "click" } }).catch(() => {});
    window.open(ad.link_url, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sponsored video"
      data-testid={`interstitial-${placement}`}
      className="fixed inset-0 z-[100] grid place-items-center bg-black/95 backdrop-blur-sm p-3 sm:p-6"
    >
      <div className="relative w-full max-w-[min(100vw,1100px)]">
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

        <video
          ref={videoRef}
          src={ad.video_url!}
          autoPlay
          playsInline
          controls={false}
          onClick={onVideoClick}
          onEnded={() => close("completed")}
          className="block w-full max-h-[80vh] rounded-lg bg-black object-contain cursor-pointer"
        />

        <div className="mt-2 flex items-center justify-between text-[11px] text-white/60">
          <span className="truncate">{ad.name}</span>
          {ad.link_url && (
            <button
              type="button"
              onClick={onVideoClick}
              className="rounded-md bg-white/10 hover:bg-white/20 text-white px-2 py-1 transition-colors"
            >
              Learn more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
