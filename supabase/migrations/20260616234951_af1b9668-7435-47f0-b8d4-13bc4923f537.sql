-- Backfill telegram_ingest.channel_id and media_files.channel_id from
-- telegram_ingest.telegram_channel_id by matching telegram_channels.channel_id.
UPDATE public.telegram_ingest ti
SET channel_id = tc.id
FROM public.telegram_channels tc
WHERE ti.channel_id IS NULL
  AND ti.telegram_channel_id IS NOT NULL
  AND tc.channel_id = ti.telegram_channel_id;

UPDATE public.media_files mf
SET channel_id = ti.channel_id
FROM public.telegram_ingest ti
WHERE mf.channel_id IS NULL
  AND mf.telegram_message_id IS NOT NULL
  AND ti.telegram_message_id = mf.telegram_message_id
  AND ti.channel_id IS NOT NULL;