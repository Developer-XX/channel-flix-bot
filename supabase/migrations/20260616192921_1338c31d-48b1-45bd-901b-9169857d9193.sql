
-- 1) delivery_attempts
CREATE TABLE IF NOT EXISTS public.delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_file_id uuid NOT NULL REFERENCES public.media_files(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  attempt_no int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  error text,
  telegram_message_id bigint,
  bot_user_id bigint,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.delivery_attempts TO authenticated;
GRANT ALL ON public.delivery_attempts TO service_role;
ALTER TABLE public.delivery_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own delivery attempts"
  ON public.delivery_attempts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS delivery_attempts_user_idx ON public.delivery_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_attempts_file_idx ON public.delivery_attempts(media_file_id);

-- 2) bulk_job_runs
CREATE TABLE IF NOT EXISTS public.bulk_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'running',
  total int NOT NULL DEFAULT 0,
  processed int NOT NULL DEFAULT 0,
  promoted int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bulk_job_runs TO authenticated;
GRANT ALL ON public.bulk_job_runs TO service_role;
ALTER TABLE public.bulk_job_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read bulk jobs"
  ON public.bulk_job_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS bulk_job_runs_recent_idx ON public.bulk_job_runs(started_at DESC);

-- 3) user_verifications
CREATE TABLE IF NOT EXISTS public.user_verifications (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_provider text,
  verified_at timestamptz,
  expires_at timestamptz,
  verification_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_verifications TO authenticated;
GRANT ALL ON public.user_verifications TO service_role;
ALTER TABLE public.user_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own verification"
  ON public.user_verifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- 4) verification_tokens (single-use)
CREATE TABLE IF NOT EXISTS public.verification_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  media_file_id uuid REFERENCES public.media_files(id) ON DELETE SET NULL,
  provider text NOT NULL,
  ip_hash text,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.verification_tokens TO authenticated;
GRANT ALL ON public.verification_tokens TO service_role;
ALTER TABLE public.verification_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own tokens"
  ON public.verification_tokens FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS verification_tokens_user_idx ON public.verification_tokens(user_id, created_at DESC);

-- 5) extend download_logs
ALTER TABLE public.download_logs
  ADD COLUMN IF NOT EXISTS verification_status text,
  ADD COLUMN IF NOT EXISTS verification_provider text,
  ADD COLUMN IF NOT EXISTS bot_user_id bigint,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempt_history jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS download_logs_idem_idx ON public.download_logs(idempotency_key);

-- 6) extend telegram_bot_state for auto-rebuild
ALTER TABLE public.telegram_bot_state
  ADD COLUMN IF NOT EXISTS promotions_since_last_index int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_index_rebuild boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS indexes_rebuilding_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_rebuild_threshold int NOT NULL DEFAULT 25;

-- update trigger for tables with updated_at
DROP TRIGGER IF EXISTS trg_delivery_attempts_updated ON public.delivery_attempts;
CREATE TRIGGER trg_delivery_attempts_updated BEFORE UPDATE ON public.delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_bulk_job_runs_updated ON public.bulk_job_runs;
CREATE TRIGGER trg_bulk_job_runs_updated BEFORE UPDATE ON public.bulk_job_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_user_verifications_updated ON public.user_verifications;
CREATE TRIGGER trg_user_verifications_updated BEFORE UPDATE ON public.user_verifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
