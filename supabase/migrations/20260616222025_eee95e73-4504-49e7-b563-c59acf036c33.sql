CREATE TABLE public.sync_trace_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL,
  source TEXT NOT NULL,
  title_id UUID,
  title_slug TEXT,
  channel_id BIGINT,
  message_id BIGINT,
  ingest_id UUID,
  season_number INT,
  episode_number INT,
  decision TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_trace_log_run_id ON public.sync_trace_log(run_id);
CREATE INDEX idx_sync_trace_log_title_id ON public.sync_trace_log(title_id);
CREATE INDEX idx_sync_trace_log_created_at ON public.sync_trace_log(created_at DESC);

GRANT SELECT ON public.sync_trace_log TO authenticated;
GRANT ALL ON public.sync_trace_log TO service_role;

ALTER TABLE public.sync_trace_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read sync trace log"
  ON public.sync_trace_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));