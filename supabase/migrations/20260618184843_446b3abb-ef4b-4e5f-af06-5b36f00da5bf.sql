-- 1) Lock down rl_hit: revoke from anon/authenticated/public, keep service_role only.
REVOKE EXECUTE ON FUNCTION public.rl_hit(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rl_hit(text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rl_hit(text, integer, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.rl_hit(text, integer, integer) TO service_role;

-- 2) Replace the always-true INSERT policy on ad_events with a scoped check.
DROP POLICY IF EXISTS "anyone can insert ad events" ON public.ad_events;
CREATE POLICY "Anyone can insert scoped ad events"
  ON public.ad_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    event_type IN ('impression','click','error','dismiss','view','complete')
    AND placement IS NOT NULL
    AND (user_id IS NULL OR user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.ads a WHERE a.id = ad_events.ad_id)
  );