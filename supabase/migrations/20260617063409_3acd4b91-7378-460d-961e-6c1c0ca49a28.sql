
-- 1) app_settings ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read settings" ON public.app_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins write settings" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_app_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_app_settings_updated_at();

-- Seed editable keys (NULL values fall back to process.env in code)
INSERT INTO public.app_settings (key, value, is_secret, description) VALUES
  ('PUBLIC_BASE_URL',              NULL, false, 'Public website origin used in all redirects & shortener targets.'),
  ('TMDB_API_KEY',                 NULL, true,  'TMDB v3 API key for metadata enrichment.'),
  ('ADRINOLINKS_API_KEY',          NULL, true,  'AdrinoLinks shortener API key.'),
  ('NANOLINKS_API_KEY',            NULL, true,  'NanoLinks shortener API key.'),
  ('VERIFICATION_WINDOW_MINUTES',  NULL, false, 'Minutes a verification grant is valid before re-verification.'),
  ('VERIFICATION_MAX_PER_HOUR',    NULL, false, 'Max verification token mints per user per hour.'),
  ('SHORTENER_TOKEN_TTL_SECONDS',  '1800', false, 'TTL (seconds) for a freshly minted verification/shortener token. Default 1800 = 30 min.')
ON CONFLICT (key) DO NOTHING;

-- 2) shortener_health_log -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shortener_health_log (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok BOOLEAN NOT NULL,
  latency_ms INTEGER,
  http_status INTEGER,
  error TEXT,
  source TEXT
);

CREATE INDEX IF NOT EXISTS idx_shortener_health_recent
  ON public.shortener_health_log (provider, checked_at DESC);

GRANT SELECT, INSERT ON public.shortener_health_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.shortener_health_log_id_seq TO authenticated;
GRANT ALL ON public.shortener_health_log TO service_role;
GRANT ALL ON SEQUENCE public.shortener_health_log_id_seq TO service_role;

ALTER TABLE public.shortener_health_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read shortener health" ON public.shortener_health_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) telegram_ingest.idempotency_key -----------------------------------------
ALTER TABLE public.telegram_ingest
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Backfill from natural key (channel + message)
UPDATE public.telegram_ingest
SET idempotency_key = telegram_channel_id::text || ':' || telegram_message_id::text
WHERE idempotency_key IS NULL
  AND telegram_channel_id IS NOT NULL
  AND telegram_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_ingest_idempotency_key
  ON public.telegram_ingest (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fill_telegram_ingest_idempotency_key()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.idempotency_key IS NULL
     AND NEW.telegram_channel_id IS NOT NULL
     AND NEW.telegram_message_id IS NOT NULL THEN
    NEW.idempotency_key := NEW.telegram_channel_id::text || ':' || NEW.telegram_message_id::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_telegram_ingest_idempotency_key ON public.telegram_ingest;
CREATE TRIGGER trg_telegram_ingest_idempotency_key
  BEFORE INSERT OR UPDATE ON public.telegram_ingest
  FOR EACH ROW EXECUTE FUNCTION public.fill_telegram_ingest_idempotency_key();
