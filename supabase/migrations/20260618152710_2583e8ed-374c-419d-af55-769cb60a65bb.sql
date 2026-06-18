DROP POLICY IF EXISTS "Anyone can insert onboarding events" ON public.onboarding_events;
CREATE POLICY "Users insert own onboarding events" ON public.onboarding_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());