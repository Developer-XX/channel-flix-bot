-- Fix Bheem mis-assignments and promote files to media_files so they appear on title pages.

-- Step 1: Reassign mis-labeled Super Bheem rows from Mighty Little Bheem to Super Bheem (keep locked).
UPDATE public.telegram_ingest
   SET matched_title_id = '78103dd4-b041-4825-9359-c3709f904c17',
       match_status = 'matched',
       match_score = 1.0,
       match_locked = true,
       updated_at = now()
 WHERE matched_title_id = '606f0f4f-fb51-4b59-924e-9fa5337a9f45'
   AND (caption ILIKE '%super bheem%' OR file_name ILIKE '%super%bheem%')
   AND caption NOT ILIKE '%mighty%little%bheem%';

-- Step 2: For every locked Bheem row (both titles), ensure season + episode + media_file exist.
DO $$
DECLARE
  r record;
  v_season_id uuid;
  v_episode_id uuid;
  v_file_id uuid;
  v_enc_ep int;
BEGIN
  FOR r IN
    SELECT id, matched_title_id, channel_id, telegram_file_id, telegram_message_id,
           file_name, caption, mime_type, file_size, duration_seconds,
           parsed_quality, parsed_resolution, parsed_language,
           parsed_season, parsed_episode
      FROM public.telegram_ingest
     WHERE matched_title_id IN (
            '606f0f4f-fb51-4b59-924e-9fa5337a9f45',
            '78103dd4-b041-4825-9359-c3709f904c17')
       AND match_locked = true
       AND deleted_at IS NULL
       AND telegram_file_id IS NOT NULL
  LOOP
    v_season_id := NULL;
    v_episode_id := NULL;

    IF r.parsed_season IS NOT NULL THEN
      SELECT id INTO v_season_id FROM public.seasons
       WHERE title_id = r.matched_title_id AND season_number = r.parsed_season
       LIMIT 1;
      IF v_season_id IS NULL THEN
        INSERT INTO public.seasons(title_id, season_number)
          VALUES (r.matched_title_id, r.parsed_season)
          RETURNING id INTO v_season_id;
      END IF;

      IF r.parsed_episode IS NOT NULL THEN
        v_enc_ep := r.parsed_episode;
        SELECT id INTO v_episode_id FROM public.episodes
         WHERE title_id = r.matched_title_id
           AND season_id = v_season_id
           AND episode_number = v_enc_ep
         LIMIT 1;
        IF v_episode_id IS NULL THEN
          INSERT INTO public.episodes(title_id, season_id, episode_number)
            VALUES (r.matched_title_id, v_season_id, v_enc_ep)
            RETURNING id INTO v_episode_id;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.media_files(
      title_id, episode_id, channel_id, telegram_file_id, telegram_message_id,
      file_name, caption, file_size, mime_type, quality, resolution, language,
      duration_seconds, is_active
    ) VALUES (
      r.matched_title_id, v_episode_id, r.channel_id, r.telegram_file_id, r.telegram_message_id,
      r.file_name, r.caption, r.file_size, r.mime_type, r.parsed_quality, r.parsed_resolution,
      r.parsed_language, r.duration_seconds, true
    )
    ON CONFLICT (telegram_file_id) DO UPDATE
      SET title_id = EXCLUDED.title_id,
          episode_id = EXCLUDED.episode_id,
          is_active = true,
          caption = EXCLUDED.caption,
          file_name = EXCLUDED.file_name,
          resolution = EXCLUDED.resolution,
          quality = EXCLUDED.quality,
          language = EXCLUDED.language
    RETURNING id INTO v_file_id;

    UPDATE public.telegram_ingest
       SET promoted_media_file_id = v_file_id,
           match_status = 'matched',
           last_error = NULL,
           updated_at = now()
     WHERE id = r.id;
  END LOOP;
END $$;