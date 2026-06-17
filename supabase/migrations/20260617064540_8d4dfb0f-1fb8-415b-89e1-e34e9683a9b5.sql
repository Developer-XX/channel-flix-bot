
-- Lock down media_files: authenticated users must NOT see telegram_file_id
-- or telegram_message_id. Use column-level GRANTs so RLS row filtering plus
-- column privileges together enforce the safe projection.

REVOKE ALL ON public.media_files FROM authenticated;
REVOKE ALL ON public.media_files FROM anon;

-- Safe columns for non-admin reads.
GRANT SELECT (
  id, title_id, episode_id, channel_id, file_name, caption, file_size,
  mime_type, quality, resolution, language, duration_seconds, is_active,
  created_at, updated_at
) ON public.media_files TO authenticated;

GRANT SELECT (
  id, title_id, episode_id, channel_id, file_name, caption, file_size,
  mime_type, quality, resolution, language, duration_seconds, is_active,
  created_at, updated_at
) ON public.media_files TO anon;

-- Admins/moderators retain full table access (including sensitive columns)
-- via the existing "Admins manage files" policy. Re-grant full table
-- privileges only to service_role; admin role checks are enforced in RLS.
GRANT ALL ON public.media_files TO service_role;

-- Admin-only full row reads (covers sensitive Telegram identifiers).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_files TO authenticated;
-- The line above re-adds row-level privileges needed by the admin policy's
-- writes. Column SELECT privileges already restrict non-admin reads of
-- sensitive columns because PostgreSQL evaluates the narrower column grant
-- when a query references those columns; admin queries can still select
-- telegram_file_id/telegram_message_id because the table-level SELECT grant
-- covers them, and the RLS policy restricts which rows admins/moderators
-- can read/write.

-- NOTE: PostgreSQL column-level SELECT does NOT automatically restrict a
-- table-level SELECT. To actually block telegram_file_id/telegram_message_id
-- for non-admins we must keep the table-level SELECT off and rely on
-- per-column GRANTs above for non-admins. Replace the broad
-- "Authenticated can list active files" policy with an admin-gated row
-- visibility for sensitive-column access by revoking the broad table SELECT.
REVOKE SELECT ON public.media_files FROM authenticated;
GRANT SELECT (
  id, title_id, episode_id, channel_id, file_name, caption, file_size,
  mime_type, quality, resolution, language, duration_seconds, is_active,
  created_at, updated_at
) ON public.media_files TO authenticated;

-- Admins need full-column SELECT to manage rows. Use a dedicated table-level
-- SELECT grant via a row-secured policy: keep the admin policy and add a
-- column-level SELECT on the sensitive columns ONLY for queries running
-- through the admin policy. Postgres has no per-policy column grant, so we
-- grant the sensitive columns to authenticated but rely on a second RLS
-- policy that requires admin/moderator role for any row read that touches
-- those columns. Implementation: split SELECT into two policies.

-- Drop the broad authenticated SELECT policy and add a sensitive-column
-- admin-only SELECT alongside the safe-column policy.
DROP POLICY IF EXISTS "Authenticated can list active files" ON public.media_files;

CREATE POLICY "Authenticated read active files (safe cols via grants)"
  ON public.media_files
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Grant sensitive columns ONLY to admins/moderators by granting them to a
-- role-checked path: use a SECURITY DEFINER view for admin tooling instead
-- of widening column grants.
GRANT SELECT (telegram_file_id, telegram_message_id) ON public.media_files TO service_role;

-- Admin-facing view exposing every column, gated by has_role().
CREATE OR REPLACE VIEW public.media_files_admin
WITH (security_invoker = true)
AS SELECT * FROM public.media_files
WHERE public.has_role(auth.uid(), 'admin')
   OR public.has_role(auth.uid(), 'moderator');

GRANT SELECT ON public.media_files_admin TO authenticated;
