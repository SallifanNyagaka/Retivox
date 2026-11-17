-- A seven-day grace period preserves read/write service after a renewal date
-- while reminders are delivered. Expired accounts retain read access; the
-- existing subscription write-window trigger blocks business mutations.

CREATE TABLE IF NOT EXISTS public.subscription_lifecycle_notice_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  period_end timestamptz NOT NULL,
  notice_key text NOT NULL CHECK (notice_key IN (
    '7_days', '3_days', '2_days', '1_day', 'period_ended',
    'grace_day_1', 'grace_day_2', 'grace_day_3', 'grace_day_4',
    'grace_day_5', 'grace_day_6', 'grace_ended'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, subscription_id, recipient_id, period_end, notice_key)
);

ALTER TABLE public.subscription_lifecycle_notice_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_lifecycle_notice_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.process_subscription_lifecycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_subscription record;
  v_owner record;
  v_days_left integer;
  v_notice_key text;
  v_notice_id uuid;
  v_renewals integer := 0;
  v_past_due integer := 0;
  v_expired integer := 0;
  v_notices integer := 0;
BEGIN
  -- Apply plan changes that were paid for and scheduled at period end, even if
  -- no user writes occur precisely at the renewal boundary.
  WITH applied AS (
    UPDATE public.subscriptions AS subscription
       SET plan = subscription.next_plan_key,
           billing_interval = subscription.next_billing_interval,
           monthly_amount = subscription.next_monthly_amount,
           currency = subscription.next_currency,
           payment_provider = subscription.next_payment_provider,
           current_period_start = GREATEST(subscription.next_period_start, now()),
           current_period_end = GREATEST(subscription.next_period_start, now()) +
             CASE WHEN subscription.next_billing_interval = 'yearly' THEN interval '1 year' ELSE interval '1 month' END,
           status = 'active',
           next_plan_key = NULL,
           next_billing_interval = NULL,
           next_monthly_amount = NULL,
           next_currency = NULL,
           next_payment_provider = NULL,
           next_period_start = NULL
      FROM public.businesses AS business
     WHERE business.id = subscription.business_id
       AND subscription.next_plan_key IS NOT NULL
       AND subscription.next_period_start <= now()
    RETURNING subscription.business_id, subscription.plan
  )
  UPDATE public.businesses AS business
     SET subscription_plan = applied.plan,
         subscription_status = 'active'
    FROM applied
   WHERE business.id = applied.business_id;
  GET DIAGNOSTICS v_renewals = ROW_COUNT;

  WITH changed AS (
    UPDATE public.subscriptions AS subscription
       SET status = 'past_due'
     WHERE subscription.status = 'active'
       AND subscription.current_period_end <= now()
       AND subscription.current_period_end + interval '7 days' > now()
    RETURNING subscription.business_id
  )
  UPDATE public.businesses AS business
     SET subscription_status = 'past_due'
    FROM changed
   WHERE business.id = changed.business_id;
  GET DIAGNOSTICS v_past_due = ROW_COUNT;

  WITH changed AS (
    UPDATE public.subscriptions AS subscription
       SET status = 'expired'
     WHERE subscription.status IN ('active', 'past_due', 'expired', 'cancelled')
       AND ((subscription.cancelled_at IS NOT NULL AND subscription.current_period_end <= now())
         OR subscription.current_period_end + interval '7 days' <= now())
    RETURNING subscription.business_id
  )
  UPDATE public.businesses AS business
     SET subscription_status = 'expired'
    FROM changed
   WHERE business.id = changed.business_id;
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  FOR v_subscription IN
    SELECT subscription.id, subscription.business_id, subscription.current_period_end, subscription.status, subscription.cancelled_at,
           zone.timezone_name,
           (subscription.current_period_end AT TIME ZONE zone.timezone_name)::date
             - (now() AT TIME ZONE zone.timezone_name)::date AS days_left
      FROM public.subscriptions AS subscription
      JOIN public.businesses AS business ON business.id = subscription.business_id
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = business.timezone) THEN business.timezone
          ELSE 'UTC'
        END AS timezone_name
      ) AS zone
     WHERE subscription.status IN ('active', 'past_due', 'expired')
       AND subscription.current_period_end IS NOT NULL
  LOOP
    v_days_left := v_subscription.days_left;
    IF v_subscription.cancelled_at IS NOT NULL AND v_days_left > 0 THEN CONTINUE; END IF;
    IF v_subscription.cancelled_at IS NOT NULL AND v_days_left < 0 THEN CONTINUE; END IF;
    v_notice_key := CASE v_days_left
      WHEN 7 THEN '7_days'
      WHEN 3 THEN '3_days'
      WHEN 2 THEN '2_days'
      WHEN 1 THEN '1_day'
      WHEN 0 THEN 'period_ended'
      WHEN -7 THEN 'grace_ended'
      ELSE NULL
    END;
    IF v_days_left BETWEEN -6 AND -1 THEN
      v_notice_key := 'grace_day_' || abs(v_days_left)::text;
    ELSIF v_days_left <= -7 THEN
      v_notice_key := 'grace_ended';
    END IF;
    IF v_notice_key IS NULL THEN CONTINUE; END IF;

    FOR v_owner IN
      SELECT id FROM public.users
       WHERE business_id = v_subscription.business_id
         AND global_role = 'owner'
         AND is_active = true
         AND deleted_at IS NULL
    LOOP
      INSERT INTO public.subscription_lifecycle_notice_log (
        business_id, subscription_id, recipient_id, period_end, notice_key
      ) VALUES (
        v_subscription.business_id, v_subscription.id, v_owner.id,
        v_subscription.current_period_end, v_notice_key
      ) ON CONFLICT DO NOTHING
      RETURNING id INTO v_notice_id;

      IF v_notice_id IS NOT NULL THEN
        INSERT INTO public.notifications (
          business_id, recipient_id, type, title, body, metadata
        ) VALUES (
          v_subscription.business_id,
          v_owner.id,
          'subscription_' || v_notice_key,
          CASE v_notice_key
            WHEN 'period_ended' THEN 'Subscription period ended'
            WHEN 'grace_ended' THEN 'Subscription grace period ended'
            WHEN 'grace_day_1' THEN 'Subscription grace period'
            WHEN 'grace_day_2' THEN 'Subscription grace period'
            WHEN 'grace_day_3' THEN 'Subscription grace period'
            WHEN 'grace_day_4' THEN 'Subscription grace period'
            WHEN 'grace_day_5' THEN 'Subscription grace period'
            WHEN 'grace_day_6' THEN 'Subscription grace period'
            ELSE 'Subscription renewal reminder'
          END,
          CASE v_notice_key
            WHEN '7_days' THEN 'Your subscription period ends in 7 days. Review your plan and arrange renewal.'
            WHEN '3_days' THEN 'Your subscription period ends in 3 days. Review your plan and arrange renewal.'
            WHEN '2_days' THEN 'Your subscription period ends in 2 days. Review your plan and arrange renewal.'
            WHEN '1_day' THEN 'Your subscription period ends tomorrow. Review your plan and arrange renewal.'
            WHEN 'period_ended' THEN CASE
              WHEN v_subscription.cancelled_at IS NOT NULL THEN 'Your cancelled subscription period has ended. Business changes are now read-only.'
              ELSE 'Your subscription period has ended. Renew within 7 days to avoid write restrictions.'
            END
            WHEN 'grace_day_1' THEN 'Your subscription is in its 1st grace-period day. Renew within 6 days to keep business changes available.'
            WHEN 'grace_day_2' THEN 'Your subscription is in its 2nd grace-period day. Renew within 5 days to keep business changes available.'
            WHEN 'grace_day_3' THEN 'Your subscription is in its 3rd grace-period day. Renew within 4 days to keep business changes available.'
            WHEN 'grace_day_4' THEN 'Your subscription is in its 4th grace-period day. Renew within 3 days to keep business changes available.'
            WHEN 'grace_day_5' THEN 'Your subscription is in its 5th grace-period day. Renew within 2 days to keep business changes available.'
            WHEN 'grace_day_6' THEN 'Your subscription is in its final grace-period day. Renew today to keep business changes available.'
            ELSE 'The 7-day grace period has ended. Business changes are paused until the subscription is renewed.'
          END,
          jsonb_build_object(
            'subscription_id', v_subscription.id,
            'period_end', v_subscription.current_period_end,
            'notice_key', v_notice_key
          )
        );
        v_notices := v_notices + 1;
      END IF;
      v_notice_id := NULL;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'renewals_applied', v_renewals,
    'moved_to_past_due', v_past_due,
    'expired', v_expired,
    'notifications_created', v_notices
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_subscription_lifecycle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_subscription_lifecycle() TO service_role;

-- Extend the existing write gate by seven days. Status transitions and alerts
-- are handled by the daily job; the timestamp check remains authoritative.
CREATE OR REPLACE FUNCTION public.enforce_subscription_write_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_business_id uuid;
  v_subscription public.subscriptions%ROWTYPE;
  v_period_start timestamptz;
BEGIN
  IF auth.uid() IS NULL OR TG_TABLE_NAME IN ('subscription_payment_requests', 'audit_logs') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_TABLE_NAME = 'businesses' THEN
    v_business_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    v_business_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.business_id ELSE NEW.business_id END;
  END IF;
  IF v_business_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT * INTO v_subscription
    FROM public.subscriptions
   WHERE business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND OR v_subscription.current_period_end IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF v_subscription.next_plan_key IS NOT NULL
     AND v_subscription.next_period_start <= now() THEN
    v_period_start := GREATEST(v_subscription.next_period_start, now());
    UPDATE public.subscriptions
       SET plan = v_subscription.next_plan_key,
           billing_interval = v_subscription.next_billing_interval,
           monthly_amount = v_subscription.next_monthly_amount,
           currency = v_subscription.next_currency,
           payment_provider = v_subscription.next_payment_provider,
           current_period_start = v_period_start,
           current_period_end = v_period_start + CASE
             WHEN v_subscription.next_billing_interval = 'yearly' THEN interval '1 year'
             ELSE interval '1 month'
           END,
           status = 'active',
           next_plan_key = NULL,
           next_billing_interval = NULL,
           next_monthly_amount = NULL,
           next_currency = NULL,
           next_payment_provider = NULL,
           next_period_start = NULL
     WHERE id = v_subscription.id;
    UPDATE public.businesses
       SET subscription_plan = v_subscription.next_plan_key,
           subscription_status = 'active'
     WHERE id = v_business_id;
    v_subscription.current_period_end := v_period_start + CASE
      WHEN v_subscription.next_billing_interval = 'yearly' THEN interval '1 year'
      ELSE interval '1 month'
    END;
  END IF;

  IF v_subscription.cancelled_at IS NOT NULL
     AND v_subscription.current_period_end <= now() THEN
    RAISE EXCEPTION 'Subscription is cancelled. Business changes ended with the paid period.'
      USING ERRCODE = '55000';
  END IF;

  IF v_subscription.current_period_end + interval '7 days' <= now() THEN
    RAISE EXCEPTION 'Subscription grace period ended. Renew from Settings > Subscription to resume business changes.'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'retivox-subscription-lifecycle';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
  PERFORM cron.schedule(
    'retivox-subscription-lifecycle',
    '15 6 * * *',
    'SELECT public.process_subscription_lifecycle();'
  );
END;
$$;
