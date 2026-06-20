
-- 1. Credentials table (singleton enforced by unique partial index)
CREATE TABLE public.google_oauth_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text,
  client_secret text,
  redirect_uri text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX google_oauth_credentials_singleton
  ON public.google_oauth_credentials ((true));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_oauth_credentials TO authenticated;
GRANT ALL ON public.google_oauth_credentials TO service_role;

ALTER TABLE public.google_oauth_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read google oauth credentials"
  ON public.google_oauth_credentials FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins write google oauth credentials"
  ON public.google_oauth_credentials FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER google_oauth_credentials_touch
  BEFORE UPDATE ON public.google_oauth_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Health log
CREATE TABLE public.google_oauth_health_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('quick','full','full_pending')),
  status text NOT NULL CHECK (status IN ('ok','error','pending')),
  error_code text,
  error_message text,
  latency_ms integer,
  checked_by uuid,
  state_token text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX google_oauth_health_log_checked_at_idx
  ON public.google_oauth_health_log (checked_at DESC);

CREATE INDEX google_oauth_health_log_state_token_idx
  ON public.google_oauth_health_log (state_token)
  WHERE state_token IS NOT NULL;

GRANT SELECT ON public.google_oauth_health_log TO authenticated;
GRANT ALL ON public.google_oauth_health_log TO service_role;

ALTER TABLE public.google_oauth_health_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read google oauth health log"
  ON public.google_oauth_health_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. Latest-status helper for the analytics page
CREATE OR REPLACE FUNCTION public.get_google_oauth_latest_health()
RETURNS TABLE (
  checked_at timestamptz,
  kind text,
  status text,
  error_code text,
  error_message text,
  latency_ms integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT checked_at, kind, status, error_code, error_message, latency_ms
    FROM public.google_oauth_health_log
   WHERE kind IN ('quick','full')
     AND public.has_role(auth.uid(), 'admin')
   ORDER BY checked_at DESC
   LIMIT 1;
$$;
