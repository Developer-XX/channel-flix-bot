DROP POLICY IF EXISTS "anyone can insert vitals" ON public.web_vitals_events;

CREATE POLICY "anyone can insert valid vitals"
  ON public.web_vitals_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(session_id) BETWEEN 1 AND 64
    AND length(route) BETWEEN 1 AND 512
    AND length(coalesce(user_agent, '')) <= 1024
    AND length(coalesce(navigation_type, '')) <= 32
    AND length(coalesce(connection_type, '')) <= 32
    AND value >= 0
    AND value <= 1000000
    AND coalesce(viewport_width, 0)  BETWEEN 0 AND 10000
    AND coalesce(viewport_height, 0) BETWEEN 0 AND 10000
    AND coalesce(device_pixel_ratio, 1) BETWEEN 0 AND 16
    AND (user_id IS NULL OR user_id = auth.uid())
  );