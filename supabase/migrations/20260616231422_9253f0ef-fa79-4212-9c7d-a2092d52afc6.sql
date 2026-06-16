
-- Admin audit log
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  action text NOT NULL,
  status text NOT NULL DEFAULT 'success',
  ip text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read audit log" ON public.admin_audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_admin_audit_log_created ON public.admin_audit_log (created_at DESC);

-- Pending destructive actions (confirmation tokens)
CREATE TABLE public.pending_destructive_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  confirmation_code text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pending_destructive_actions TO authenticated;
GRANT ALL ON public.pending_destructive_actions TO service_role;
ALTER TABLE public.pending_destructive_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read their pending actions" ON public.pending_destructive_actions
  FOR SELECT TO authenticated
  USING (actor_user_id = auth.uid() AND public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_pending_destructive_expires ON public.pending_destructive_actions (expires_at);

-- Server-side wipe function (admin-only via SECURITY DEFINER, called from server fn after caller verification)
CREATE OR REPLACE FUNCTION public.wipe_application_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  before_titles bigint;
  before_ingest bigint;
BEGIN
  SELECT count(*) INTO before_titles FROM public.master_titles;
  SELECT count(*) INTO before_ingest FROM public.telegram_ingest;

  TRUNCATE TABLE
    public.access_audit_log,
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
    public.seasons,
    public.sync_trace_log,
    public.telegram_bot_state,
    public.telegram_channels,
    public.telegram_ingest,
    public.telegram_webhook_events,
    public.title_aliases,
    public.user_verifications,
    public.verification_provider_calls,
    public.verification_tokens,
    public.web_vitals_events
  RESTART IDENTITY CASCADE;

  RETURN jsonb_build_object(
    'wiped_at', now(),
    'before_titles', before_titles,
    'before_ingest', before_ingest
  );
END;
$$;
REVOKE ALL ON FUNCTION public.wipe_application_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wipe_application_data() TO service_role;
