
-- title_aliases: admin-managed alternate names for matching Telegram captions to master titles
CREATE TABLE public.title_aliases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title_id UUID NOT NULL REFERENCES public.master_titles(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (title_id, normalized_alias)
);

CREATE INDEX idx_title_aliases_normalized ON public.title_aliases (normalized_alias);

GRANT SELECT ON public.title_aliases TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.title_aliases TO authenticated;
GRANT ALL ON public.title_aliases TO service_role;

ALTER TABLE public.title_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read aliases"
  ON public.title_aliases FOR SELECT
  USING (true);

CREATE POLICY "Admins manage aliases"
  ON public.title_aliases FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_title_aliases_updated_at
  BEFORE UPDATE ON public.title_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
