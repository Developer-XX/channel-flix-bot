REVOKE EXECUTE ON FUNCTION public.claim_interstitial_view_user(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_interstitial_view_anon(text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_interstitial_view_user(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_interstitial_view_anon(text, text, text, uuid, text) TO service_role;