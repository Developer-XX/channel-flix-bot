-- Tighten exposure of sensitive columns/tables to the authenticated role.
-- All legitimate reads happen via server functions using the service role.

-- 1) verification_tokens: revoke direct SELECT (server uses service role).
DROP POLICY IF EXISTS "Users can view own verification tokens" ON public.verification_tokens;
DROP POLICY IF EXISTS "verification_tokens_select_own" ON public.verification_tokens;
DROP POLICY IF EXISTS "Users select own tokens" ON public.verification_tokens;
REVOKE SELECT ON public.verification_tokens FROM authenticated, anon;

-- 2) telegram_user_links: revoke direct SELECT. getMyTelegramLink now uses service role.
DROP POLICY IF EXISTS "Users can view own telegram link" ON public.telegram_user_links;
DROP POLICY IF EXISTS "telegram_user_links_select_own" ON public.telegram_user_links;
DROP POLICY IF EXISTS "Users select own link" ON public.telegram_user_links;
REVOKE SELECT ON public.telegram_user_links FROM authenticated, anon;

-- 3) download_send_queue: revoke direct SELECT (chat_id/bot_user_id are internal).
DROP POLICY IF EXISTS "Users can view own queue rows" ON public.download_send_queue;
DROP POLICY IF EXISTS "download_send_queue_select_own" ON public.download_send_queue;
DROP POLICY IF EXISTS "Users select own queue" ON public.download_send_queue;
REVOKE SELECT ON public.download_send_queue FROM authenticated, anon;

-- 4) media_files: hide telegram_file_id / telegram_message_id / deleted_by / deleted_reason
--    from anon and authenticated while preserving public/anon access to safe columns.
REVOKE SELECT ON public.media_files FROM authenticated, anon;
GRANT SELECT (
  id, title_id, episode_id, channel_id,
  file_name, caption, mime_type, file_size, duration_seconds,
  quality, resolution, language,
  is_active, deleted_at, created_at, updated_at
) ON public.media_files TO authenticated, anon;
