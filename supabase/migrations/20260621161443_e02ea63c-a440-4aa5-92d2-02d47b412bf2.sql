GRANT EXECUTE ON FUNCTION public.get_public_columns(text[]) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';