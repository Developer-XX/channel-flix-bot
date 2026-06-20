CREATE TABLE IF NOT EXISTS public.cron_job_locks (
  job_name text PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  holder text
);

GRANT ALL ON public.cron_job_locks TO service_role;
ALTER TABLE public.cron_job_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only"
  ON public.cron_job_locks
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.try_acquire_cron_lock(
  _job_name text,
  _ttl_seconds integer DEFAULT 300,
  _holder text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted boolean := false;
BEGIN
  -- Clear an expired lock so a stuck/crashed run doesn't block forever.
  DELETE FROM public.cron_job_locks
   WHERE job_name = _job_name AND expires_at < now();

  INSERT INTO public.cron_job_locks(job_name, locked_at, expires_at, holder)
  VALUES (_job_name, now(), now() + make_interval(secs => GREATEST(5, _ttl_seconds)), _holder)
  ON CONFLICT (job_name) DO NOTHING
  RETURNING true INTO inserted;

  RETURN COALESCE(inserted, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_cron_lock(_job_name text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.cron_job_locks WHERE job_name = _job_name;
$$;

REVOKE ALL ON FUNCTION public.try_acquire_cron_lock(text, integer, text) FROM public;
REVOKE ALL ON FUNCTION public.release_cron_lock(text) FROM public;
GRANT EXECUTE ON FUNCTION public.try_acquire_cron_lock(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cron_lock(text) TO service_role;