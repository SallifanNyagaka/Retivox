-- An update to one billing interval must not publish a new snapshot for the
-- other intervals: that could supersede their pending 30-day price notice.
CREATE OR REPLACE FUNCTION public.capture_subscription_plan_price_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_interval text;
  v_new_amount numeric(10,2);
  v_old_amount numeric(10,2);
  v_changed boolean;
  v_increased boolean;
  v_effective_at timestamptz;
  v_reason text;
  v_history_id uuid;
  v_notification_id uuid;
  v_log_id uuid;
  v_sub record;
BEGIN
  FOREACH v_interval IN ARRAY ARRAY['monthly', 'yearly', 'lifetime'] LOOP
    IF v_interval = 'monthly' THEN
      v_new_amount := NEW.monthly_amount;
      v_old_amount := CASE WHEN TG_OP = 'UPDATE' THEN OLD.monthly_amount ELSE NULL END;
      v_changed := TG_OP = 'INSERT' OR NEW.monthly_amount IS DISTINCT FROM OLD.monthly_amount
        OR NEW.currency IS DISTINCT FROM OLD.currency;
    ELSIF v_interval = 'yearly' THEN
      v_new_amount := NEW.yearly_amount;
      v_old_amount := CASE WHEN TG_OP = 'UPDATE' THEN OLD.yearly_amount ELSE NULL END;
      v_changed := TG_OP = 'INSERT' OR NEW.yearly_amount IS DISTINCT FROM OLD.yearly_amount
        OR NEW.currency IS DISTINCT FROM OLD.currency;
    ELSE
      v_new_amount := NEW.lifetime_amount;
      v_old_amount := CASE WHEN TG_OP = 'UPDATE' THEN OLD.lifetime_amount ELSE NULL END;
      v_changed := TG_OP = 'INSERT' OR NEW.lifetime_amount IS DISTINCT FROM OLD.lifetime_amount
        OR NEW.lifetime_enabled IS DISTINCT FROM OLD.lifetime_enabled
        OR NEW.currency IS DISTINCT FROM OLD.currency;
    END IF;

    IF NOT v_changed THEN CONTINUE; END IF;
    IF v_interval = 'lifetime' AND (NOT NEW.lifetime_enabled OR v_new_amount IS NULL) THEN
      CONTINUE;
    END IF;

    v_increased := TG_OP = 'UPDATE'
      AND v_old_amount IS NOT NULL
      AND v_new_amount IS NOT NULL
      AND (v_new_amount > v_old_amount OR NEW.currency IS DISTINCT FROM OLD.currency);
    v_effective_at := CASE WHEN v_increased THEN now() + interval '30 days' ELSE now() END;
    v_reason := CASE WHEN v_increased THEN 'Price increase; existing subscribers notified with 30 days notice' ELSE NULL END;

    INSERT INTO public.platform_subscription_price_history (
      plan_id, plan_key, billing_interval, amount, currency,
      new_purchase_effective_at, existing_subscriber_effective_at, published_by, reason
    ) VALUES (
      NEW.id, NEW.plan_key, v_interval, v_new_amount, NEW.currency,
      now(), v_effective_at, NEW.updated_by, v_reason
    ) RETURNING id INTO v_history_id;

    IF v_increased THEN
      FOR v_sub IN
        SELECT subscription.business_id, user_row.id AS recipient_id
          FROM public.subscriptions AS subscription
          JOIN public.users AS user_row ON user_row.business_id = subscription.business_id
         WHERE subscription.plan = NEW.plan_key
           AND subscription.billing_interval = v_interval
           AND subscription.license_type = 'subscription'
           AND subscription.status IN ('active', 'past_due')
           AND user_row.global_role = 'owner'
           AND user_row.is_active = true
           AND user_row.deleted_at IS NULL
      LOOP
        INSERT INTO public.platform_subscription_price_notice_log (
          price_history_id, business_id, recipient_id
        ) VALUES (v_history_id, v_sub.business_id, v_sub.recipient_id)
        ON CONFLICT (price_history_id, business_id, recipient_id) DO NOTHING
        RETURNING id INTO v_log_id;

        IF v_log_id IS NOT NULL THEN
          INSERT INTO public.notifications (
            business_id, recipient_id, type, title, body, metadata
          ) VALUES (
            v_sub.business_id,
            v_sub.recipient_id,
            'subscription_price_change',
            'Subscription price changing soon',
            format(
              'The %s plan %s renewal price changes from %s %s to %s %s on %s. The new price applies at renewal after this 30-day notice period.',
              v_interval, NEW.plan_key, v_old_amount, OLD.currency, v_new_amount, NEW.currency,
              to_char(v_effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
            ),
            jsonb_build_object(
              'plan_key', NEW.plan_key,
              'billing_interval', v_interval,
              'previous_amount', v_old_amount,
              'new_amount', v_new_amount,
              'previous_currency', OLD.currency,
              'new_currency', NEW.currency,
              'effective_at', v_effective_at,
              'price_history_id', v_history_id
            )
          ) RETURNING id INTO v_notification_id;

          UPDATE public.platform_subscription_price_notice_log
             SET notification_id = v_notification_id
           WHERE id = v_log_id;
        END IF;
        v_log_id := NULL;
      END LOOP;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_subscription_plan_price_history() FROM PUBLIC, anon, authenticated;
