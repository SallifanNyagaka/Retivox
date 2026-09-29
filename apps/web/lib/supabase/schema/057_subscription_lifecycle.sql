ALTER TABLE public.platform_subscription_plans
  ADD COLUMN IF NOT EXISTS annual_discount_percent numeric(5,2) NOT NULL DEFAULT 0;

UPDATE public.platform_subscription_plans
   SET name = 'Free',
     monthly_amount = 0,
       annual_discount_percent = 0,
       is_active = true
 WHERE plan_key = 'trial';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'platform_subscription_plans_annual_discount_valid'
       AND conrelid = 'public.platform_subscription_plans'::regclass
  ) THEN
    ALTER TABLE public.platform_subscription_plans
      ADD CONSTRAINT platform_subscription_plans_annual_discount_valid
      CHECK (annual_discount_percent >= 0 AND annual_discount_percent <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'platform_subscription_plans_trial_free'
       AND conrelid = 'public.platform_subscription_plans'::regclass
  ) THEN
    ALTER TABLE public.platform_subscription_plans
      ADD CONSTRAINT platform_subscription_plans_trial_free
      CHECK (plan_key <> 'trial' OR (name = 'Free' AND monthly_amount = 0 AND annual_discount_percent = 0 AND is_active = true));
  END IF;
END;
$$;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS billing_interval text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS next_plan_key text,
  ADD COLUMN IF NOT EXISTS next_billing_interval text,
  ADD COLUMN IF NOT EXISTS next_monthly_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS next_currency char(3),
  ADD COLUMN IF NOT EXISTS next_payment_provider text,
  ADD COLUMN IF NOT EXISTS next_period_start timestamptz;

UPDATE public.subscriptions
   SET current_period_start = COALESCE(current_period_start, now()),
       current_period_end = now() + interval '30 days'
 WHERE current_period_end IS NULL
   AND status = 'active';

DROP POLICY IF EXISTS "subscriptions_insert" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_update" ON public.subscriptions;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'subscriptions_billing_interval_valid'
       AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_billing_interval_valid
      CHECK (billing_interval IN ('monthly', 'yearly'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'subscriptions_next_billing_interval_valid'
       AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_next_billing_interval_valid
      CHECK (next_billing_interval IS NULL OR next_billing_interval IN ('monthly', 'yearly'));
  END IF;
END;
$$;

ALTER TABLE public.subscription_payment_requests
  ADD COLUMN IF NOT EXISTS plan_key text,
  ADD COLUMN IF NOT EXISTS plan_monthly_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS billing_interval text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS platform_reviewed_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL;

UPDATE public.subscription_payment_requests AS payment_requests
   SET plan_key = CASE WHEN subscriptions.plan = 'trial' THEN 'starter' ELSE subscriptions.plan END,
       plan_monthly_amount = COALESCE(NULLIF(subscriptions.monthly_amount, 0), payment_requests.amount),
       billing_interval = COALESCE(subscriptions.billing_interval, 'monthly')
  FROM public.subscriptions
 WHERE subscriptions.id = payment_requests.subscription_id
   AND payment_requests.status = 'pending'
   AND payment_requests.plan_key IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'subscription_payment_requests_billing_interval_valid'
       AND conrelid = 'public.subscription_payment_requests'::regclass
  ) THEN
    ALTER TABLE public.subscription_payment_requests
      ADD CONSTRAINT subscription_payment_requests_billing_interval_valid
      CHECK (billing_interval IN ('monthly', 'yearly'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_submit_subscription_payment_v2(
  p_plan_key text,
  p_billing_interval text,
  p_reference_code text,
  p_payment_method text DEFAULT 'mpesa_manual',
  p_payer_phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
  v_plan public.platform_subscription_plans%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_amount numeric(10,2);
  v_request_id uuid;
BEGIN
  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_payment_method NOT IN ('mpesa_manual', 'bank_transfer', 'cash_deposit', 'other') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  IF p_billing_interval NOT IN ('monthly', 'yearly') THEN
    RAISE EXCEPTION 'Unsupported billing interval';
  END IF;

  IF length(NULLIF(trim(COALESCE(p_reference_code, '')), '')) < 3 THEN
    RAISE EXCEPTION 'Enter a valid payment reference';
  END IF;

  SELECT *
    INTO v_plan
    FROM public.platform_subscription_plans
   WHERE plan_key = p_plan_key
     AND is_active = true
     AND plan_key <> 'trial';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected plan is not available';
  END IF;

  v_amount := CASE
    WHEN p_billing_interval = 'yearly'
      THEN round(v_plan.monthly_amount * 12 * (1 - v_plan.annual_discount_percent / 100), 2)
    ELSE v_plan.monthly_amount
  END;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Selected plan does not have a payable price';
  END IF;

  INSERT INTO public.subscriptions (
    business_id, plan, status, branch_count, monthly_amount, currency,
    current_period_start, current_period_end
  )
  VALUES (
    v_business_id, 'trial', 'active', 1, 0, v_plan.currency,
    now(), now() + interval '30 days'
  )
  ON CONFLICT (business_id) DO NOTHING;

  SELECT *
    INTO v_subscription
    FROM public.subscriptions
   WHERE business_id = v_business_id
   FOR UPDATE;

  INSERT INTO public.subscription_payment_requests (
    business_id, subscription_id, submitted_by, amount, currency,
    payment_method, reference_code, payer_phone, status, plan_key, plan_monthly_amount, billing_interval
  )
  VALUES (
    v_business_id, v_subscription.id, v_actor_id, v_amount, v_plan.currency,
    p_payment_method, trim(p_reference_code),
    NULLIF(trim(COALESCE(p_payer_phone, '')), ''), 'pending', p_plan_key, v_plan.monthly_amount, p_billing_interval
  )
  RETURNING id INTO v_request_id;

  INSERT INTO public.audit_logs (
    business_id, actor_id, entity_type, entity_id, action, old_value, new_value
  )
  VALUES (
    v_business_id, v_actor_id, 'subscription_payment_request', v_request_id, 'submitted', NULL,
    jsonb_build_object(
      'plan_key', p_plan_key,
      'billing_interval', p_billing_interval,
      'amount', v_amount,
      'monthly_amount', v_plan.monthly_amount,
      'currency', v_plan.currency,
      'payment_method', p_payment_method
    )
  );

  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_apply_subscription_payment(p_payment_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.subscription_payment_requests%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_period_start timestamptz;
  v_period_end timestamptz;
BEGIN
  SELECT *
    INTO v_payment
    FROM public.subscription_payment_requests
   WHERE id = p_payment_request_id
   FOR UPDATE;

  IF NOT FOUND OR v_payment.status <> 'verified' OR v_payment.plan_key IS NULL THEN
    RETURN false;
  END IF;

  SELECT *
    INTO v_subscription
    FROM public.subscriptions
   WHERE id = v_payment.subscription_id
     AND business_id = v_payment.business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_subscription.current_period_end > now() THEN
    UPDATE public.subscriptions
       SET next_plan_key = v_payment.plan_key,
           next_billing_interval = v_payment.billing_interval,
           next_monthly_amount = v_payment.plan_monthly_amount,
           next_currency = v_payment.currency,
           next_payment_provider = CASE WHEN v_payment.payment_method = 'mpesa_stk' THEN 'daraja' ELSE 'manual' END,
           next_period_start = v_subscription.current_period_end
     WHERE id = v_subscription.id;
  ELSE
    v_period_start := now();
    v_period_end := v_period_start + CASE
      WHEN v_payment.billing_interval = 'yearly' THEN interval '1 year'
      ELSE interval '1 month'
    END;

    UPDATE public.subscriptions
       SET plan = v_payment.plan_key,
           status = 'active',
           billing_interval = v_payment.billing_interval,
           monthly_amount = v_payment.plan_monthly_amount,
           currency = v_payment.currency,
           payment_provider = CASE WHEN v_payment.payment_method = 'mpesa_stk' THEN 'daraja' ELSE 'manual' END,
           current_period_start = v_period_start,
           current_period_end = v_period_end,
           next_plan_key = NULL,
           next_billing_interval = NULL,
           next_monthly_amount = NULL,
           next_currency = NULL,
           next_payment_provider = NULL,
           next_period_start = NULL
     WHERE id = v_subscription.id;

    UPDATE public.businesses
       SET subscription_plan = v_payment.plan_key,
           subscription_status = 'active'
     WHERE id = v_payment.business_id;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_review_subscription_payment(
  p_payment_request_id uuid,
  p_approved boolean,
  p_platform_user_id uuid,
  p_review_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.subscription_payment_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_users
     WHERE id = p_platform_user_id
       AND role = 'developer'
       AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Only active platform developers can review subscription payments';
  END IF;

  SELECT *
    INTO v_payment
    FROM public.subscription_payment_requests
   WHERE id = p_payment_request_id
     AND payment_method IN ('mpesa_manual', 'bank_transfer', 'cash_deposit', 'other')
   FOR UPDATE;

  IF NOT FOUND OR v_payment.status <> 'pending' THEN
    RETURN false;
  END IF;

  UPDATE public.subscription_payment_requests
     SET status = CASE WHEN p_approved THEN 'verified' ELSE 'rejected' END,
         platform_reviewed_by = p_platform_user_id,
         reviewed_at = now(),
         paid_at = CASE WHEN p_approved THEN now() ELSE paid_at END,
         review_note = NULLIF(trim(COALESCE(p_review_note, '')), '')
   WHERE id = v_payment.id;

  IF p_approved AND NOT public.platform_apply_subscription_payment(v_payment.id) THEN
    RAISE EXCEPTION 'Unable to apply the approved subscription payment';
  END IF;

  INSERT INTO public.platform_audit_logs (
    platform_user_id, entity_type, entity_id, action, old_value, new_value
  )
  VALUES (
    p_platform_user_id,
    'subscription_payment_request',
    v_payment.id,
    CASE WHEN p_approved THEN 'manual_payment_verified' ELSE 'manual_payment_rejected' END,
    jsonb_build_object('status', v_payment.status),
    jsonb_build_object('review_note', NULLIF(trim(COALESCE(p_review_note, '')), ''))
  );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_record_daraja_payment_result_v2(
  p_checkout_request_id text,
  p_merchant_request_id text,
  p_result_code integer,
  p_result_description text,
  p_raw_payload jsonb,
  p_provider_receipt_number text,
  p_provider_paid_amount numeric,
  p_provider_phone_number text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.subscription_payment_requests%ROWTYPE;
BEGIN
  SELECT *
    INTO v_payment
    FROM public.subscription_payment_requests
   WHERE provider = 'daraja'
     AND payment_method = 'mpesa_stk'
     AND provider_checkout_request_id = p_checkout_request_id
   ORDER BY submitted_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_payment.status <> 'pending' THEN
    RETURN true;
  END IF;

  IF v_payment.provider_merchant_request_id IS NOT NULL
     AND v_payment.provider_merchant_request_id IS DISTINCT FROM p_merchant_request_id THEN
    RETURN false;
  END IF;

  IF p_result_code = 0 AND (
    v_payment.plan_key IS NULL
    OR NULLIF(trim(COALESCE(p_provider_receipt_number, '')), '') IS NULL
    OR p_provider_paid_amount IS DISTINCT FROM v_payment.amount
    OR p_provider_phone_number IS DISTINCT FROM v_payment.payer_phone
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.subscription_payment_requests
     SET provider_merchant_request_id = COALESCE(p_merchant_request_id, provider_merchant_request_id),
         provider_result_code = p_result_code,
         provider_result_description = p_result_description,
         raw_provider_payload = p_raw_payload,
         provider_receipt_number = CASE WHEN p_result_code = 0 THEN p_provider_receipt_number ELSE provider_receipt_number END,
         provider_paid_amount = CASE WHEN p_result_code = 0 THEN p_provider_paid_amount ELSE provider_paid_amount END,
         provider_phone_number = CASE WHEN p_result_code = 0 THEN p_provider_phone_number ELSE provider_phone_number END,
         status = CASE WHEN p_result_code = 0 THEN 'verified' ELSE 'rejected' END,
         paid_at = CASE WHEN p_result_code = 0 THEN now() ELSE paid_at END,
         reviewed_at = now(),
         review_note = p_result_description
   WHERE id = v_payment.id;

  IF p_result_code = 0 AND NOT public.platform_apply_subscription_payment(v_payment.id) THEN
    RAISE EXCEPTION 'Unable to apply verified subscription payment';
  END IF;

  INSERT INTO public.platform_audit_logs (
    entity_type, entity_id, action, old_value, new_value
  )
  VALUES (
    'subscription_payment_request', v_payment.id,
    CASE WHEN p_result_code = 0 THEN 'daraja_payment_verified' ELSE 'daraja_payment_failed' END,
    jsonb_build_object('status', v_payment.status),
    jsonb_build_object(
      'checkout_request_id', p_checkout_request_id,
      'merchant_request_id', p_merchant_request_id,
      'result_code', p_result_code,
      'result_description', p_result_description
    )
  );

  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.owner_my_subscription_payment_requests(integer);

CREATE OR REPLACE FUNCTION public.owner_my_subscription_payment_requests(p_limit integer DEFAULT 10)
RETURNS TABLE(
  id uuid,
  amount numeric,
  currency char(3),
  payment_method text,
  reference_code text,
  payer_phone text,
  status text,
  review_note text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  provider_checkout_request_id text,
  provider_receipt_number text,
  provider_paid_amount numeric,
  provider_phone_number text,
  provider_result_description text,
  plan_key text,
  billing_interval text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    payment_requests.id,
    payment_requests.amount,
    payment_requests.currency,
    payment_requests.payment_method,
    payment_requests.reference_code,
    payment_requests.payer_phone,
    payment_requests.status,
    payment_requests.review_note,
    payment_requests.submitted_at,
    payment_requests.reviewed_at,
    payment_requests.provider_checkout_request_id,
    payment_requests.provider_receipt_number,
    payment_requests.provider_paid_amount,
    payment_requests.provider_phone_number,
    payment_requests.provider_result_description,
    payment_requests.plan_key,
    payment_requests.billing_interval
  FROM public.subscription_payment_requests AS payment_requests
  WHERE payment_requests.business_id = public.get_my_business_id()
    AND public.get_my_global_role() = 'owner'
  ORDER BY payment_requests.submitted_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
$$;

CREATE OR REPLACE FUNCTION public.enforce_subscription_write_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  SELECT *
    INTO v_subscription
    FROM public.subscriptions
   WHERE business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND OR v_subscription.current_period_end IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF v_subscription.status IN ('cancelled', 'expired') THEN
    RAISE EXCEPTION 'Subscription is not active. Complete payment from Settings > Subscription to resume business changes.'
      USING ERRCODE = '55000';
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

  IF v_subscription.current_period_end <= now() THEN
    RAISE EXCEPTION 'Subscription period ended. Open Settings > Subscription and complete payment to resume business changes.'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DO $$
DECLARE
  v_table record;
BEGIN
  FOR v_table IN
    SELECT DISTINCT table_class.relname
      FROM pg_class AS table_class
      JOIN pg_namespace AS table_schema ON table_schema.oid = table_class.relnamespace
      JOIN pg_attribute AS table_column ON table_column.attrelid = table_class.oid
     WHERE table_schema.nspname = 'public'
       AND table_class.relkind IN ('r', 'p')
       AND table_column.attname = 'business_id'
       AND NOT table_column.attisdropped
      AND table_class.relname NOT IN ('subscription_payment_requests', 'audit_logs', 'subscriptions')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS subscription_write_window ON public.%I', v_table.relname);
    EXECUTE format(
      'CREATE TRIGGER subscription_write_window BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_write_window()',
      v_table.relname
    );
  END LOOP;

  EXECUTE 'DROP TRIGGER IF EXISTS subscription_write_window ON public.businesses';
  EXECUTE 'CREATE TRIGGER subscription_write_window BEFORE UPDATE OR DELETE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_write_window()';
END;
$$;

REVOKE ALL ON FUNCTION public.owner_submit_subscription_payment_v2(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_submit_subscription_payment_v2(text, text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_submit_subscription_payment(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_my_subscription_payment_requests(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_my_subscription_payment_requests(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_apply_subscription_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_apply_subscription_payment(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.platform_review_subscription_payment(uuid, boolean, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_review_subscription_payment(uuid, boolean, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.platform_record_daraja_payment_result_v2(text, text, integer, text, jsonb, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_record_daraja_payment_result_v2(text, text, integer, text, jsonb, text, numeric, text) TO service_role;