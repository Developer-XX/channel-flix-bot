
-- 1. media_files: ensure sensitive columns are not readable by anon, even if policy is permissive
REVOKE SELECT ON public.media_files FROM anon;
GRANT SELECT (
  id, title_id, episode_id, file_name, caption, file_size, mime_type,
  quality, resolution, language, duration_seconds, is_active, created_at, updated_at
) ON public.media_files TO anon;

-- Replace permissive public policy with a scoped one (still allows public listing of active rows,
-- but combined with column grants above anon cannot read telegram_file_id / telegram_message_id).
DROP POLICY IF EXISTS "Active files are listable" ON public.media_files;
CREATE POLICY "Anon can list active files (safe columns only)"
  ON public.media_files FOR SELECT TO anon
  USING (is_active = true);
CREATE POLICY "Authenticated can list active files"
  ON public.media_files FOR SELECT TO authenticated
  USING (is_active = true);

-- 2. telegram_bot_state: remove anon access entirely (server-only via service role)
DROP POLICY IF EXISTS "Public reads cache version" ON public.telegram_bot_state;
REVOKE SELECT ON public.telegram_bot_state FROM anon;

-- 3. profiles: restrict reads to authenticated users
DROP POLICY IF EXISTS "Profiles are readable by everyone" ON public.profiles;
REVOKE SELECT ON public.profiles FROM anon;
CREATE POLICY "Authenticated users can read profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (true);

-- 4. Lock down SECURITY DEFINER functions exposed via Data API
REVOKE ALL ON FUNCTION public.wipe_application_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wipe_application_data() TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
-- has_role must remain executable by authenticated (used inside RLS policy expressions).
