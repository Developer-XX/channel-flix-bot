CREATE OR REPLACE FUNCTION public.get_public_columns(_tables text[])
RETURNS TABLE(table_name text, column_name text, is_nullable text, column_default text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.table_name::text, c.column_name::text, c.is_nullable::text, c.column_default::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = ANY(_tables)
    AND (
      COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), '') = 'service_role'
      OR public.has_role(auth.uid(), 'admin')
    );
$$;

REVOKE ALL ON FUNCTION public.get_public_columns(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_columns(text[]) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';