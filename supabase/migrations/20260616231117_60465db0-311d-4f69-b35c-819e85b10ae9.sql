
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

-- Create admin user: henilpatel179@gmail.com / Henil@997812
DO $$
DECLARE
  new_user_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    'henilpatel179@gmail.com',
    crypt('Henil@997812', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Henil"}'::jsonb,
    now(), now(), '', '', '', ''
  );

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (
    gen_random_uuid(),
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', 'henilpatel179@gmail.com', 'email_verified', true),
    'email',
    new_user_id::text,
    now(), now(), now()
  );

  -- handle_new_user trigger should populate profiles; ensure row exists
  INSERT INTO public.profiles (id, display_name)
  VALUES (new_user_id, 'Henil')
  ON CONFLICT (id) DO NOTHING;

  -- Grant admin role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
