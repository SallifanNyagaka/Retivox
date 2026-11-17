-- Audited platform license controls and write-gate enforcement.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS license_suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS license_suspension_reason text;

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
  SELECT * INTO v_subscription FROM public.subscriptions WHERE business_id = v_business_id FOR UPDATE;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF v_subscription.license_suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'This business license is suspended. Contact Retivox support.' USING ERRCODE = '55000';
  END IF;
  IF v_subscription.current_period_end IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF v_subscription.next_plan_key IS NOT NULL AND v_subscription.next_period_start <= now() THEN
    v_period_start := GREATEST(v_subscription.next_period_start, now());
    UPDATE public.subscriptions
       SET plan = v_subscription.next_plan_key,
           billing_interval = v_subscription.next_billing_interval,
           monthly_amount = v_subscription.next_monthly_amount,
           currency = v_subscription.next_currency,
           payment_provider = v_subscription.next_payment_provider,
           current_period_start = v_period_start,
           current_period_end = v_period_start + CASE WHEN v_subscription.next_billing_interval = 'yearly' THEN interval '1 year' ELSE interval '1 month' END,
           status = 'active', next_plan_key = NULL, next_billing_interval = NULL,
           next_monthly_amount = NULL, next_currency = NULL, next_payment_provider = NULL,
           next_period_start = NULL, next_period_amount = NULL
     WHERE id = v_subscription.id;
    UPDATE public.businesses SET subscription_plan = v_subscription.next_plan_key, subscription_status = 'active'
     WHERE id = v_business_id;
    v_subscription.current_period_end := v_period_start + CASE WHEN v_subscription.next_billing_interval = 'yearly' THEN interval '1 year' ELSE interval '1 month' END;
  END IF;
  IF v_subscription.cancelled_at IS NOT NULL AND v_subscription.current_period_end <= now() THEN
    RAISE EXCEPTION 'Subscription is cancelled. Business changes ended with the paid period.' USING ERRCODE = '55000';
  END IF;
  IF v_subscription.current_period_end + interval '7 days' <= now() THEN
    RAISE EXCEPTION 'Subscription grace period ended. Renew from Settings > Subscription to resume business changes.' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_subscription_write_window() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.platform_apply_license_adjustment(
  p_business_id uuid,
  p_platform_user_id uuid,
  p_action text,
  p_reason text,
  p_days integer DEFAULT NULL,
  p_plan_key text DEFAULT NULL,
  p_billing_interval text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_subscription public.subscriptions%ROWTYPE;
  v_old jsonb;
  v_new jsonb;
  v_plan public.platform_subscription_plans%ROWTYPE;
  v_event text;
BEGIN
  IF p_action NOT IN ('suspend','reactivate','extend_period','complimentary','assign_lifetime','change_plan')
     OR length(trim(COALESCE(p_reason,''))) < 10 THEN
    RAISE EXCEPTION 'Provide a valid license action and a clear reason';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_users WHERE id = p_platform_user_id AND is_active = true) THEN
    RAISE EXCEPTION 'Platform administrator is unavailable';
  END IF;
  SELECT * INTO v_subscription FROM public.subscriptions WHERE business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business subscription was not found'; END IF;
  v_old := to_jsonb(v_subscription);

  IF p_action IN ('assign_lifetime','change_plan') THEN
    SELECT * INTO v_plan FROM public.platform_subscription_plans WHERE plan_key = p_plan_key AND is_active AND plan_key <> 'trial';
    IF NOT FOUND THEN RAISE EXCEPTION 'Select an active paid plan'; END IF;
  END IF;

  IF p_action = 'suspend' THEN
    UPDATE public.subscriptions SET license_suspended_at = now(), license_suspension_reason = trim(p_reason) WHERE id = v_subscription.id;
    v_event := 'license_suspended';
  ELSIF p_action = 'reactivate' THEN
    UPDATE public.subscriptions SET license_suspended_at = NULL, license_suspension_reason = NULL WHERE id = v_subscription.id;
    v_event := 'license_reactivated';
  ELSIF p_action = 'extend_period' THEN
    IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN RAISE EXCEPTION 'Extension must be between 1 and 365 days'; END IF;
    UPDATE public.subscriptions SET status = 'active', current_period_end = GREATEST(COALESCE(current_period_end, now()), now()) + make_interval(days => p_days), cancelled_at = NULL WHERE id = v_subscription.id;
    v_event := 'period_extended';
  ELSIF p_action = 'complimentary' THEN
    IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN RAISE EXCEPTION 'Complimentary access must be between 1 and 365 days'; END IF;
    UPDATE public.subscriptions SET status = 'active', license_type = 'subscription', billing_interval = 'monthly', monthly_amount = 0, paid_period_amount = 0, current_period_start = now(), current_period_end = now() + make_interval(days => p_days), cancelled_at = NULL WHERE id = v_subscription.id;
    v_event := 'complimentary_access';
  ELSIF p_action = 'assign_lifetime' THEN
    UPDATE public.subscriptions SET plan = p_plan_key, status = 'active', license_type = 'lifetime', billing_interval = 'lifetime', monthly_amount = v_plan.monthly_amount, paid_period_amount = 0, currency = v_plan.currency, current_period_start = now(), current_period_end = NULL, cancelled_at = NULL, license_suspended_at = NULL, license_suspension_reason = NULL, next_plan_key = NULL, next_billing_interval = NULL, next_monthly_amount = NULL, next_currency = NULL, next_payment_provider = NULL, next_period_start = NULL, next_period_amount = NULL WHERE id = v_subscription.id;
    v_event := 'lifetime_purchased';
  ELSE
    IF p_billing_interval NOT IN ('monthly','yearly') THEN RAISE EXCEPTION 'Select a recurring billing period'; END IF;
    UPDATE public.subscriptions SET plan = p_plan_key, status = 'active', license_type = 'subscription', billing_interval = p_billing_interval, monthly_amount = v_plan.monthly_amount, paid_period_amount = CASE WHEN p_billing_interval = 'yearly' THEN v_plan.yearly_amount ELSE v_plan.monthly_amount END, currency = v_plan.currency, current_period_start = now(), current_period_end = now() + CASE WHEN p_billing_interval = 'yearly' THEN interval '1 year' ELSE interval '1 month' END, cancelled_at = NULL WHERE id = v_subscription.id;
    v_event := 'complimentary_access';
  END IF;
  UPDATE public.businesses SET subscription_plan = (SELECT plan FROM public.subscriptions WHERE id = v_subscription.id), subscription_status = 'active' WHERE id = p_business_id;
  SELECT to_jsonb(subscription) INTO v_new FROM public.subscriptions subscription WHERE id = v_subscription.id;
  INSERT INTO public.platform_license_adjustments (business_id, subscription_id, platform_user_id, action, reason, old_values, new_values)
  VALUES (p_business_id, v_subscription.id, p_platform_user_id, p_action, trim(p_reason), v_old, v_new);
  INSERT INTO public.subscription_license_events (business_id, subscription_id, platform_user_id, event_type, from_plan, to_plan, from_interval, to_interval, reason, metadata)
  VALUES (p_business_id, v_subscription.id, p_platform_user_id, v_event, v_subscription.plan,
    (v_new->>'plan'), v_subscription.billing_interval, (v_new->>'billing_interval'), trim(p_reason), jsonb_build_object('admin_action', p_action, 'days', p_days));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_apply_license_adjustment(uuid,uuid,text,text,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_apply_license_adjustment(uuid,uuid,text,text,integer,text,text) TO service_role;
