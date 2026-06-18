
-- 1) media_files: enforce column-level grants so authenticated/anon cannot read telegram_* or deleted_by/deleted_reason
REVOKE ALL ON TABLE public.media_files FROM authenticated, anon;

GRANT SELECT (
  id, title_id, episode_id, file_name, file_size, mime_type,
  quality, resolution, language, duration_seconds, caption,
  is_active, channel_id, created_at, updated_at, deleted_at
) ON public.media_files TO authenticated, anon;

GRANT ALL ON public.media_files TO service_role;

-- 2) app_settings: allow anon to read the public browsing toggle only
DROP POLICY IF EXISTS "Anon read public browsing toggle" ON public.app_settings;
CREATE POLICY "Anon read public browsing toggle"
  ON public.app_settings
  FOR SELECT
  TO anon
  USING (key = 'PUBLIC_BROWSING_ENABLED' AND is_secret = false);

GRANT SELECT (key, value, is_secret) ON public.app_settings TO anon;
