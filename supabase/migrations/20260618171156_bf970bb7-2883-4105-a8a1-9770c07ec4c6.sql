-- Telegram broadcast subscribers: every Telegram user who DMs the bot is
-- captured here so admins can broadcast announcements + forwarded posts.
CREATE TABLE IF NOT EXISTS public.telegram_broadcast_subscribers (
  telegram_user_id  BIGINT PRIMARY KEY,
  chat_id           BIGINT NOT NULL,
  username          TEXT,
  first_name        TEXT,
  language_code     TEXT,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked           BOOLEAN NOT NULL DEFAULT false,
  blocked_at        TIMESTAMPTZ
);

GRANT SELECT ON public.telegram_broadcast_subscribers TO authenticated;
GRANT ALL ON public.telegram_broadcast_subscribers TO service_role;

ALTER TABLE public.telegram_broadcast_subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view subscribers"
  ON public.telegram_broadcast_subscribers
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_tg_subscribers_active
  ON public.telegram_broadcast_subscribers (last_seen_at DESC)
  WHERE blocked = false;

-- Broadcast runs: audit trail of /broadcast invocations.
CREATE TABLE IF NOT EXISTS public.telegram_broadcast_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiated_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  initiated_via   TEXT NOT NULL DEFAULT 'bot', -- 'bot' | 'web'
  source_kind     TEXT NOT NULL,               -- 'forwarded_copy' | 'text'
  source_chat_id  BIGINT,
  source_msg_id   BIGINT,
  text_preview    TEXT,
  total_targets   INTEGER NOT NULL DEFAULT 0,
  success_count   INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  error_sample    TEXT
);

GRANT SELECT ON public.telegram_broadcast_runs TO authenticated;
GRANT ALL ON public.telegram_broadcast_runs TO service_role;

ALTER TABLE public.telegram_broadcast_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view broadcast runs"
  ON public.telegram_broadcast_runs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));