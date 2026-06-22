-- Reliable Telegram webhook delivery: store raw_update so we can ack Telegram
-- immediately and retry processing via cron when the in-request ingest fails
-- or times out. This stops Telegram from dropping caption edits.

ALTER TABLE public.telegram_webhook_events
  ADD COLUMN IF NOT EXISTS raw_update jsonb,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_telegram_webhook_events_pending
  ON public.telegram_webhook_events (received_at)
  WHERE processed_at IS NULL AND raw_update IS NOT NULL;

-- Drain pending webhook events every minute. The HTTP handler walks rows
-- whose ingest never completed (status received/error, no processed_at, older
-- than 30 seconds) and re-runs ingestTelegramUpdate against the stored
-- raw_update. Idempotent: ingest upserts by (channel, message_id) /
-- telegram_file_id, so re-processing the same payload is safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('telegram-retry-pending-1min')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'telegram-retry-pending-1min');
    PERFORM cron.schedule(
      'telegram-retry-pending-1min',
      '* * * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://project--ehjkzvddtgljntwwasui-dev.lovable.app/api/public/hooks/telegram-retry-pending',
        headers := '{"Content-Type":"application/json","apikey":"sb_publishable_Nry_xjm60dRoxI6pZxnleQ_oJo4d1P8"}'::jsonb,
        body := '{}'::jsonb
      );
      $cron$
    );
  END IF;
END $$;