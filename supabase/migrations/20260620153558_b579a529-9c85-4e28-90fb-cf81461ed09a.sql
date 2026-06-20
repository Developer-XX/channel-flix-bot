
REVOKE EXECUTE ON FUNCTION public.get_google_oauth_latest_health() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_google_oauth_latest_health() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_google_oauth_latest_health() TO authenticated;
