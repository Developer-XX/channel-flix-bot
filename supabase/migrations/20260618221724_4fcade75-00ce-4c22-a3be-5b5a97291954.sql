-- Add interstitial placements to ad_placement enum so the admin can save
-- video/interstitial ads (was failing with "invalid input value for enum").
ALTER TYPE public.ad_placement ADD VALUE IF NOT EXISTS 'interstitial_login';
ALTER TYPE public.ad_placement ADD VALUE IF NOT EXISTS 'interstitial_periodic';
ALTER TYPE public.ad_placement ADD VALUE IF NOT EXISTS 'interstitial_before_download';

-- Queue of bot-DM messages to delete on a delay (auto-cleanup of delivered
-- files from the user's chat). Processed by a cron-driven hook route.
CREATE TABLE IF NOT EXISTS public.scheduled_message_deletes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  message_id bigint NOT NULL,
  user_id uuid,
  media_file_id uuid,
  delete_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.scheduled_message_deletes TO service_role;

ALTER TABLE public.scheduled_message_deletes ENABLE ROW LEVEL SECURITY;

-- Admin-only read; writes happen via service role from server functions.
CREATE POLICY "Admins read scheduled deletes" ON public.scheduled_message_deletes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_scheduled_deletes_due
  ON public.scheduled_message_deletes (delete_at)
  WHERE done_at IS NULL;