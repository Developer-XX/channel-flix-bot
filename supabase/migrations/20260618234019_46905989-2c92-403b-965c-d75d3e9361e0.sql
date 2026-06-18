
-- 1. Download send queue (idempotent retry)
CREATE TABLE public.download_send_queue (
  idempotency_key text PRIMARY KEY,
  user_id uuid NOT NULL,
  file_id uuid NOT NULL,
  title_id uuid,
  chat_id bigint NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','deduped')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  message_id bigint,
  bot_user_id bigint,
  reused_from_cooldown boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX idx_dsq_due ON public.download_send_queue (status, next_attempt_at) WHERE status IN ('queued','sending');
CREATE INDEX idx_dsq_user ON public.download_send_queue (user_id, created_at DESC);
GRANT SELECT ON public.download_send_queue TO authenticated;
GRANT ALL ON public.download_send_queue TO service_role;
ALTER TABLE public.download_send_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own queue" ON public.download_send_queue FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "admins read all queue" ON public.download_send_queue FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_dsq_updated_at BEFORE UPDATE ON public.download_send_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Shortener configs (rotation controls)
CREATE TABLE public.shortener_configs (
  provider text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  weight integer NOT NULL DEFAULT 1,
  notes text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shortener_configs TO authenticated;
GRANT ALL ON public.shortener_configs TO service_role;
ALTER TABLE public.shortener_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read shortener configs" ON public.shortener_configs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins write shortener configs" ON public.shortener_configs FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_sc_updated_at BEFORE UPDATE ON public.shortener_configs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed known providers
INSERT INTO public.shortener_configs (provider, enabled, priority) VALUES
  ('adrinolinks', true, 10),
  ('nanolinks', true, 20)
ON CONFLICT (provider) DO NOTHING;

-- 3. Cron job status (per-job health for alerts)
CREATE TABLE public.cron_job_status (
  job_name text PRIMARY KEY,
  expected_interval_seconds integer NOT NULL DEFAULT 60,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  last_summary jsonb,
  consecutive_failures integer NOT NULL DEFAULT 0,
  total_runs bigint NOT NULL DEFAULT 0,
  total_failures bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cron_job_status TO authenticated;
GRANT ALL ON public.cron_job_status TO service_role;
ALTER TABLE public.cron_job_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read cron status" ON public.cron_job_status FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_cjs_updated_at BEFORE UPDATE ON public.cron_job_status FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Admin alerts
CREATE TABLE public.admin_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'warn' CHECK (severity IN ('info','warn','error')),
  subject text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrences integer NOT NULL DEFAULT 1,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_alerts_open ON public.admin_alerts (severity, last_seen_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX idx_admin_alerts_kind ON public.admin_alerts (kind, resolved_at);
GRANT SELECT, UPDATE ON public.admin_alerts TO authenticated;
GRANT ALL ON public.admin_alerts TO service_role;
ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read alerts" ON public.admin_alerts FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update alerts" ON public.admin_alerts FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_aa_updated_at BEFORE UPDATE ON public.admin_alerts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed cron jobs we already run
INSERT INTO public.cron_job_status (job_name, expected_interval_seconds) VALUES
  ('process-message-deletes', 60),
  ('process-download-queue', 60)
ON CONFLICT (job_name) DO NOTHING;
