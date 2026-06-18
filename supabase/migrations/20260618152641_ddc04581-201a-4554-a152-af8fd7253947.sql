CREATE TABLE IF NOT EXISTS public.onboarding_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  session_id TEXT,
  event TEXT NOT NULL CHECK (event IN ('opened','completed','skipped','source_admin_preview')),
  video_type TEXT,
  video_url TEXT,
  watched_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_recent
  ON public.onboarding_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_event
  ON public.onboarding_events (event, created_at DESC);

GRANT SELECT, INSERT ON public.onboarding_events TO authenticated;
GRANT INSERT ON public.onboarding_events TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.onboarding_events_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.onboarding_events_id_seq TO anon;
GRANT ALL ON public.onboarding_events TO service_role;
GRANT ALL ON SEQUENCE public.onboarding_events_id_seq TO service_role;

ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert onboarding events" ON public.onboarding_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins read onboarding events" ON public.onboarding_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));