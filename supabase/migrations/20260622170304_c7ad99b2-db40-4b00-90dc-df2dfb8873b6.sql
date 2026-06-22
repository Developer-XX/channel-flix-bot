ALTER TABLE public.media_files ADD COLUMN IF NOT EXISTS telegram_file_unique_id text;

UPDATE public.media_files mf
   SET telegram_file_unique_id = ti.telegram_file_unique_id
  FROM public.telegram_ingest ti
 WHERE mf.telegram_file_unique_id IS NULL
   AND ti.telegram_file_id = mf.telegram_file_id
   AND ti.telegram_file_unique_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_files_unique_file_unique
  ON public.media_files (telegram_file_unique_id)
  WHERE telegram_file_unique_id IS NOT NULL;