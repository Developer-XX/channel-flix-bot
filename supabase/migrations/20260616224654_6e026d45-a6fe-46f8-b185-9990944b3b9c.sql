-- 1. Table
CREATE TABLE public.web_vitals_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  route text NOT NULL,
  metric text NOT NULL CHECK (metric IN ('LCP','CLS','INP','FCP','TTFB','TBT')),
  value numeric NOT NULL,
  rating text CHECK (rating IN ('good','needs-improvement','poor')),
  navigation_type text,
  viewport_width integer,
  viewport_height integer,
  device_pixel_ratio numeric,
  connection_type text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX web_vitals_events_created_at_idx ON public.web_vitals_events (created_at DESC);
CREATE INDEX web_vitals_events_route_metric_idx ON public.web_vitals_events (route, metric, created_at DESC);

-- 2. Grants
GRANT INSERT ON public.web_vitals_events TO anon, authenticated;
GRANT SELECT ON public.web_vitals_events TO authenticated;
GRANT ALL ON public.web_vitals_events TO service_role;

-- 3. RLS
ALTER TABLE public.web_vitals_events ENABLE ROW LEVEL SECURITY;

-- Anyone can insert a beacon. We do not expose UPDATE/DELETE to anon/authenticated.
CREATE POLICY "anyone can insert vitals"
  ON public.web_vitals_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only admins can read.
CREATE POLICY "admins can read vitals"
  ON public.web_vitals_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4. Aggregated summary view used by the admin dashboard.
-- p75 / p95 per (route, metric) over the last 7 days.
CREATE OR REPLACE VIEW public.web_vitals_recent_summary
WITH (security_invoker = true) AS
SELECT
  route,
  metric,
  count(*)::bigint                                          AS sample_count,
  round(avg(value)::numeric, 3)                             AS avg_value,
  round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY value))::numeric, 3) AS p50_value,
  round((percentile_cont(0.75) WITHIN GROUP (ORDER BY value))::numeric, 3) AS p75_value,
  round((percentile_cont(0.95) WITHIN GROUP (ORDER BY value))::numeric, 3) AS p95_value,
  sum((rating = 'good')::int)::bigint                       AS good_count,
  sum((rating = 'needs-improvement')::int)::bigint          AS needs_improvement_count,
  sum((rating = 'poor')::int)::bigint                       AS poor_count,
  max(created_at)                                           AS last_seen_at
FROM public.web_vitals_events
WHERE created_at >= now() - interval '7 days'
GROUP BY route, metric;

GRANT SELECT ON public.web_vitals_recent_summary TO authenticated;
GRANT SELECT ON public.web_vitals_recent_summary TO service_role;