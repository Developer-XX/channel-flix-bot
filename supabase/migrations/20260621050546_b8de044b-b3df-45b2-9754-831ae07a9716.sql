
ALTER TABLE public.telegram_ingest
  ADD COLUMN IF NOT EXISTS match_locked boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_telegram_ingest_match_locked
  ON public.telegram_ingest(match_locked) WHERE match_locked = true;

-- Backfill: if there's any manual decision in match_audit_log for this ingest
-- row and it currently has a matched_title_id, lock it.
UPDATE public.telegram_ingest ti
   SET match_locked = true
 WHERE ti.matched_title_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.match_audit_log mal
      WHERE mal.telegram_ingest_id = ti.id
        AND mal.decision = 'manual'
        AND mal.master_title_id = ti.matched_title_id
   );
