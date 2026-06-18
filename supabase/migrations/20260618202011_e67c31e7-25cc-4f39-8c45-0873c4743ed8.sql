
-- 1) Tighten premium-assets storage bucket: drop the open SELECT policy and restrict to premium-authenticated users.
DROP POLICY IF EXISTS "Anyone read premium assets" ON storage.objects;

CREATE POLICY "Premium users read premium assets"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'premium-assets'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (p.is_premium = true OR (p.premium_until IS NOT NULL AND p.premium_until > now()))
      )
    )
  );

-- 2) Defense-in-depth: revoke accidental public grants on telegram_ingest
--    (RLS already denies, but no role outside admin/service should hold table grants).
REVOKE ALL ON public.telegram_ingest FROM anon, authenticated;
GRANT ALL ON public.telegram_ingest TO service_role;
