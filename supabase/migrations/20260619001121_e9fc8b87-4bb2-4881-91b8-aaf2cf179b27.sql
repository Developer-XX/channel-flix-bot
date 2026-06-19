
-- 1) Admin-only diagnostic: returns grants + RLS policies for any public table.
CREATE OR REPLACE FUNCTION public.diagnose_table_permissions(_table text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean;
  grants jsonb;
  col_grants jsonb;
  policies jsonb;
  rls_enabled boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  SELECT c.relrowsecurity INTO rls_enabled
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = _table;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('grantee', grantee, 'privilege', privilege_type) ORDER BY grantee, privilege_type), '[]'::jsonb)
    INTO grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = _table
     AND grantee IN ('anon','authenticated','service_role');

  SELECT COALESCE(jsonb_agg(jsonb_build_object('grantee', grantee, 'privilege', privilege_type, 'column', column_name) ORDER BY grantee, column_name), '[]'::jsonb)
    INTO col_grants
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = _table
     AND grantee IN ('anon','authenticated','service_role');

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', policyname, 'cmd', cmd, 'roles', roles, 'using', qual, 'check', with_check) ORDER BY policyname), '[]'::jsonb)
    INTO policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = _table;

  RETURN jsonb_build_object(
    'table', _table,
    'rls_enabled', COALESCE(rls_enabled, false),
    'table_grants', grants,
    'column_grants', col_grants,
    'policies', policies,
    'checked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.diagnose_table_permissions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diagnose_table_permissions(text) TO authenticated, service_role;

-- 2) Nightly drift check for telegram_ingest grants → admin_alerts + admin_audit_log.
CREATE OR REPLACE FUNCTION public.check_telegram_ingest_grants()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected jsonb := jsonb_build_object(
    'authenticated', ARRAY['SELECT','INSERT','UPDATE','DELETE'],
    'service_role',  ARRAY['SELECT','INSERT','UPDATE','DELETE']
  );
  actual jsonb;
  missing jsonb := '[]'::jsonb;
  role_name text;
  needed text;
  has_priv boolean;
  drift boolean := false;
  existing_alert uuid;
BEGIN
  SELECT COALESCE(jsonb_object_agg(grantee, privs), '{}'::jsonb)
    INTO actual
    FROM (
      SELECT grantee, jsonb_agg(privilege_type ORDER BY privilege_type) AS privs
        FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = 'telegram_ingest'
         AND grantee IN ('anon','authenticated','service_role')
       GROUP BY grantee
    ) t;

  FOR role_name IN SELECT jsonb_object_keys(expected) LOOP
    FOR needed IN SELECT jsonb_array_elements_text(expected->role_name) LOOP
      has_priv := COALESCE(actual->role_name, '[]'::jsonb) ? needed;
      IF NOT has_priv THEN
        drift := true;
        missing := missing || jsonb_build_object('role', role_name, 'privilege', needed);
      END IF;
    END LOOP;
  END LOOP;

  -- Audit log entry every run (success or failure).
  INSERT INTO public.admin_audit_log(action, status, metadata)
  VALUES (
    'security.telegram_ingest.grants_check',
    CASE WHEN drift THEN 'failed' ELSE 'success' END,
    jsonb_build_object('expected', expected, 'actual', actual, 'missing', missing)
  );

  IF drift THEN
    -- Coalesce by (kind, subject) like writeAdminAlert.
    SELECT id INTO existing_alert
      FROM public.admin_alerts
     WHERE kind = 'permission_drift'
       AND subject = 'telegram_ingest grants missing'
       AND resolved_at IS NULL
     LIMIT 1;

    IF existing_alert IS NULL THEN
      INSERT INTO public.admin_alerts(kind, severity, subject, details, source)
      VALUES (
        'permission_drift',
        'error',
        'telegram_ingest grants missing',
        jsonb_build_object('expected', expected, 'actual', actual, 'missing', missing),
        'check_telegram_ingest_grants'
      );
    ELSE
      UPDATE public.admin_alerts
         SET last_seen_at = now(),
             occurrences = occurrences + 1,
             details = jsonb_build_object('expected', expected, 'actual', actual, 'missing', missing)
       WHERE id = existing_alert;
    END IF;
  ELSE
    UPDATE public.admin_alerts
       SET resolved_at = now()
     WHERE kind = 'permission_drift'
       AND subject = 'telegram_ingest grants missing'
       AND resolved_at IS NULL;
  END IF;

  RETURN jsonb_build_object('drift', drift, 'missing', missing, 'actual', actual);
END;
$$;

REVOKE ALL ON FUNCTION public.check_telegram_ingest_grants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_telegram_ingest_grants() TO authenticated, service_role;

-- 3) Schedule nightly drift check at 03:17 UTC.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('telegram-ingest-grants-check')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'telegram-ingest-grants-check');
    PERFORM cron.schedule(
      'telegram-ingest-grants-check',
      '17 3 * * *',
      $cron$ SELECT public.check_telegram_ingest_grants(); $cron$
    );
  END IF;
END $$;
