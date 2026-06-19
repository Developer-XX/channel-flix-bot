-- 1. Drilldown index
CREATE INDEX IF NOT EXISTS ad_perf_events_ad_id_created_idx
  ON public.ad_perf_events (ad_id, created_at DESC);

-- 2. Anon session view log
CREATE TABLE IF NOT EXISTS public.ad_view_log_anon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  ip_hash text NOT NULL,
  placement text NOT NULL,
  ad_id uuid REFERENCES public.ads(id) ON DELETE SET NULL,
  user_agent_class text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.ad_view_log_anon TO service_role;

ALTER TABLE public.ad_view_log_anon ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service only" ON public.ad_view_log_anon;
CREATE POLICY "service only" ON public.ad_view_log_anon
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS ad_view_log_anon_sid_placement_idx
  ON public.ad_view_log_anon (session_id, placement, created_at DESC);
CREATE INDEX IF NOT EXISTS ad_view_log_anon_iph_placement_idx
  ON public.ad_view_log_anon (ip_hash, placement, created_at DESC);

-- 3. Atomic claim functions (eligibility check + insert under advisory lock)
CREATE OR REPLACE FUNCTION public.claim_interstitial_view_user(
  _user_id uuid, _placement text, _ad_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE existing_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_user_id::text || ':' || _placement));
  SELECT created_at INTO existing_at FROM public.ad_view_log
    WHERE user_id = _user_id
      AND placement = _placement
      AND created_at > now() - interval '24 hours'
    ORDER BY created_at DESC LIMIT 1;
  IF existing_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'next_allowed_at', existing_at + interval '24 hours'
    );
  END IF;
  INSERT INTO public.ad_view_log(user_id, placement, ad_id)
    VALUES (_user_id, _placement, _ad_id);
  RETURN jsonb_build_object('claimed', true);
END
$$;

CREATE OR REPLACE FUNCTION public.claim_interstitial_view_anon(
  _session_id text, _ip_hash text, _placement text, _ad_id uuid, _ua text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_session_at timestamptz;
  existing_ip_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_session_id || ':' || _placement));

  -- Per-session 24h cap
  SELECT created_at INTO existing_session_at FROM public.ad_view_log_anon
    WHERE session_id = _session_id
      AND placement = _placement
      AND created_at > now() - interval '24 hours'
    ORDER BY created_at DESC LIMIT 1;
  IF existing_session_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'session_cap',
      'next_allowed_at', existing_session_at + interval '24 hours'
    );
  END IF;

  -- Soft per-IP 1h cap (limits cookie-clear bypass; tolerates shared NAT)
  SELECT created_at INTO existing_ip_at FROM public.ad_view_log_anon
    WHERE ip_hash = _ip_hash
      AND placement = _placement
      AND created_at > now() - interval '1 hour'
    ORDER BY created_at DESC LIMIT 1;
  IF existing_ip_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'ip_cap',
      'next_allowed_at', existing_ip_at + interval '1 hour'
    );
  END IF;

  INSERT INTO public.ad_view_log_anon(session_id, ip_hash, placement, ad_id, user_agent_class)
    VALUES (_session_id, _ip_hash, _placement, _ad_id, _ua);
  RETURN jsonb_build_object('claimed', true);
END
$$;

-- 4. Daily-rotated salt for IP hashing (so raw IPs are never stored)
INSERT INTO public.app_settings (key, value)
  VALUES ('IP_HASH_SALT', encode(gen_random_bytes(32), 'hex'))
  ON CONFLICT (key) DO NOTHING;

-- 5. Interstitial alert state (flap suppression)
INSERT INTO public.app_settings (key, value)
  VALUES ('interstitial_alert_state', '{}')
  ON CONFLICT (key) DO NOTHING;