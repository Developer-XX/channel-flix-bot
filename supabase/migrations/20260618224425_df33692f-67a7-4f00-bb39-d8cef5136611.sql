-- Phase 1 telegram: backfill cursor + delivery retry/dedupe enhancements

-- Track backfill progress per channel (used by external MTProto script)
ALTER TABLE public.telegram_channels
  ADD COLUMN IF NOT EXISTS backfill_cursor bigint,
  ADD COLUMN IF NOT EXISTS backfill_last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS backfill_ingested_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backfill_status text;

-- Delivery: track attempt_no growth, last error for diagnostics
-- (delivery_attempts already has idempotency_key UNIQUE + status text;
--  we just add retry telemetry columns)
ALTER TABLE public.delivery_attempts
  ADD COLUMN IF NOT EXISTS last_retry_after_ms integer,
  ADD COLUMN IF NOT EXISTS reused_from_cooldown boolean NOT NULL DEFAULT false;

-- Index lookups by (user, file, idempotency_key) used by cooldown-window dedupe.
CREATE INDEX IF NOT EXISTS delivery_attempts_user_file_idx
  ON public.delivery_attempts(user_id, media_file_id, created_at DESC);
