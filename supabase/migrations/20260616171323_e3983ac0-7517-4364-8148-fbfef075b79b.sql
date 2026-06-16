
ALTER TABLE public.telegram_channels
  ADD COLUMN IF NOT EXISTS confirm_with_reply boolean NOT NULL DEFAULT false;

ALTER TABLE public.telegram_bot_state
  ADD COLUMN IF NOT EXISTS admin_telegram_user_ids bigint[] NOT NULL DEFAULT '{}'::bigint[];
