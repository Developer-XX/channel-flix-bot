
-- payment-proofs: users upload into <uid>/...
CREATE POLICY "Users upload own payment proof" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users read own payment proof" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.has_role(auth.uid(),'admin')));

-- premium-assets: admin-only management
CREATE POLICY "Admins manage premium assets" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'premium-assets' AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (bucket_id = 'premium-assets' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "Anyone read premium assets" ON storage.objects FOR SELECT TO authenticated, anon
  USING (bucket_id = 'premium-assets');
