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
  v_subscription public.subscriptions%ROWTYPE;
  v_new_period_start timestamptz;
  v_new_period_end timestamptz;
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
    NULLIF(trim(COALESCE(p_provider_receipt_number, '')), '') IS NULL
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

  IF p_result_code = 0 THEN
    SELECT *
      INTO v_subscription
      FROM public.subscriptions
     WHERE id = v_payment.subscription_id
     FOR UPDATE;

    IF FOUND THEN
      v_new_period_start := GREATEST(COALESCE(v_subscription.current_period_end, now()), now());
      v_new_period_end := v_new_period_start + interval '1 month';

      UPDATE public.subscriptions
         SET status = 'active',
             plan = COALESCE(NULLIF(plan, ''), 'starter'),
             monthly_amount = CASE WHEN COALESCE(monthly_amount, 0) <= 0 THEN v_payment.amount ELSE monthly_amount END,
             currency = COALESCE(NULLIF(currency, ''), v_payment.currency),
             payment_provider = 'daraja',
             current_period_start = v_new_period_start,
             current_period_end = v_new_period_end
       WHERE id = v_subscription.id;

      UPDATE public.businesses
         SET subscription_plan = COALESCE(NULLIF(v_subscription.plan, ''), 'starter'),
             subscription_status = 'active'
       WHERE id = v_payment.business_id;
    END IF;
  END IF;

  INSERT INTO public.platform_audit_logs (
    entity_type,
    entity_id,
    action,
    old_value,
    new_value
  )
  VALUES (
    'subscription_payment_request',
    v_payment.id,
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

REVOKE ALL ON FUNCTION public.platform_record_daraja_payment_result(text, text, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_record_daraja_payment_result_v2(text, text, integer, text, jsonb, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_record_daraja_payment_result_v2(text, text, integer, text, jsonb, text, numeric, text) TO service_role;