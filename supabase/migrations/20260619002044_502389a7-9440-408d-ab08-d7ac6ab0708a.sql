
-- Lock down sensitive columns on delivery_attempts and download_send_queue.
-- All app code reads these via service_role (supabaseAdmin), so we revoke
-- table-level grants from authenticated/anon and grant only safe columns.

REVOKE ALL ON public.delivery_attempts FROM authenticated, anon;
GRANT ALL ON public.delivery_attempts TO service_role;
GRANT SELECT (id, user_id, media_file_id, idempotency_key, attempt_no, status, error, history, created_at, updated_at, last_retry_after_ms, reused_from_cooldown) ON public.delivery_attempts TO authenticated;

REVOKE ALL ON public.download_send_queue FROM authenticated, anon;
GRANT ALL ON public.download_send_queue TO service_role;
GRANT SELECT (idempotency_key, user_id, file_id, title_id, status, attempts, max_attempts, last_error, next_attempt_at, reused_from_cooldown, created_at, updated_at, sent_at) ON public.download_send_queue TO authenticated;
