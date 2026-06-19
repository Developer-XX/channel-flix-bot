-- 1) ad_view_log: per-user interstitial view ledger for 24h frequency cap
CREATE TABLE public.ad_view_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  placement text NOT NULL,
  ad_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ad_view_log_user_placement_idx
  ON public.ad_view_log (user_id, placement, created_at DESC);

GRANT SELECT, INSERT ON public.ad_view_log TO authenticated;
GRANT ALL ON public.ad_view_log TO service_role;

ALTER TABLE public.ad_view_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own ad views"
  ON public.ad_view_log
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "users insert own ad views"
  ON public.ad_view_log
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 2) ad_perf_events: anonymous interstitial playback metrics
CREATE TABLE public.ad_perf_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id uuid NULL,
  placement text NOT NULL,
  metric text NOT NULL CHECK (metric IN
    ('ttff_ms','buffer_ms','dropped_frames','autoplay_blocked','video_error')),
  value numeric NOT NULL DEFAULT 0,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ad_perf_events_lookup_idx
  ON public.ad_perf_events (placement, metric, created_at DESC);
CREATE INDEX ad_perf_events_ad_idx
  ON public.ad_perf_events (ad_id, created_at DESC);

GRANT INSERT ON public.ad_perf_events TO anon, authenticated;
GRANT SELECT ON public.ad_perf_events TO authenticated;
GRANT ALL ON public.ad_perf_events TO service_role;

ALTER TABLE public.ad_perf_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perf insert bounded"
  ON public.ad_perf_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(placement) <= 64
    AND (user_agent IS NULL OR length(user_agent) <= 256)
    AND value >= 0
    AND value <= 600000
  );

CREATE POLICY "admins read perf"
  ON public.ad_perf_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
