
-- =========================================================================
-- ENUMS
-- =========================================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TYPE public.content_category AS ENUM ('movie', 'series', 'anime', 'cartoon', 'kdrama', 'documentary');
CREATE TYPE public.content_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE public.request_status AS ENUM ('pending', 'approved', 'rejected', 'fulfilled');

-- =========================================================================
-- TIMESTAMP TRIGGER
-- =========================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================================================
-- PROFILES
-- =========================================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are readable by everyone"
  ON public.profiles FOR SELECT
  USING (true);
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================================
-- USER ROLES
-- =========================================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- MASTER TITLES
-- =========================================================================
CREATE TABLE public.master_titles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  original_title TEXT,
  category public.content_category NOT NULL,
  status public.content_status NOT NULL DEFAULT 'draft',
  overview TEXT,
  poster_url TEXT,
  backdrop_url TEXT,
  trailer_url TEXT,
  release_year INTEGER,
  release_date DATE,
  runtime_minutes INTEGER,
  rating NUMERIC(3,1),
  language TEXT,
  genres TEXT[] DEFAULT '{}'::TEXT[],
  cast_names TEXT[] DEFAULT '{}'::TEXT[],
  tmdb_id INTEGER,
  imdb_id TEXT,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_trending BOOLEAN NOT NULL DEFAULT FALSE,
  view_count INTEGER NOT NULL DEFAULT 0,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_master_titles_category ON public.master_titles(category);
CREATE INDEX idx_master_titles_status ON public.master_titles(status);
CREATE INDEX idx_master_titles_trending ON public.master_titles(is_trending) WHERE is_trending = TRUE;
CREATE INDEX idx_master_titles_featured ON public.master_titles(is_featured) WHERE is_featured = TRUE;
CREATE INDEX idx_master_titles_tmdb ON public.master_titles(tmdb_id);
CREATE INDEX idx_master_titles_title_search ON public.master_titles USING gin (to_tsvector('simple', title));

GRANT SELECT ON public.master_titles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.master_titles TO authenticated;
GRANT ALL ON public.master_titles TO service_role;
ALTER TABLE public.master_titles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Published titles are public"
  ON public.master_titles FOR SELECT
  USING (status = 'published' OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
CREATE POLICY "Admins manage titles"
  ON public.master_titles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));

CREATE TRIGGER master_titles_updated_at BEFORE UPDATE ON public.master_titles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- SEASONS
-- =========================================================================
CREATE TABLE public.seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id UUID NOT NULL REFERENCES public.master_titles(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  name TEXT,
  overview TEXT,
  poster_url TEXT,
  air_date DATE,
  episode_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (title_id, season_number)
);
CREATE INDEX idx_seasons_title ON public.seasons(title_id);
GRANT SELECT ON public.seasons TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.seasons TO authenticated;
GRANT ALL ON public.seasons TO service_role;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Seasons are public"
  ON public.seasons FOR SELECT USING (true);
CREATE POLICY "Admins manage seasons"
  ON public.seasons FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));

CREATE TRIGGER seasons_updated_at BEFORE UPDATE ON public.seasons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- EPISODES
-- =========================================================================
CREATE TABLE public.episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  title_id UUID NOT NULL REFERENCES public.master_titles(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  name TEXT,
  overview TEXT,
  still_url TEXT,
  air_date DATE,
  runtime_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (season_id, episode_number)
);
CREATE INDEX idx_episodes_season ON public.episodes(season_id);
CREATE INDEX idx_episodes_title ON public.episodes(title_id);
GRANT SELECT ON public.episodes TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.episodes TO authenticated;
GRANT ALL ON public.episodes TO service_role;
ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Episodes are public"
  ON public.episodes FOR SELECT USING (true);
CREATE POLICY "Admins manage episodes"
  ON public.episodes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));

CREATE TRIGGER episodes_updated_at BEFORE UPDATE ON public.episodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- TELEGRAM CHANNELS
-- =========================================================================
CREATE TABLE public.telegram_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id BIGINT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  username TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_channels TO authenticated;
GRANT ALL ON public.telegram_channels TO service_role;
ALTER TABLE public.telegram_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage channels"
  ON public.telegram_channels FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER telegram_channels_updated_at BEFORE UPDATE ON public.telegram_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- MEDIA FILES (Telegram-hosted file metadata)
-- =========================================================================
CREATE TABLE public.media_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id UUID REFERENCES public.master_titles(id) ON DELETE CASCADE,
  episode_id UUID REFERENCES public.episodes(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES public.telegram_channels(id) ON DELETE SET NULL,
  telegram_file_id TEXT NOT NULL,
  telegram_message_id BIGINT,
  file_name TEXT NOT NULL,
  caption TEXT,
  file_size BIGINT,
  mime_type TEXT,
  quality TEXT,
  resolution TEXT,
  language TEXT,
  duration_seconds INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT media_files_attached CHECK (title_id IS NOT NULL OR episode_id IS NOT NULL)
);
CREATE INDEX idx_media_files_title ON public.media_files(title_id);
CREATE INDEX idx_media_files_episode ON public.media_files(episode_id);
CREATE UNIQUE INDEX idx_media_files_unique_telegram ON public.media_files(telegram_file_id);

-- Public listing: metadata only; the telegram_file_id is sensitive and gated by an authenticated view in Phase 2.
GRANT SELECT (id, title_id, episode_id, file_name, caption, file_size, mime_type, quality, resolution, language, duration_seconds, is_active, created_at, updated_at) ON public.media_files TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_files TO authenticated;
GRANT ALL ON public.media_files TO service_role;
ALTER TABLE public.media_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active files are listable"
  ON public.media_files FOR SELECT
  USING (is_active = TRUE OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
CREATE POLICY "Admins manage files"
  ON public.media_files FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));

CREATE TRIGGER media_files_updated_at BEFORE UPDATE ON public.media_files
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- CONTENT REQUESTS
-- =========================================================================
CREATE TABLE public.content_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category public.content_category,
  notes TEXT,
  status public.request_status NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_requests_user ON public.content_requests(user_id);
CREATE INDEX idx_requests_status ON public.content_requests(status);
GRANT SELECT, INSERT, UPDATE ON public.content_requests TO authenticated;
GRANT ALL ON public.content_requests TO service_role;
ALTER TABLE public.content_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own requests, admins see all"
  ON public.content_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
CREATE POLICY "Users create their own requests"
  ON public.content_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins update any request"
  ON public.content_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));

CREATE TRIGGER content_requests_updated_at BEFORE UPDATE ON public.content_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- DOWNLOAD LOGS
-- =========================================================================
CREATE TABLE public.download_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  file_id UUID REFERENCES public.media_files(id) ON DELETE SET NULL,
  title_id UUID REFERENCES public.master_titles(id) ON DELETE SET NULL,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_download_logs_user ON public.download_logs(user_id);
CREATE INDEX idx_download_logs_file ON public.download_logs(file_id);
CREATE INDEX idx_download_logs_created ON public.download_logs(created_at);
GRANT SELECT, INSERT ON public.download_logs TO authenticated;
GRANT ALL ON public.download_logs TO service_role;
ALTER TABLE public.download_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins see logs"
  ON public.download_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
CREATE POLICY "Anyone signed-in can insert their own log"
  ON public.download_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
