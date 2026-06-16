CREATE TABLE public.access_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  email text,
  event text NOT NULL,
  code text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','warn','fail')),
  path text,
  detail text,
  jwt_exp_in integer,
  has_admin_role boolean,
  user_agent text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_audit_log_user_idx ON public.access_audit_log(user_id, created_at DESC);
CREATE INDEX access_audit_log_created_idx ON public.access_audit_log(created_at DESC);
CREATE INDEX access_audit_log_event_idx ON public.access_audit_log(event, created_at DESC);

GRANT SELECT ON public.access_audit_log TO authenticated;
GRANT ALL ON public.access_audit_log TO service_role;

ALTER TABLE public.access_audit_log ENABLE ROW LEVEL SECURITY;

-- Users can read their own audit rows
CREATE POLICY "Users read own access audit"
  ON public.access_audit_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admins read everything
CREATE POLICY "Admins read all access audit"
  ON public.access_audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
