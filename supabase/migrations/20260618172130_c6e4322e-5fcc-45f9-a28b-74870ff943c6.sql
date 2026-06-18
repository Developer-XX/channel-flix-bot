
CREATE TABLE public.homepage_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text,
  image_url text NOT NULL,
  link_url text,
  cta_label text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  duration_ms int NOT NULL DEFAULT 5000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

GRANT SELECT ON public.homepage_slides TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.homepage_slides TO authenticated;
GRANT ALL ON public.homepage_slides TO service_role;

ALTER TABLE public.homepage_slides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active slides" ON public.homepage_slides
  FOR SELECT USING (is_active = true);

CREATE POLICY "Admins manage slides" ON public.homepage_slides
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_homepage_slides_updated_at
  BEFORE UPDATE ON public.homepage_slides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
