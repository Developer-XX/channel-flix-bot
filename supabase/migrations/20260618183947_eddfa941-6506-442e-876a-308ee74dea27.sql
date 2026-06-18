CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_window ON public.rate_limit_buckets (window_start);

GRANT ALL ON public.rate_limit_buckets TO service_role;
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rate_limit_buckets_service_only"
  ON public.rate_limit_buckets FOR ALL
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.rl_hit(_key text, _window_sec int, _limit int)
RETURNS TABLE(allowed boolean, used int, lim int, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  wstart timestamptz;
  wend timestamptz;
  cur int;
BEGIN
  wstart := to_timestamp((floor(extract(epoch FROM now()) / _window_sec)::bigint) * _window_sec);
  wend := wstart + make_interval(secs => _window_sec);

  INSERT INTO public.rate_limit_buckets(bucket_key, window_start, count)
    VALUES (_key, wstart, 1)
  ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET count = public.rate_limit_buckets.count + 1
  RETURNING count INTO cur;

  -- best-effort cleanup of very old buckets
  DELETE FROM public.rate_limit_buckets
    WHERE window_start < now() - interval '1 hour';

  RETURN QUERY SELECT (cur <= _limit) AS allowed, cur AS used, _limit AS lim, wend AS reset_at;
END;
$$;
REVOKE ALL ON FUNCTION public.rl_hit(text, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.rl_hit(text, int, int) TO service_role;