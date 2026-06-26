CREATE TABLE IF NOT EXISTS public.engagement_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  session_id TEXT,
  event TEXT NOT NULL CHECK (event IN (
    'support_popup_impression',
    'support_popup_join_click',
    'support_popup_dismiss',
    'preflight_impression',
    'preflight_verify_click',
    'preflight_join_click'
  )),
  surface TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_engagement_events_recent ON public.engagement_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_events_event ON public.engagement_events (event, created_at DESC);
GRANT SELECT, INSERT ON public.engagement_events TO authenticated;
GRANT INSERT ON public.engagement_events TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.engagement_events_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.engagement_events_id_seq TO anon;
GRANT ALL ON public.engagement_events TO service_role;
GRANT ALL ON SEQUENCE public.engagement_events_id_seq TO service_role;
ALTER TABLE public.engagement_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert engagement events" ON public.engagement_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY "Admins read engagement events" ON public.engagement_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));