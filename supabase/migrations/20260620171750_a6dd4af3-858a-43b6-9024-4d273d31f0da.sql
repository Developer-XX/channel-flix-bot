
CREATE TABLE IF NOT EXISTS public.telegram_sync_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL,
  source text NOT NULL,
  step text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','error','warn','skipped')),
  error_code text,
  error_message text,
  latency_ms integer,
  channel_id bigint,
  update_id bigint,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.telegram_sync_steps TO authenticated;
GRANT ALL ON public.telegram_sync_steps TO service_role;

ALTER TABLE public.telegram_sync_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and moderators read sync steps"
ON public.telegram_sync_steps FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'moderator'::app_role)
);

CREATE INDEX IF NOT EXISTS idx_telegram_sync_steps_created_at
  ON public.telegram_sync_steps (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_sync_steps_run_id
  ON public.telegram_sync_steps (run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_telegram_sync_steps_status_created
  ON public.telegram_sync_steps (status, created_at DESC);
