-- Preserve sanitized provider callback data and turn settlement mismatches into
-- reviewable results. A raised exception would roll back the webhook audit row.
ALTER TABLE public.provider_webhook_events
  ADD COLUMN IF NOT EXISTS provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  ALTER TABLE public.provider_webhook_events
    ADD CONSTRAINT provider_webhook_events_payload_object
    CHECK (jsonb_typeof(provider_payload) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.record_business_daraja_stk_result(
  p_checkout_request_id text,
  p_merchant_request_id text,
  p_result_code integer,
  p_result_description text,
  p_receipt text,
  p_paid_amount numeric,
  p_phone text,
  p_raw_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_normalized_phone text;
  v_event_id text;
  v_old_result text;
  v_payload jsonb := COALESCE(p_raw_payload, '{}'::jsonb);
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(COALESCE(p_checkout_request_id, '')), '') IS NULL
     OR length(p_checkout_request_id) > 128
     OR p_result_code IS NULL
     OR jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid checkout callback';
  END IF;

  v_event_id := 'stk:' || p_checkout_request_id || ':' || p_result_code::text;
  INSERT INTO public.provider_webhook_events(provider, event_id, result, provider_payload)
  VALUES ('daraja', v_event_id, 'received', v_payload)
  ON CONFLICT (provider, event_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT result INTO v_old_result
      FROM public.provider_webhook_events
     WHERE provider = 'daraja' AND event_id = v_event_id;
    IF v_old_result = 'unmatched' THEN
      UPDATE public.provider_webhook_events
         SET result = 'retrying_unmatched', processed_at = NULL, provider_payload = v_payload
       WHERE provider = 'daraja' AND event_id = v_event_id;
    ELSIF v_old_result = 'payment_mismatch' OR v_old_result IN ('merchant_request_mismatch', 'invalid_payment_method') THEN
      RETURN false;
    ELSE
      RETURN true;
    END IF;
  END IF;

  SELECT * INTO v_payment
    FROM public.payments
   WHERE provider = 'daraja' AND mpesa_checkout_id = p_checkout_request_id
   FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.provider_webhook_events
       SET result = 'unmatched', processed_at = now(), provider_payload = v_payload
     WHERE provider = 'daraja' AND event_id = v_event_id;
    RETURN false;
  END IF;

  IF v_payment.payment_method <> 'mpesa_stk' THEN
    UPDATE public.provider_webhook_events
       SET business_id = v_payment.business_id, result = 'invalid_payment_method',
           processed_at = now(), provider_payload = v_payload
     WHERE provider = 'daraja' AND event_id = v_event_id;
    RETURN false;
  END IF;

  IF v_payment.status = 'verified' THEN
    UPDATE public.provider_webhook_events
       SET business_id = v_payment.business_id, result = 'already_verified',
           processed_at = now(), provider_payload = v_payload
     WHERE provider = 'daraja' AND event_id = v_event_id;
    RETURN true;
  END IF;

  IF v_payment.provider_merchant_request_id IS NOT NULL
     AND p_merchant_request_id IS DISTINCT FROM v_payment.provider_merchant_request_id THEN
    UPDATE public.payments
       SET reconciliation_status = 'needs_review'
     WHERE id = v_payment.id;
    UPDATE public.provider_webhook_events
       SET business_id = v_payment.business_id, result = 'merchant_request_mismatch',
           processed_at = now(), provider_payload = v_payload
     WHERE provider = 'daraja' AND event_id = v_event_id;
    RETURN false;
  END IF;

  IF p_result_code = 0 THEN
    v_normalized_phone := regexp_replace(trim(COALESCE(p_phone, '')), '[^0-9]', '', 'g');
    IF left(v_normalized_phone, 1) = '0' THEN
      v_normalized_phone := '254' || substr(v_normalized_phone, 2);
    ELSIF length(v_normalized_phone) = 9 THEN
      v_normalized_phone := '254' || v_normalized_phone;
    END IF;

    IF NULLIF(trim(COALESCE(p_receipt, '')), '') IS NULL
       OR p_paid_amount IS NULL
       OR round(p_paid_amount, 2) <> round(v_payment.amount, 2)
       OR v_normalized_phone IS DISTINCT FROM v_payment.provider_phone THEN
      UPDATE public.payments
         SET reconciliation_status = 'needs_review'
       WHERE id = v_payment.id;
      UPDATE public.provider_webhook_events
         SET business_id = v_payment.business_id, result = 'payment_mismatch',
             processed_at = now(), provider_payload = v_payload
       WHERE provider = 'daraja' AND event_id = v_event_id;
      RETURN false;
    END IF;

    UPDATE public.payments
       SET status = 'verified',
           provider_transaction_id = trim(p_receipt),
           mpesa_ref_code = trim(p_receipt),
           reference_code = trim(p_receipt),
           verified_at = now(),
           reconciliation_status = 'matched'
     WHERE id = v_payment.id;
    UPDATE public.transactions AS t
       SET status = 'verified'
     WHERE t.id = v_payment.transaction_id
       AND t.business_id = v_payment.business_id
       AND NOT EXISTS (
         SELECT 1 FROM public.payments AS p
          WHERE p.transaction_id = t.id
            AND p.business_id = t.business_id
            AND p.status NOT IN ('verified', 'voided')
       );
    UPDATE public.provider_webhook_events
       SET business_id = v_payment.business_id, result = 'verified',
           processed_at = now(), provider_payload = v_payload
     WHERE provider = 'daraja' AND event_id = v_event_id;
  ELSE
    UPDATE public.payments
       SET reconciliation_status = 'needs_review',
           reference_code = left(COALESCE(p_result_description, 'Payment not completed'), 180)
     WHERE id = v_payment.id;
    UPDATE public.provider_webhook_events
       SET business_id = v_payment.business_id, result = 'not_completed',
           processed_at = now(), provider_payload = v_payload
     WHERE provider = 'daraja' AND event_id = v_event_id;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_business_daraja_stk_result(text, text, integer, text, text, numeric, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_business_daraja_stk_result(text, text, integer, text, text, numeric, text, jsonb)
  TO service_role;
