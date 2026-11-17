-- Recover a checkout callback that reaches Retivox before the SubmitOrder
-- response tracking ID was persisted. Provider status must still match the
-- merchant reference stored before the provider call.
CREATE OR REPLACE FUNCTION public.record_platform_pesapal_subscription_result(
  p_tracking_id text,p_merchant_reference text,p_status_code integer,p_status_description text,
  p_paid_amount numeric,p_currency text,p_confirmation_code text,p_payload jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_request public.subscription_payment_requests%ROWTYPE; v_event text; v_old_result text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(COALESCE(p_tracking_id,'')),'') IS NULL OR length(p_tracking_id)>128 OR p_status_code IS NULL THEN RAISE EXCEPTION 'Invalid Pesapal result'; END IF;
  v_event:='subscription-pesapal:'||trim(p_tracking_id)||':'||p_status_code::text;
  INSERT INTO public.provider_webhook_events(provider,event_id,result) VALUES('pesapal_platform',v_event,'received') ON CONFLICT(provider,event_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT result INTO v_old_result FROM public.provider_webhook_events WHERE provider='pesapal_platform' AND event_id=v_event;
    IF v_old_result IS DISTINCT FROM 'unmatched' THEN RETURN true; END IF;
    UPDATE public.provider_webhook_events SET result='retrying_unmatched',processed_at=NULL WHERE provider='pesapal_platform' AND event_id=v_event;
  END IF;
  SELECT * INTO v_request FROM public.subscription_payment_requests WHERE pesapal_tracking_id=trim(p_tracking_id) FOR UPDATE;
  IF NOT FOUND AND NULLIF(trim(COALESCE(p_merchant_reference,'')),'') IS NOT NULL THEN
    SELECT * INTO v_request FROM public.subscription_payment_requests WHERE pesapal_merchant_reference=trim(p_merchant_reference) FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    UPDATE public.provider_webhook_events SET result='unmatched',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event;
    RETURN false;
  END IF;
  IF v_request.pesapal_merchant_reference IS DISTINCT FROM p_merchant_reference THEN
    UPDATE public.subscription_payment_requests SET review_note='Pesapal merchant reference mismatch; manual review required',provider_result_description='Provider reference mismatch' WHERE id=v_request.id;
    UPDATE public.provider_webhook_events SET business_id=v_request.business_id,result='merchant_reference_mismatch',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event;
    RETURN false;
  END IF;
  IF v_request.pesapal_tracking_id IS NULL THEN
    UPDATE public.subscription_payment_requests SET pesapal_tracking_id=trim(p_tracking_id) WHERE id=v_request.id AND pesapal_tracking_id IS NULL;
  ELSIF v_request.pesapal_tracking_id IS DISTINCT FROM trim(p_tracking_id) THEN
    UPDATE public.provider_webhook_events SET business_id=v_request.business_id,result='tracking_id_mismatch',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event;
    RETURN false;
  END IF;
  IF p_status_code=1 AND upper(COALESCE(p_status_description,''))='COMPLETED' THEN
    IF p_paid_amount IS NULL OR round(p_paid_amount,2)<>round(v_request.amount,2)
       OR upper(COALESCE(p_currency,''))<>upper(COALESCE(v_request.currency,''))
       OR NULLIF(trim(COALESCE(p_confirmation_code,'')),'') IS NULL THEN
      UPDATE public.subscription_payment_requests SET review_note='Pesapal amount, currency, or receipt mismatch; manual review required',provider_result_description='Payment details mismatch' WHERE id=v_request.id;
      UPDATE public.provider_webhook_events SET business_id=v_request.business_id,result='payment_mismatch',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event;
      RETURN false;
    END IF;
    IF v_request.status='pending' THEN
      UPDATE public.subscription_payment_requests SET status='verified',provider='pesapal',payment_method='pesapal',provider_result_code=p_status_code,
        provider_result_description='Pesapal payment verified',provider_receipt_number=trim(p_confirmation_code),provider_paid_amount=p_paid_amount,
        paid_at=now(),raw_provider_payload=p_payload,review_note='Automatically verified with Pesapal' WHERE id=v_request.id;
      IF NOT public.platform_apply_subscription_payment(v_request.id) THEN RAISE EXCEPTION 'Subscription license could not be applied'; END IF;
    END IF;
    UPDATE public.provider_webhook_events SET business_id=v_request.business_id,result='verified',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event;
  ELSIF p_status_code=2 OR p_status_code=3 THEN
    IF v_request.status='pending' THEN
      UPDATE public.subscription_payment_requests SET status='rejected',provider_result_code=p_status_code,
        provider_result_description=left(COALESCE(p_status_description,'Pesapal payment not completed'),500),raw_provider_payload=p_payload,reviewed_at=now() WHERE id=v_request.id;
    ELSIF p_status_code=3 AND v_request.status='verified' AND v_request.license_applied_at IS NOT NULL THEN
      UPDATE public.subscriptions SET status='past_due' WHERE id=v_request.subscription_id AND business_id=v_request.business_id AND license_type<>'lifetime';
      UPDATE public.businesses SET subscription_status='past_due' WHERE id=v_request.business_id;
      UPDATE public.subscription_payment_requests SET review_note='Pesapal reversal received after license activation; access moved to grace period for platform review',
        provider_result_code=p_status_code,provider_result_description='Provider reversal received',raw_provider_payload=p_payload WHERE id=v_request.id;
    END IF;
    UPDATE public.provider_webhook_events SET business_id=v_request.business_id,result=CASE WHEN p_status_code=3 THEN 'reversed' ELSE 'not_completed' END,processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event;
  ELSE
    UPDATE public.subscription_payment_requests SET review_note='Pesapal returned an invalid or unknown status; payment remains pending',
      provider_result_code=p_status_code,provider_result_description=left(COALESCE(p_status_description,'Unrecognized Pesapal status'),500),raw_provider_payload=p_payload WHERE id=v_request.id AND status='pending';
    UPDATE public.provider_webhook_events SET business_id=v_request.business_id,result='pending_review',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event;
  END IF;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.record_platform_pesapal_subscription_result(text,text,integer,text,numeric,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_platform_pesapal_subscription_result(text,text,integer,text,numeric,text,text,jsonb) TO service_role;
