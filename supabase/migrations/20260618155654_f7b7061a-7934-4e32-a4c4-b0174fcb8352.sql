
SELECT cron.unschedule('shortener-alerts-5min') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shortener-alerts-5min');
SELECT cron.schedule(
  'shortener-alerts-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--ehjkzvddtgljntwwasui-dev.lovable.app/api/public/hooks/shortener-alerts',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_Nry_xjm60dRoxI6pZxnleQ_oJo4d1P8"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
