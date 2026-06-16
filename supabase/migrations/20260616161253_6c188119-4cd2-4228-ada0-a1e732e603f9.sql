
CREATE TYPE public.ingest_status AS ENUM ('pending','matched','unmatched','ignored');

CREATE TABLE public.telegram_ingest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES public.telegram_channels(id) ON DELETE CASCADE,
  telegram_channel_id bigint NOT NULL,
  telegram_message_id bigint NOT NULL,
  telegram_file_id text,
  telegram_file_unique_id text,
  file_name text,
  caption text,
  mime_type text,
  file_size bigint,
  duration_seconds integer,
  parsed_title text,
  parsed_year integer,
  parsed_season integer,
  parsed_episode integer,
  parsed_quality text,
  parsed_resolution text,
  parsed_codec text,
  parsed_language text,
  match_status public.ingest_status NOT NULL DEFAULT 'pending',
  matched_title_id uuid REFERENCES public.master_titles(id) ON DELETE SET NULL,
  match_score numeric(4,3),
  promoted_media_file_id uuid REFERENCES public.media_files(id) ON DELETE SET NULL,
  raw_update jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_channel_id, telegram_message_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_ingest TO authenticated;
GRANT ALL ON public.telegram_ingest TO service_role;

ALTER TABLE public.telegram_ingest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and moderators manage ingest"
ON public.telegram_ingest
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator'));

CREATE TRIGGER telegram_ingest_updated_at
BEFORE UPDATE ON public.telegram_ingest
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_telegram_ingest_status ON public.telegram_ingest(match_status);
CREATE INDEX idx_telegram_ingest_channel ON public.telegram_ingest(channel_id);

-- Per-channel message dedupe for actual media files
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_files_channel_message
  ON public.media_files(channel_id, telegram_message_id)
  WHERE channel_id IS NOT NULL AND telegram_message_id IS NOT NULL;
