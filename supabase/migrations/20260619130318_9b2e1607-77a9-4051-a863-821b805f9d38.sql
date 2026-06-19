
-- 1) Configurable window for the interstitial frequency cap RPCs.
CREATE OR REPLACE FUNCTION public.claim_interstitial_view_user(
  _user_id uuid,
  _placement text,
  _ad_id uuid,
  _window_minutes int DEFAULT 1440
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  existing_at timestamptz;
  win interval := make_interval(mins => GREATEST(0, COALESCE(_window_minutes, 1440)));
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_user_id::text || ':' || _placement));
  IF win > interval '0' THEN
    SELECT created_at INTO existing_at FROM public.ad_view_log
      WHERE user_id = _user_id
        AND placement = _placement
        AND created_at > now() - win
      ORDER BY created_at DESC LIMIT 1;
    IF existing_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'next_allowed_at', existing_at + win
      );
    END IF;
  END IF;
  INSERT INTO public.ad_view_log(user_id, placement, ad_id)
    VALUES (_user_id, _placement, _ad_id);
  RETURN jsonb_build_object('claimed', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_interstitial_view_anon(
  _session_id text,
  _ip_hash text,
  _placement text,
  _ad_id uuid,
  _ua text,
  _window_minutes int DEFAULT 1440,
  _ip_window_minutes int DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  existing_session_at timestamptz;
  existing_ip_at timestamptz;
  win interval := make_interval(mins => GREATEST(0, COALESCE(_window_minutes, 1440)));
  ipwin interval := make_interval(mins => GREATEST(0, COALESCE(_ip_window_minutes, 60)));
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_session_id || ':' || _placement));

  IF win > interval '0' THEN
    SELECT created_at INTO existing_session_at FROM public.ad_view_log_anon
      WHERE session_id = _session_id
        AND placement = _placement
        AND created_at > now() - win
      ORDER BY created_at DESC LIMIT 1;
    IF existing_session_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'reason', 'session_cap',
        'next_allowed_at', existing_session_at + win
      );
    END IF;
  END IF;

  IF ipwin > interval '0' THEN
    SELECT created_at INTO existing_ip_at FROM public.ad_view_log_anon
      WHERE ip_hash = _ip_hash
        AND placement = _placement
        AND created_at > now() - ipwin
      ORDER BY created_at DESC LIMIT 1;
    IF existing_ip_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'reason', 'ip_cap',
        'next_allowed_at', existing_ip_at + ipwin
      );
    END IF;
  END IF;

  INSERT INTO public.ad_view_log_anon(session_id, ip_hash, placement, ad_id, user_agent_class)
    VALUES (_session_id, _ip_hash, _placement, _ad_id, _ua);
  RETURN jsonb_build_object('claimed', true);
END
$function$;

-- 2) Clear stale cap rows so the new configured windows take effect immediately
DELETE FROM public.ad_view_log WHERE created_at > now() - interval '24 hours';
DELETE FROM public.ad_view_log_anon WHERE created_at > now() - interval '24 hours';

-- 3) Backfill seasons.episode_count + keep it in sync from the episodes table.
UPDATE public.seasons s
SET episode_count = sub.cnt
FROM (
  SELECT season_id, count(*)::int AS cnt
  FROM public.episodes
  WHERE season_id IS NOT NULL
  GROUP BY season_id
) sub
WHERE sub.season_id = s.id
  AND s.episode_count IS DISTINCT FROM sub.cnt;

CREATE OR REPLACE FUNCTION public.sync_season_episode_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  affected uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected := OLD.season_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.season_id IS DISTINCT FROM OLD.season_id THEN
    UPDATE public.seasons SET episode_count = (
      SELECT count(*) FROM public.episodes WHERE season_id = OLD.season_id
    ) WHERE id = OLD.season_id;
    affected := NEW.season_id;
  ELSE
    affected := NEW.season_id;
  END IF;
  IF affected IS NOT NULL THEN
    UPDATE public.seasons SET episode_count = (
      SELECT count(*) FROM public.episodes WHERE season_id = affected
    ) WHERE id = affected;
  END IF;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS trg_sync_season_episode_count ON public.episodes;
CREATE TRIGGER trg_sync_season_episode_count
AFTER INSERT OR UPDATE OR DELETE ON public.episodes
FOR EACH ROW EXECUTE FUNCTION public.sync_season_episode_count();
