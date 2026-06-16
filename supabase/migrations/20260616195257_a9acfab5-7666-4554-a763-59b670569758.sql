-- 1. index_rebuild_runs: audit + atomic single-instance lock
CREATE TABLE public.index_rebuild_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  skipped boolean NOT NULL DEFAULT false,
  skip_reason text,
  trigger text NOT NULL DEFAULT 'cron',
  result jsonb,
  error text
);
GRANT SELECT ON public.index_rebuild_runs TO authenticated;
GRANT ALL ON public.index_rebuild_runs TO service_role;
ALTER TABLE public.index_rebuild_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read rebuild runs"
  ON public.index_rebuild_runs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Only one in-flight (not skipped, not finished) row at a time.
CREATE UNIQUE INDEX index_rebuild_runs_single_inflight
  ON public.index_rebuild_runs ((true))
  WHERE finished_at IS NULL AND skipped = false;

-- 2. bulk_job_runs: per-title results + filter snapshot
ALTER TABLE public.bulk_job_runs
  ADD COLUMN IF NOT EXISTS results jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS filters jsonb;

-- 3. verification_provider_calls: audit shortener API usage (NO raw keys)
CREATE TABLE public.verification_provider_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider text NOT NULL,
  status text NOT NULL,            -- 'ok' | 'fallback' | 'error' | 'no_key'
  http_status integer,
  latency_ms integer,
  key_fingerprint text,            -- e.g. 'sha256:ab12..' (never raw key)
  short_url_returned boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.verification_provider_calls TO authenticated;
GRANT ALL ON public.verification_provider_calls TO service_role;
ALTER TABLE public.verification_provider_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read provider call audit"
  ON public.verification_provider_calls FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX verification_provider_calls_created_at_idx
  ON public.verification_provider_calls (created_at DESC);