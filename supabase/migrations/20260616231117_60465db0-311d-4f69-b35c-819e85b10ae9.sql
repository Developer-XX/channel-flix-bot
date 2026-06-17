
-- Wipe all data from public-schema tables (preserve schema, secrets, and configuration)
TRUNCATE TABLE
  public.access_audit_log,
  public.auth_rate_limits,
  public.bulk_job_runs,
  public.content_requests,
  public.delivery_attempts,
  public.download_logs,
  public.episodes,
  public.idx_latest_releases,
  public.idx_search,
  public.idx_trending,
  public.index_rebuild_runs,
  public.master_titles,
  public.match_audit_log,
  public.media_files,
  public.profiles,
  public.seasons,
  public.sync_trace_log,
  public.telegram_bot_state,
  public.telegram_channels,
  public.telegram_ingest,
  public.telegram_user_links,
  public.telegram_webhook_events,
  public.title_aliases,
  public.user_roles,
  public.user_verifications,
  public.verification_provider_calls,
  public.verification_tokens,
  public.web_vitals_events
RESTART IDENTITY CASCADE;

-- Wipe all existing auth users (cascades to profiles/roles via FK ON DELETE CASCADE where defined)
DELETE FROM auth.identities;
DELETE FROM auth.users;

-- NOTE (security redaction 2026-06-17):
-- This migration previously seeded an admin auth.users row with a plaintext
-- password committed to source control. That credential has been removed.
-- The previously-committed password MUST be rotated immediately via the
-- Supabase dashboard (Authentication > Users) and treated as compromised.
-- New admin users should be created out-of-band (dashboard or Admin API),
-- never by committing plaintext passwords into migrations.
DO $$ BEGIN NULL; END $$;
