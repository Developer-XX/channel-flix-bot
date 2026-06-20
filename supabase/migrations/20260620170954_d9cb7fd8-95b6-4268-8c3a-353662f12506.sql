
-- 1) verification_tokens: drop user SELECT policy and remove any anon/auth SELECT
DROP POLICY IF EXISTS "user reads own tokens" ON public.verification_tokens;
REVOKE SELECT ON public.verification_tokens FROM anon, authenticated;

-- 2) google_oauth_credentials: revoke client_secret read from authenticated/anon
REVOKE ALL ON public.google_oauth_credentials FROM anon, authenticated;
GRANT SELECT (id, client_id, redirect_uri, updated_by, updated_at, created_at) ON public.google_oauth_credentials TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.google_oauth_credentials TO authenticated;
GRANT ALL ON public.google_oauth_credentials TO service_role;

-- 3) telegram_ingest: revoke SELECT on sensitive columns from authenticated
REVOKE SELECT ON public.telegram_ingest FROM anon, authenticated;
GRANT SELECT (
  id, channel_id, telegram_channel_id, file_name, caption, mime_type, file_size,
  duration_seconds, parsed_title, parsed_year, parsed_season, parsed_episode,
  parsed_quality, parsed_resolution, parsed_codec, parsed_language, match_status,
  matched_title_id, match_score, promoted_media_file_id, created_at, updated_at,
  parsed_category, update_id, last_error, deleted_at, deleted_by, deleted_reason,
  idempotency_key
) ON public.telegram_ingest TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.telegram_ingest TO authenticated;
GRANT ALL ON public.telegram_ingest TO service_role;
