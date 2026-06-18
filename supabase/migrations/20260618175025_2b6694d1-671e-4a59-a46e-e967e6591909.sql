
-- 1. Profiles: restrict authenticated SELECT to own row; admin-scoped policy for full access
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.profiles;

CREATE POLICY "Users can read their own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));

-- 2. Download logs: let users see their own history
CREATE POLICY "Users see their own download logs"
  ON public.download_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 3. Media files: explicitly revoke sensitive columns from anon as defense-in-depth
REVOKE SELECT (telegram_file_id, telegram_message_id) ON public.media_files FROM anon;
REVOKE SELECT (telegram_file_id, telegram_message_id) ON public.media_files FROM authenticated;
-- Re-grant safe columns explicitly to authenticated (mirrors anon grant pattern)
GRANT SELECT (id, title_id, episode_id, file_name, caption, file_size, mime_type, quality, resolution, language, duration_seconds, is_active, created_at, updated_at) ON public.media_files TO authenticated;

COMMENT ON COLUMN public.media_files.telegram_file_id IS 'SENSITIVE: server-only. Never GRANT SELECT to anon or authenticated. Access via media_files_admin view or service_role.';
COMMENT ON COLUMN public.media_files.telegram_message_id IS 'SENSITIVE: server-only. Never GRANT SELECT to anon or authenticated. Access via media_files_admin view or service_role.';
