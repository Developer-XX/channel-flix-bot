
CREATE TABLE public.admin_error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  fn_export text,
  fn_file text,
  user_id uuid,
  status int,
  error_message text,
  error_stack text,
  duration_ms int,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_error_log_created ON public.admin_error_log (created_at DESC);
CREATE INDEX idx_admin_error_log_fn_export ON public.admin_error_log (fn_export);
GRANT SELECT ON public.admin_error_log TO authenticated;
GRANT ALL ON public.admin_error_log TO service_role;
ALTER TABLE public.admin_error_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read error log" ON public.admin_error_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
