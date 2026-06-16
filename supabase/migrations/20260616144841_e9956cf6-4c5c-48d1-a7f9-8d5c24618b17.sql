CREATE POLICY "No direct client access to auth rate limits"
  ON public.auth_rate_limits
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);