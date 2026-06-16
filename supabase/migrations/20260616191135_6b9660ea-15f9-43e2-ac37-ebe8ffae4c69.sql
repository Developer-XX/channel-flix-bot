
-- 1. telegram_user_links
CREATE TABLE public.telegram_user_links (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_user_id bigint UNIQUE,
  telegram_username text,
  telegram_first_name text,
  link_code text UNIQUE,
  link_code_expires_at timestamptz,
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_user_links TO authenticated;
GRANT ALL ON public.telegram_user_links TO service_role;
ALTER TABLE public.telegram_user_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own link" ON public.telegram_user_links
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins view all links" ON public.telegram_user_links
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_tg_user_links_updated_at BEFORE UPDATE ON public.telegram_user_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. download_logs delivery columns
ALTER TABLE public.download_logs
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS delivery_error text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- 3. match_audit_log
CREATE TABLE public.match_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_ingest_id uuid REFERENCES public.telegram_ingest(id) ON DELETE CASCADE,
  master_title_id uuid REFERENCES public.master_titles(id) ON DELETE SET NULL,
  attempt_at timestamptz NOT NULL DEFAULT now(),
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  rules_used jsonb NOT NULL DEFAULT '{}'::jsonb,
  threshold numeric(4,3),
  decision text NOT NULL,
  reason text,
  actor text NOT NULL DEFAULT 'auto',
  parsed_snapshot jsonb
);
CREATE INDEX idx_match_audit_ingest ON public.match_audit_log(telegram_ingest_id, attempt_at DESC);
CREATE INDEX idx_match_audit_title ON public.match_audit_log(master_title_id, attempt_at DESC);
GRANT SELECT, INSERT ON public.match_audit_log TO authenticated;
GRANT ALL ON public.match_audit_log TO service_role;
ALTER TABLE public.match_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read audit" ON public.match_audit_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'moderator'::app_role));

-- 4. telegram_bot_state: cache_version + indexes_rebuilt_at
ALTER TABLE public.telegram_bot_state
  ADD COLUMN IF NOT EXISTS cache_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS indexes_rebuilt_at timestamptz;

-- Public read of cache_version for client query keys
CREATE POLICY "Public reads cache version" ON public.telegram_bot_state
  FOR SELECT TO anon USING (true);
GRANT SELECT ON public.telegram_bot_state TO anon;

-- 5. Derived index tables (truncate+repopulate on rebuild)
CREATE TABLE public.idx_latest_releases (
  media_file_id uuid PRIMARY KEY REFERENCES public.media_files(id) ON DELETE CASCADE,
  title_id uuid NOT NULL REFERENCES public.master_titles(id) ON DELETE CASCADE,
  promoted_at timestamptz NOT NULL,
  rank integer NOT NULL
);
CREATE INDEX idx_latest_rank ON public.idx_latest_releases(rank);
GRANT SELECT ON public.idx_latest_releases TO anon, authenticated;
GRANT ALL ON public.idx_latest_releases TO service_role;
ALTER TABLE public.idx_latest_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read latest" ON public.idx_latest_releases FOR SELECT USING (true);

CREATE TABLE public.idx_trending (
  title_id uuid PRIMARY KEY REFERENCES public.master_titles(id) ON DELETE CASCADE,
  score numeric NOT NULL,
  download_count_7d integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  rank integer NOT NULL
);
CREATE INDEX idx_trending_rank ON public.idx_trending(rank);
GRANT SELECT ON public.idx_trending TO anon, authenticated;
GRANT ALL ON public.idx_trending TO service_role;
ALTER TABLE public.idx_trending ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read trending" ON public.idx_trending FOR SELECT USING (true);

CREATE TABLE public.idx_search (
  title_id uuid PRIMARY KEY REFERENCES public.master_titles(id) ON DELETE CASCADE,
  searchable tsvector NOT NULL,
  title text NOT NULL,
  slug text NOT NULL,
  category text,
  release_year integer,
  poster_url text,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_search_tsv ON public.idx_search USING gin(searchable);
GRANT SELECT ON public.idx_search TO anon, authenticated;
GRANT ALL ON public.idx_search TO service_role;
ALTER TABLE public.idx_search ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read search index" ON public.idx_search FOR SELECT USING (true);
