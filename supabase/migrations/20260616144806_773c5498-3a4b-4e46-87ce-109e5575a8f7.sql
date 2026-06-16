CREATE TABLE public.auth_rate_limits (
  rate_key TEXT NOT NULL,
  action TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  blocked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_key, action)
);

GRANT ALL ON public.auth_rate_limits TO service_role;

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_auth_rate_limits_blocked_until ON public.auth_rate_limits(blocked_until);
CREATE INDEX idx_auth_rate_limits_last_attempt_at ON public.auth_rate_limits(last_attempt_at);