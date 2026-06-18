ALTER TABLE public.ad_events DROP CONSTRAINT IF EXISTS ad_events_event_type_check;
ALTER TABLE public.ad_events ADD CONSTRAINT ad_events_event_type_check
  CHECK (event_type = ANY (ARRAY['impression'::text, 'click'::text, 'view'::text, 'complete'::text, 'dismiss'::text]));