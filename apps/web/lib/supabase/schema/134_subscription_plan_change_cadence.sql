-- Apply verified subscription renewals and scheduled downgrades close to their
-- effective time. Lifecycle notices are idempotently deduplicated by their log.
DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
    FROM cron.job
   WHERE jobname = 'retivox-subscription-lifecycle';

  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;

  PERFORM cron.schedule(
    'retivox-subscription-lifecycle',
    '*/5 * * * *',
    'SELECT public.process_subscription_lifecycle();'
  );
END;
$$;
