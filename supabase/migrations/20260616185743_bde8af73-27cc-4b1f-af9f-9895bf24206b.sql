
ALTER TABLE public.telegram_bot_state
  ADD COLUMN IF NOT EXISTS matching_settings jsonb NOT NULL DEFAULT jsonb_build_object(
    'threshold', 0.45,
    'use_aliases', true,
    'use_substring', true,
    'use_containment', true,
    'use_jaccard', true,
    'year_window', 1,
    'require_category_match', false
  );

INSERT INTO public.telegram_bot_state (id) VALUES ('global')
ON CONFLICT (id) DO NOTHING;
