-- Keep Pesapal's INVALID/unknown status pending for review; only explicit failure
-- and reversal statuses reject a checkout.
CREATE OR REPLACE FUNCTION public.record_business_pesapal_checkout_result(
  p_checkout_id text,p_merchant_reference text,p_status_code integer,p_status_description text,
  p_paid_amount numeric,p_currency text,p_confirmation_code text,p_payment_method text,p_payload jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_payment public.payments%ROWTYPE; v_business_currency text; v_event_id text; v_final_method text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(COALESCE(p_checkout_id,'')),'') IS NULL OR length(p_checkout_id)>128
     OR p_status_code IS NULL THEN RAISE EXCEPTION 'Invalid Pesapal result'; END IF;
  v_event_id:='pesapal:'||trim(p_checkout_id)||':'||p_status_code::text;
  INSERT INTO public.provider_webhook_events(provider,event_id,result) VALUES('pesapal',v_event_id,'received')
    ON CONFLICT(provider,event_id) DO NOTHING;
  IF NOT FOUND THEN RETURN true; END IF;
  SELECT * INTO v_payment FROM public.payments WHERE provider='pesapal' AND provider_checkout_id=trim(p_checkout_id) FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.provider_webhook_events SET result='unmatched',processed_at=now() WHERE provider='pesapal' AND event_id=v_event_id;
    RETURN false;
  END IF;
  IF v_payment.provider_merchant_reference IS DISTINCT FROM p_merchant_reference THEN
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,result='merchant_reference_mismatch',processed_at=now()
      WHERE provider='pesapal' AND event_id=v_event_id;
    UPDATE public.payments SET reconciliation_status='needs_review' WHERE id=v_payment.id;
    RETURN false;
  END IF;
  IF p_status_code=1 AND upper(COALESCE(p_status_description,''))='COMPLETED' THEN
    SELECT currency INTO v_business_currency FROM public.businesses WHERE id=v_payment.business_id;
    IF p_paid_amount IS NULL OR round(p_paid_amount,2)<>round(v_payment.amount,2)
       OR upper(COALESCE(p_currency,''))<>upper(COALESCE(v_business_currency,''))
       OR NULLIF(trim(COALESCE(p_confirmation_code,'')),'') IS NULL THEN
      UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,result='amount_currency_or_reference_mismatch',processed_at=now()
        WHERE provider='pesapal' AND event_id=v_event_id;
      UPDATE public.payments SET reconciliation_status='needs_review' WHERE id=v_payment.id;
      RETURN false;
    END IF;
    v_final_method:=CASE
      WHEN upper(COALESCE(p_payment_method,'')) LIKE '%CARD%' OR upper(COALESCE(p_payment_method,'')) LIKE '%VISA%' OR upper(COALESCE(p_payment_method,'')) LIKE '%MASTER%' THEN 'card'
      WHEN upper(COALESCE(p_payment_method,'')) LIKE '%MPESA%' OR upper(COALESCE(p_payment_method,'')) LIKE '%M-PESA%' THEN 'mpesa_stk'
      WHEN upper(COALESCE(p_payment_method,'')) LIKE '%BANK%' OR upper(COALESCE(p_payment_method,'')) LIKE '%TRANSFER%' THEN 'bank_transfer'
      ELSE 'pesapal' END;
    UPDATE public.payments SET payment_method=v_final_method,status='verified',provider_transaction_id=trim(p_confirmation_code),
      reference_code=trim(p_confirmation_code),verified_at=now(),reconciliation_status='matched' WHERE id=v_payment.id;
    UPDATE public.transactions t SET status='verified' WHERE t.id=v_payment.transaction_id AND t.business_id=v_payment.business_id
      AND NOT EXISTS(SELECT 1 FROM public.payments p WHERE p.transaction_id=t.id AND p.business_id=t.business_id AND p.status NOT IN ('verified','voided'));
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,result='verified',processed_at=now() WHERE provider='pesapal' AND event_id=v_event_id;
  ELSIF p_status_code=2 OR p_status_code=3 THEN
    UPDATE public.payments SET status='rejected' WHERE id=v_payment.id;
    UPDATE public.payments SET reconciliation_status=CASE WHEN p_status_code=3 THEN 'reversed' ELSE 'needs_review' END WHERE id=v_payment.id;
    UPDATE public.transactions SET status='pending_verify' WHERE id=v_payment.transaction_id AND business_id=v_payment.business_id;
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,
      result=CASE WHEN p_status_code=3 THEN 'reversed' ELSE 'not_completed' END,processed_at=now()
      WHERE provider='pesapal' AND event_id=v_event_id;
  ELSE
    -- INVALID (0) and provider-specific/unknown statuses are not proof of failure.
    UPDATE public.payments SET reconciliation_status='needs_review' WHERE id=v_payment.id;
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,result='pending_review',processed_at=now()
      WHERE provider='pesapal' AND event_id=v_event_id;
  END IF;
  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.record_business_pesapal_checkout_result(text,text,integer,text,numeric,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_business_pesapal_checkout_result(text,text,integer,text,numeric,text,text,text,jsonb) TO service_role;
