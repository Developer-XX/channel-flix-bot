
-- 1) Extend download_logs with audit fields for the delivery flow
ALTER TABLE public.download_logs
  ADD COLUMN IF NOT EXISTS force_join_status text,
  ADD COLUMN IF NOT EXISTS force_join_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS force_join_channels jsonb,
  ADD COLUMN IF NOT EXISTS shortener_used text,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS category text;

CREATE INDEX IF NOT EXISTS idx_download_logs_created_at_desc
  ON public.download_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_download_logs_status
  ON public.download_logs (delivery_status, created_at DESC);

-- 2) Multi-channel force-join configuration
CREATE TABLE IF NOT EXISTS public.force_join_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  chat_id text NOT NULL,
  invite_url text,
  categories text[] NOT NULL DEFAULT '{}'::text[], -- empty = applies to all categories
  rule_group text NOT NULL DEFAULT 'default',
  is_active boolean NOT NULL DEFAULT true,
  priority int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.force_join_channels TO authenticated;
GRANT ALL ON public.force_join_channels TO service_role;

ALTER TABLE public.force_join_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage force_join_channels"
  ON public.force_join_channels FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER force_join_channels_set_updated_at
  BEFORE UPDATE ON public.force_join_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_force_join_channels_active
  ON public.force_join_channels (is_active, priority);
