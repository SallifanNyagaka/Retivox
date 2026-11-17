-- Provider callback is the only path allowed to verify an STK payment.
CREATE OR REPLACE FUNCTION public.record_business_daraja_stk_result(
  p_checkout_request_id text,p_merchant_request_id text,p_result_code integer,p_result_description text,
  p_receipt text,p_paid_amount numeric,p_phone text,p_raw_payload jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_payment public.payments%ROWTYPE; v_normalized_phone text; v_event_id text; v_old_result text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF length(trim(COALESCE(p_checkout_request_id,'')))=0 OR length(p_checkout_request_id)>128 THEN RAISE EXCEPTION 'Invalid checkout reference'; END IF;
  v_event_id:='stk:'||p_checkout_request_id||':'||COALESCE(p_result_code,-1)::text;
  INSERT INTO public.provider_webhook_events(provider,event_id,result) VALUES('daraja',v_event_id,'received') ON CONFLICT(provider,event_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT result INTO v_old_result FROM public.provider_webhook_events WHERE provider='daraja' AND event_id=v_event_id;
    IF v_old_result IS DISTINCT FROM 'unmatched' THEN RETURN true; END IF;
    UPDATE public.provider_webhook_events SET result='retrying_unmatched',processed_at=NULL WHERE provider='daraja' AND event_id=v_event_id;
  END IF;
  SELECT * INTO v_payment FROM public.payments WHERE provider='daraja' AND mpesa_checkout_id=p_checkout_request_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.provider_webhook_events SET result='unmatched',processed_at=now() WHERE provider='daraja' AND event_id=v_event_id;
    RETURN false;
  END IF;
  IF v_payment.payment_method<>'mpesa_stk' THEN RAISE EXCEPTION 'Checkout is not an M-Pesa STK payment'; END IF;
  IF v_payment.status='verified' THEN
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,result='already_verified',processed_at=now() WHERE provider='daraja' AND event_id=v_event_id;
    RETURN true;
  END IF;
  IF v_payment.provider_merchant_request_id IS NOT NULL AND p_merchant_request_id IS DISTINCT FROM v_payment.provider_merchant_request_id THEN RAISE EXCEPTION 'Merchant request mismatch'; END IF;
  IF p_result_code=0 THEN
    v_normalized_phone:=regexp_replace(trim(COALESCE(p_phone,'')),'[^0-9]','','g');
    IF left(v_normalized_phone,1)='0' THEN v_normalized_phone:='254'||substr(v_normalized_phone,2); ELSIF length(v_normalized_phone)=9 THEN v_normalized_phone:='254'||v_normalized_phone; END IF;
    IF NULLIF(trim(COALESCE(p_receipt,'')),'') IS NULL OR p_paid_amount IS NULL OR round(p_paid_amount,2)<>round(v_payment.amount,2) OR v_normalized_phone IS DISTINCT FROM v_payment.provider_phone THEN
      UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,result='payment_mismatch',processed_at=now() WHERE provider='daraja' AND event_id=v_event_id;
      RAISE EXCEPTION 'Provider payment details do not match the sale';
    END IF;
    UPDATE public.payments SET status='verified',provider_transaction_id=trim(p_receipt),mpesa_ref_code=trim(p_receipt),reference_code=trim(p_receipt),verified_at=now(),reconciliation_status='matched' WHERE id=v_payment.id;
    UPDATE public.transactions t SET status='verified'
     WHERE t.id=v_payment.transaction_id AND t.business_id=v_payment.business_id
       AND NOT EXISTS(SELECT 1 FROM public.payments p WHERE p.transaction_id=t.id AND p.business_id=t.business_id AND p.status NOT IN ('verified','voided'));
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,result='verified',processed_at=now() WHERE provider='daraja' AND event_id=v_event_id;
  ELSE
    UPDATE public.payments SET reconciliation_status='needs_review',reference_code=left(COALESCE(p_result_description,'Payment not completed'),180) WHERE id=v_payment.id;
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,result='not_completed',processed_at=now() WHERE provider='daraja' AND event_id=v_event_id;
  END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.prevent_manual_stk_payment_verification()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.payment_method='mpesa_stk' AND NEW.status='verified' AND auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'M-Pesa STK payments can only be verified by the provider callback';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS payments_stk_provider_verification_only ON public.payments;
CREATE TRIGGER payments_stk_provider_verification_only
BEFORE UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION public.prevent_manual_stk_payment_verification();
REVOKE ALL ON FUNCTION public.prevent_manual_stk_payment_verification() FROM PUBLIC,anon,authenticated;
