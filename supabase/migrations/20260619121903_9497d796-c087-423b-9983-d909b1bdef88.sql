
-- Backfill master_titles.download_count from existing download_logs
UPDATE public.master_titles mt
SET download_count = sub.cnt
FROM (
  SELECT title_id, count(*)::int AS cnt
  FROM public.download_logs
  WHERE title_id IS NOT NULL
  GROUP BY title_id
) sub
WHERE sub.title_id = mt.id;

-- Atomic increment for downloads (callable from server fns)
CREATE OR REPLACE FUNCTION public.increment_title_download(_title_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.master_titles
     SET download_count = COALESCE(download_count, 0) + 1
   WHERE id = _title_id;
$$;

-- Atomic increment for title page views (callable by anyone, throttled by client)
CREATE OR REPLACE FUNCTION public.increment_title_view(_title_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.master_titles
     SET view_count = COALESCE(view_count, 0) + 1
   WHERE id = _title_id
     AND status = 'published';
$$;

REVOKE ALL ON FUNCTION public.increment_title_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_title_view(uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.increment_title_download(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_title_download(uuid) TO authenticated, service_role;
