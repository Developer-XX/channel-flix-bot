
CREATE OR REPLACE FUNCTION public.is_public_browsing_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT lower(value) NOT IN ('false','0','no','off')
       FROM public.app_settings
       WHERE key = 'PUBLIC_BROWSING_ENABLED'
       LIMIT 1),
    true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_public_browsing_enabled() TO anon, authenticated;

DROP POLICY IF EXISTS "Published titles are public" ON public.master_titles;
CREATE POLICY "Published titles are public"
ON public.master_titles
FOR SELECT
TO public
USING (
  (status = 'published'::content_status
    AND (auth.uid() IS NOT NULL OR public.is_public_browsing_enabled()))
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'moderator'::app_role)
);
