CREATE TABLE IF NOT EXISTS public.ad_events (
  id bigserial PRIMARY KEY,
  ad_id uuid NOT NULL REFERENCES public.ads(id) ON DELETE CASCADE,
  placement text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('impression','click')),
  user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_events_ad_id_type_idx ON public.ad_events (ad_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ad_events_placement_idx ON public.ad_events (placement, created_at DESC);
GRANT SELECT, INSERT ON public.ad_events TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.ad_events_id_seq TO anon, authenticated;
GRANT ALL ON public.ad_events TO service_role;
GRANT ALL ON SEQUENCE public.ad_events_id_seq TO service_role;
ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can insert ad events" ON public.ad_events FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "admins read ad events" ON public.ad_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));