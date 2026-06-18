
-- 1. Harden media_files / seasons / episodes RLS so anon needs the toggle on
DROP POLICY IF EXISTS "Anon can list active files (safe columns only)" ON public.media_files;
DROP POLICY IF EXISTS "Authenticated read active files (safe cols via grants)" ON public.media_files;
CREATE POLICY "Anon can list active files (safe columns only)"
  ON public.media_files FOR SELECT TO anon
  USING (is_active = true AND public.is_public_browsing_enabled());
CREATE POLICY "Authenticated read active files (safe cols via grants)"
  ON public.media_files FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Seasons are public" ON public.seasons;
CREATE POLICY "Seasons are public"
  ON public.seasons FOR SELECT TO public
  USING (auth.uid() IS NOT NULL OR public.is_public_browsing_enabled());

DROP POLICY IF EXISTS "Episodes are public" ON public.episodes;
CREATE POLICY "Episodes are public"
  ON public.episodes FOR SELECT TO public
  USING (auth.uid() IS NOT NULL OR public.is_public_browsing_enabled());

-- 2. Blocked browsing analytics log
CREATE TABLE IF NOT EXISTS public.blocked_browsing_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  slug text,
  path text,
  toggle_on boolean NOT NULL DEFAULT false,
  user_agent text
);

CREATE INDEX IF NOT EXISTS blocked_browsing_log_created_at_idx
  ON public.blocked_browsing_log (created_at DESC);
CREATE INDEX IF NOT EXISTS blocked_browsing_log_reason_idx
  ON public.blocked_browsing_log (reason);

GRANT SELECT ON public.blocked_browsing_log TO authenticated;
GRANT ALL ON public.blocked_browsing_log TO service_role;

ALTER TABLE public.blocked_browsing_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read blocked log" ON public.blocked_browsing_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage blocked log" ON public.blocked_browsing_log
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 3. RPC for anon to record a blocked attempt, rate-limited and bounded.
CREATE OR REPLACE FUNCTION public.log_blocked_browsing(
  _reason text,
  _slug text DEFAULT NULL,
  _path text DEFAULT NULL,
  _user_agent text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count int;
  toggle boolean;
BEGIN
  IF _reason IS NULL OR length(_reason) > 64 THEN
    RAISE EXCEPTION 'invalid reason';
  END IF;

  -- Simple global cap: never write more than 600 rows / minute regardless of caller.
  SELECT count(*) INTO recent_count
    FROM public.blocked_browsing_log
    WHERE created_at > now() - interval '1 minute';
  IF recent_count > 600 THEN
    RETURN;
  END IF;

  toggle := public.is_public_browsing_enabled();

  INSERT INTO public.blocked_browsing_log(reason, slug, path, toggle_on, user_agent)
  VALUES (
    left(_reason, 64),
    NULLIF(left(_slug, 256), ''),
    NULLIF(left(_path, 512), ''),
    toggle,
    NULLIF(left(_user_agent, 512), '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_blocked_browsing(text, text, text, text)
  TO anon, authenticated;
