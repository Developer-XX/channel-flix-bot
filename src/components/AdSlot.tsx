import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  listActiveAds,
  recordAdEvent,
  type Ad,
  type AdPlacement,
} from "@/lib/ads.functions";
import { getMyPremiumStatus } from "@/lib/premium.functions";
import { pickAd as pickAdPure } from "@/lib/ad-rotation";

function useIsPremium(): boolean {
  const fn = useServerFn(getMyPremiumStatus);
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setAuthed(!!data.session);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const q = useQuery({
    queryKey: ["my-premium-ad-gate"],
    queryFn: () => fn(),
    enabled: authed === true,
    staleTime: 60_000,
    retry: false,
  });
  return !!q.data?.isPremium;
}

function pickAd(ads: Ad[], placement: AdPlacement): Ad | null {
  return pickAdPure(ads, placement, Date.now());
}

export function AdSlot({
  placement,
  className = "",
}: {
  placement: AdPlacement;
  className?: string;
}) {
  const isPremium = useIsPremium();
  const listFn = useServerFn(listActiveAds);
  const trackFn = useServerFn(recordAdEvent);

  const q = useQuery({
    queryKey: ["ads", placement],
    queryFn: () => listFn({ data: { placement } }),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: !isPremium,
  });

  const ads = (q.data?.ads ?? []) as Ad[];
  const ad = useMemo(() => pickAd(ads, placement), [ads, placement]);

  const impressedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ad || isPremium) return;
    if (impressedRef.current === ad.id) return;
    impressedRef.current = ad.id;
    trackFn({
      data: { ad_id: ad.id, placement, event_type: "impression" },
    }).catch(() => {});
  }, [ad, isPremium, placement, trackFn]);

  if (isPremium || !ad) return null;

  const onClick = () => {
    trackFn({
      data: { ad_id: ad.id, placement, event_type: "click" },
    }).catch(() => {});
  };

  return (
    <div
      className={`relative w-full max-w-full overflow-hidden rounded-lg ${className}`}
    >
      <span className="pointer-events-none absolute right-2 top-1 z-10 rounded bg-background/60 px-1 text-[9px] uppercase tracking-wider text-muted-foreground/70">
        Ad
      </span>
      <AdContent ad={ad} onClick={onClick} />
    </div>
  );
}

function AdContent({ ad, onClick }: { ad: Ad; onClick: () => void }) {
  const inner = (() => {
    if (ad.kind === "video" && ad.video_url) {
      return (
        <video
          src={ad.video_url}
          autoPlay
          muted
          loop
          playsInline
          className="block w-full max-w-full rounded-lg max-h-[280px] sm:max-h-[360px] object-cover"
        />
      );
    }
    if (ad.kind === "html" && ad.html) {
      // Hardened sandbox: scripts only, no same-origin, no top-nav, no popup-escape.
      // CSP meta inlined into srcDoc blocks external script/inline-script
      // execution outside the iframe origin and forbids form submissions.
      const csp =
        "<meta http-equiv=\"Content-Security-Policy\" content=\"" +
        "default-src 'self' data: blob: https:; " +
        "script-src 'unsafe-inline' https:; " +
        "style-src 'unsafe-inline' https:; " +
        "img-src data: blob: https:; " +
        "media-src data: blob: https:; " +
        "frame-ancestors 'none'; " +
        "form-action 'none';\">";
      const srcDoc =
        "<!doctype html><html><head>" +
        csp +
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
        "<style>html,body{margin:0;padding:0;background:transparent;color:#fff;font-family:system-ui,sans-serif;overflow:hidden}</style>" +
        "</head><body>" +
        ad.html +
        "</body></html>";
      return (
        <iframe
          title={ad.name}
          sandbox="allow-scripts allow-popups"
          referrerPolicy="no-referrer"
          loading="lazy"
          srcDoc={srcDoc}
          className="block w-full h-[100px] sm:h-[140px] md:h-[160px] rounded-lg border-0 bg-transparent"
        />
      );
    }
    if (ad.image_url) {
      return (
        <img
          src={ad.image_url}
          alt={ad.name}
          className="block w-full max-w-full rounded-lg max-h-[200px] sm:max-h-[280px] object-cover"
          loading="lazy"
        />
      );
    }
    return null;
  })();

  if (!inner) return null;
  if (ad.link_url) {
    return (
      <a
        href={ad.link_url}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={onClick}
        className="block"
      >
        {inner}
      </a>
    );
  }
  return inner;
}
