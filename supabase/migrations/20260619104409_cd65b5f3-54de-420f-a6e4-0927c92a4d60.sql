
-- 1. Add correlation columns to ad_perf_events
ALTER TABLE public.ad_perf_events
  ADD COLUMN IF NOT EXISTS request_id uuid,
  ADD COLUMN IF NOT EXISTS server_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_server_validated boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ad_perf_events_request_id_idx
  ON public.ad_perf_events(request_id) WHERE request_id IS NOT NULL;

-- 2. ad_perf_requests: server-issued correlation table
CREATE TABLE IF NOT EXISTS public.ad_perf_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id uuid,
  placement text NOT NULL,
  user_id uuid,
  session_id text,
  ua_class text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  first_byte_at timestamptz,
  first_frame_at timestamptz,
  buffer_total_ms integer NOT NULL DEFAULT 0,
  buffer_open_at timestamptz,
  dropped_frames integer NOT NULL DEFAULT 0,
  ended_at timestamptz,
  error_code text
);

GRANT ALL ON public.ad_perf_requests TO service_role;
ALTER TABLE public.ad_perf_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ad_perf_requests service only"
  ON public.ad_perf_requests FOR ALL
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS ad_perf_requests_issued_at_idx ON public.ad_perf_requests(issued_at);
CREATE INDEX IF NOT EXISTS ad_perf_requests_placement_idx ON public.ad_perf_requests(placement, issued_at);
CREATE INDEX IF NOT EXISTS ad_perf_requests_ad_id_idx ON public.ad_perf_requests(ad_id, issued_at);

-- 3. RPC: issue a request id (anon-callable; rate-limited at app layer)
CREATE OR REPLACE FUNCTION public.issue_interstitial_request(
  _ad_id uuid, _placement text, _user_id uuid, _session_id text, _ua text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE rid uuid;
BEGIN
  INSERT INTO public.ad_perf_requests(ad_id, placement, user_id, session_id, ua_class)
  VALUES (_ad_id, _placement, _user_id, NULLIF(_session_id,''), NULLIF(_ua,''))
  RETURNING request_id INTO rid;
  RETURN rid;
END
$$;
GRANT EXECUTE ON FUNCTION public.issue_interstitial_request(uuid,text,uuid,text,text) TO anon, authenticated, service_role;

-- 4. RPC: record a lifecycle beacon for a request
CREATE OR REPLACE FUNCTION public.record_interstitial_beacon(
  _request_id uuid, _phase text, _value integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE row_age interval;
BEGIN
  SELECT now() - issued_at INTO row_age FROM public.ad_perf_requests WHERE request_id = _request_id;
  IF row_age IS NULL OR row_age > interval '15 minutes' THEN RETURN; END IF;

  IF _phase = 'first_byte' THEN
    UPDATE public.ad_perf_requests SET first_byte_at = COALESCE(first_byte_at, now()) WHERE request_id = _request_id;
  ELSIF _phase = 'first_frame' THEN
    UPDATE public.ad_perf_requests SET first_frame_at = COALESCE(first_frame_at, now()) WHERE request_id = _request_id;
  ELSIF _phase = 'buffer_start' THEN
    UPDATE public.ad_perf_requests SET buffer_open_at = COALESCE(buffer_open_at, now()) WHERE request_id = _request_id;
  ELSIF _phase = 'buffer_end' THEN
    UPDATE public.ad_perf_requests
      SET buffer_total_ms = buffer_total_ms + GREATEST(0, EXTRACT(MILLISECOND FROM (now() - COALESCE(buffer_open_at, now())))::int + EXTRACT(EPOCH FROM (now() - COALESCE(buffer_open_at, now())))::int * 1000),
          buffer_open_at = NULL
      WHERE request_id = _request_id;
  ELSIF _phase = 'dropped_frame' THEN
    UPDATE public.ad_perf_requests SET dropped_frames = dropped_frames + GREATEST(0, COALESCE(_value, 1)) WHERE request_id = _request_id;
  ELSIF _phase = 'end' THEN
    UPDATE public.ad_perf_requests SET ended_at = COALESCE(ended_at, now()) WHERE request_id = _request_id;
  ELSIF _phase = 'error' THEN
    UPDATE public.ad_perf_requests SET ended_at = COALESCE(ended_at, now()), error_code = COALESCE(error_code, _value::text) WHERE request_id = _request_id;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION public.record_interstitial_beacon(uuid,text,integer) TO anon, authenticated, service_role;

-- 5. Reconcile job: derive server-validated rows from completed requests
CREATE OR REPLACE FUNCTION public.reconcile_ad_perf_events()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE inserted_count int := 0;
BEGIN
  WITH src AS (
    SELECT r.* FROM public.ad_perf_requests r
    WHERE r.first_frame_at IS NOT NULL
      AND r.issued_at > now() - interval '2 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.ad_perf_events e
        WHERE e.request_id = r.request_id AND e.is_server_validated = true
      )
  ),
  ins_ttff AS (
    INSERT INTO public.ad_perf_events(ad_id, placement, metric, value, request_id, server_received_at, is_server_validated, user_agent)
    SELECT ad_id, placement, 'ttff_ms',
           EXTRACT(EPOCH FROM (first_frame_at - issued_at)) * 1000,
           request_id, now(), true, ua_class
      FROM src
    RETURNING 1
  ),
  ins_buf AS (
    INSERT INTO public.ad_perf_events(ad_id, placement, metric, value, request_id, server_received_at, is_server_validated, user_agent)
    SELECT ad_id, placement, 'buffer_ms', buffer_total_ms, request_id, now(), true, ua_class
      FROM src WHERE buffer_total_ms > 0
    RETURNING 1
  ),
  ins_drop AS (
    INSERT INTO public.ad_perf_events(ad_id, placement, metric, value, request_id, server_received_at, is_server_validated, user_agent)
    SELECT ad_id, placement, 'dropped_frames', dropped_frames, request_id, now(), true, ua_class
      FROM src WHERE dropped_frames > 0
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ins_ttff) + (SELECT count(*) FROM ins_buf) + (SELECT count(*) FROM ins_drop)
    INTO inserted_count;
  RETURN inserted_count;
END
$$;
GRANT EXECUTE ON FUNCTION public.reconcile_ad_perf_events() TO service_role;

-- 6. Baselines RPC: current 24h vs rolling 7/14/30d
CREATE OR REPLACE FUNCTION public.interstitial_baselines(_placement text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE result jsonb;
BEGIN
  WITH base AS (
    SELECT e.metric, e.value, e.created_at
      FROM public.ad_perf_events e
     WHERE (_placement IS NULL OR e.placement = _placement)
       AND e.created_at > now() - interval '31 days'
  ),
  current_w AS (
    SELECT
      percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'ttff_ms') AS ttff_p75,
      count(*) FILTER (WHERE metric = 'video_error')::float
        / NULLIF(count(*) FILTER (WHERE metric IN ('ttff_ms','video_error')), 0) AS video_error_rate,
      count(*) FILTER (WHERE metric = 'autoplay_blocked')::float
        / NULLIF(count(*) FILTER (WHERE metric IN ('ttff_ms','autoplay_blocked')), 0) AS autoplay_blocked_rate
      FROM base WHERE created_at > now() - interval '24 hours'
  ),
  baseline AS (
    SELECT '7d'::text AS window_key,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'ttff_ms') AS ttff_p75,
           count(*) FILTER (WHERE metric = 'video_error')::float
             / NULLIF(count(*) FILTER (WHERE metric IN ('ttff_ms','video_error')), 0) AS video_error_rate,
           count(*) FILTER (WHERE metric = 'autoplay_blocked')::float
             / NULLIF(count(*) FILTER (WHERE metric IN ('ttff_ms','autoplay_blocked')), 0) AS autoplay_blocked_rate
      FROM base WHERE created_at <= now() - interval '24 hours' AND created_at > now() - interval '7 days'
    UNION ALL
    SELECT '14d',
           percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'ttff_ms'),
           count(*) FILTER (WHERE metric = 'video_error')::float
             / NULLIF(count(*) FILTER (WHERE metric IN ('ttff_ms','video_error')), 0),
           count(*) FILTER (WHERE metric = 'autoplay_blocked')::float
             / NULLIF(count(*) FILTER (WHERE metric IN ('ttff_ms','autoplay_blocked')), 0)
      FROM base WHERE created_at <= now() - interval '24 hours' AND created_at > now() - interval '14 days'
    UNION ALL
    SELECT '30d',
           percentile_cont(0.75) WITHIN GROUP (ORDER BY value) FILTER (WHERE metric = 'ttff_ms'),
           count(*) FILTER (WHERE metric = 'video_error')::float
             / NULLIF(count(*) FILTER (WHERE metric IN ('ttff_ms','video_error')), 0),
           count(*) FILTER (WHERE metric = 'autoplay_blocked')::float
             / NULLIF(count(*) FILTER (WHERE metric IN ('ttff_ms','autoplay_blocked')), 0)
      FROM base WHERE created_at <= now() - interval '24 hours' AND created_at > now() - interval '30 days'
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'placement', _placement,
    'current', (SELECT to_jsonb(c) FROM current_w c),
    'baselines', (SELECT jsonb_object_agg(window_key, to_jsonb(b) - 'window_key') FROM baseline b)
  ) INTO result;
  RETURN result;
END
$$;
GRANT EXECUTE ON FUNCTION public.interstitial_baselines(text) TO authenticated, service_role;
