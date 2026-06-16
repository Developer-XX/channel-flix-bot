
ALTER TABLE public.idx_search DROP COLUMN searchable;
ALTER TABLE public.idx_search ADD COLUMN searchable_text text NOT NULL DEFAULT '';
ALTER TABLE public.idx_search
  ADD COLUMN searchable tsvector
  GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, searchable_text)) STORED;
CREATE INDEX IF NOT EXISTS idx_search_tsv2 ON public.idx_search USING gin(searchable);
