import { useEffect, useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getInterstitialConfig, type InterstitialConfig } from "@/lib/ads.functions";
import { getMyPremiumStatus } from "@/lib/premium.functions";
import { supabase } from "@/integrations/supabase/client";
import { VideoInterstitial } from "@/components/VideoInterstitial";
import type { AdPlacement } from "@/lib/ads.functions";

type Request = { placement: AdPlacement; resolve: (shown: boolean) => void } | null;

// Module-level imperative API so any component (DownloadButton, login pages)
// can request an interstitial without prop drilling.
let trigger: ((placement: AdPlacement) => Promise<boolean>) | null = null;
export function triggerInterstitial(placement: AdPlacement): Promise<boolean> {
  if (!trigger) return Promise.resolve(false);
  return trigger(placement);
}

const LS_LAST_PERIODIC = "iv_last_periodic_at";
const LS_LAST_BEFORE_DOWNLOAD = "iv_last_before_download_at";

function lsGetNum(key: string): number {
  try {
    const v = localStorage.getItem(key);
    return v ? parseInt(v, 10) || 0 : 0;
  } catch {
    return 0;
  }
}
function lsSetNum(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore quota */
  }
}

export function InterstitialController() {
  const configFn = useServerFn(getInterstitialConfig);
  const premiumFn = useServerFn(getMyPremiumStatus);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [request, setRequest] = useState<Request>(null);
  const justSignedInRef = useRef(false);

  // Track auth state cheaply (no role lookup).
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setAuthed(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthed(!!session);
      if (event === "SIGNED_IN") {
        justSignedInRef.current = true;
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const cfgQ = useQuery({
    queryKey: ["interstitial-config"],
    queryFn: () => configFn(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const premiumQ = useQuery({
    queryKey: ["my-premium-interstitial-gate"],
    queryFn: () => premiumFn(),
    enabled: authed === true,
    staleTime: 60_000,
    retry: false,
  });

  const cfg: InterstitialConfig | undefined = cfgQ.data;
  const isPremium = !!premiumQ.data?.isPremium;
  const enabled = !!cfg?.enabled && !isPremium;

  // Imperative trigger
  const show = useCallback(
    (placement: AdPlacement) =>
      new Promise<boolean>((resolve) => {
        if (!enabled) {
          resolve(false);
          return;
        }
        if (placement === "interstitial_before_download" && cfg) {
          const cd = cfg.beforeDownloadCooldownMinutes * 60_000;
          if (cd > 0 && Date.now() - lsGetNum(LS_LAST_BEFORE_DOWNLOAD) < cd) {
            resolve(false);
            return;
          }
        }
        setRequest({ placement, resolve });
      }),
    [enabled, cfg],
  );

  useEffect(() => {
    trigger = show;
    return () => {
      if (trigger === show) trigger = null;
    };
  }, [show]);

  // On sign-in trigger
  useEffect(() => {
    if (!enabled || !cfg?.showOnLogin) return;
    if (authed !== true) return;
    if (!justSignedInRef.current) return;
    justSignedInRef.current = false;
    void show("interstitial_login");
  }, [authed, enabled, cfg?.showOnLogin, show]);

  // Periodic trigger
  useEffect(() => {
    if (!enabled || !cfg) return;
    const intervalMs = cfg.periodicMinutes * 60_000;
    if (intervalMs <= 0) return;

    const tick = () => {
      const last = lsGetNum(LS_LAST_PERIODIC);
      if (Date.now() - last >= intervalMs && document.visibilityState === "visible") {
        void show("interstitial_periodic");
      }
    };
    // Initial delay so we don't slam users immediately on every page load.
    const initial = setTimeout(tick, Math.min(intervalMs, 60_000));
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [enabled, cfg, show]);

  if (!request) return null;

  return (
    <VideoInterstitial
      placement={request.placement}
      cancelSeconds={cfg?.cancelSeconds ?? 12}
      onClose={(reason) => {
        const req = request;
        setRequest(null);
        if (req?.placement === "interstitial_periodic") {
          lsSetNum(LS_LAST_PERIODIC, Date.now());
        }
        if (req?.placement === "interstitial_before_download") {
          lsSetNum(LS_LAST_BEFORE_DOWNLOAD, Date.now());
        }
        req?.resolve(reason !== "no-ad");
      }}
    />
  );
}
