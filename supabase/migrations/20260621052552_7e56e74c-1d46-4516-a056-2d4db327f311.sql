-- Restore missing SELECT grant on telegram_ingest for authenticated role
GRANT SELECT ON public.telegram_ingest TO authenticated;

-- Lock all manually-matched Bheem files so re-deploys / auto revalidate can't demote them.
-- Match every Bheem-related ingest row to "Mighty Little Bheem" (admin originally assigned them),
-- and flip match_locked = true to prevent further auto-demotion.
UPDATE public.telegram_ingest
   SET matched_title_id = '606f0f4f-fb51-4b59-924e-9fa5337a9f45',
       match_status = 'matched',
       match_locked = true,
       last_error = NULL
 WHERE (parsed_title ILIKE '%bheem%' OR file_name ILIKE '%bheem%' OR caption ILIKE '%bheem%')
   AND deleted_at IS NULL;

-- Re-run grants drift check so the alert clears.
SELECT public.check_telegram_ingest_grants();