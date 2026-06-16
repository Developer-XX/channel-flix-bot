
-- 1) Extend telegram_ingest
ALTER TABLE public.telegram_ingest
  ADD COLUMN IF NOT EXISTS parsed_category public.content_category,
  ADD COLUMN IF NOT EXISTS update_id BIGINT,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Dedup by Telegram's stable file identifier (when present)
CREATE UNIQUE INDEX IF NOT EXISTS telegram_ingest_file_unique_idx
  ON public.telegram_ingest (telegram_file_unique_id)
  WHERE telegram_file_unique_id IS NOT NULL;

-- 2) Webhook event log (strict idempotency on update_id)
CREATE TABLE IF NOT EXISTS public.telegram_webhook_events (
  update_id BIGINT PRIMARY KEY,
  telegram_channel_id BIGINT,
  telegram_message_id BIGINT,
  source TEXT NOT NULL DEFAULT 'webhook', -- 'webhook' | 'backfill'
  status TEXT NOT NULL DEFAULT 'received', -- 'received' | 'processed' | 'ignored' | 'error'
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.telegram_webhook_events TO authenticated;
GRANT ALL ON public.telegram_webhook_events TO service_role;
ALTER TABLE public.telegram_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view webhook events"
  ON public.telegram_webhook_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) Bot polling state (for scheduled backfill via getUpdates)
CREATE TABLE IF NOT EXISTS public.telegram_bot_state (
  id TEXT PRIMARY KEY,
  last_update_id BIGINT NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  last_run_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.telegram_bot_state (id, last_update_id)
VALUES ('global', 0)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.telegram_bot_state TO authenticated;
GRANT ALL ON public.telegram_bot_state TO service_role;
ALTER TABLE public.telegram_bot_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view bot state"
  ON public.telegram_bot_state FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_telegram_bot_state_updated_at
  BEFORE UPDATE ON public.telegram_bot_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
