-- Add merchant Daraja STK tracking without changing existing sale finalizers.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider_phone text,
  ADD COLUMN IF NOT EXISTS provider_merchant_request_id text,
  ADD COLUMN IF NOT EXISTS provider_checkout_started_at timestamptz;

CREATE OR REPLACE FUNCTION public.start_business_daraja_stk_checkout(p_payment_id uuid,p_phone text)
RETURNS TABLE(business_id uuid,owner_id uuid,transaction_id uuid,amount numeric,phone text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_actor uuid:=auth.uid(); v_business uuid:=public.get_my_business_id(); v_role text;
  v_payment public.payments%ROWTYPE; v_branch uuid; v_phone text; v_owner uuid;
BEGIN
  IF v_actor IS NULL OR v_business IS NULL THEN RAISE EXCEPTION 'Sign in to start an online payment' USING ERRCODE='42501'; END IF;
  v_phone:=regexp_replace(trim(COALESCE(p_phone,'')),'[^0-9]','','g');
  IF left(v_phone,1)='0' THEN v_phone:='254'||substr(v_phone,2); ELSIF length(v_phone)=9 THEN v_phone:='254'||v_phone; END IF;
  IF v_phone !~ '^254[17][0-9]{8}$' THEN RAISE EXCEPTION 'Enter a valid Kenyan mobile number'; END IF;
  SELECT p.* INTO v_payment FROM public.payments p
    JOIN public.transactions t ON t.id=p.transaction_id AND t.business_id=p.business_id
   WHERE p.id=p_payment_id AND p.business_id=v_business FOR UPDATE OF p,t;
  IF NOT FOUND OR v_payment.payment_method NOT IN ('mpesa_manual','mpesa_stk') OR v_payment.amount<=0 OR v_payment.status<>'pending_verify' THEN
    RAISE EXCEPTION 'This sale is not waiting for a Daraja payment';
  END IF;
  SELECT t.branch_id INTO v_branch FROM public.transactions t WHERE t.id=v_payment.transaction_id AND t.business_id=v_business;
  v_role:=public.get_my_global_role();
  IF v_role<>'owner' AND public.branch_role_rank(public.get_effective_branch_role(v_actor,v_branch))<public.branch_role_rank('employee') THEN
    RAISE EXCEPTION 'You are not assigned to this store' USING ERRCODE='42501';
  END IF;
  IF v_payment.provider_checkout_started_at IS NOT NULL THEN RAISE EXCEPTION 'A payment prompt was already submitted for this sale; wait for its result before trying again'; END IF;
  SELECT u.id INTO v_owner FROM public.users u WHERE u.business_id=v_business AND u.global_role='owner' AND u.is_active=true AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Active business owner is unavailable'; END IF;
  UPDATE public.payments SET payment_method='mpesa_stk',provider='daraja',provider_phone=v_phone,
    provider_checkout_started_at=now(),mpesa_ref_code=NULL,reference_code=NULL,reconciliation_status='needs_review'
   WHERE id=v_payment.id;
  UPDATE public.transactions SET status='pending_verify' WHERE id=v_payment.transaction_id;
  RETURN QUERY SELECT v_business,v_owner,v_payment.transaction_id,v_payment.amount,v_phone;
END; $$;

CREATE OR REPLACE FUNCTION public.record_business_daraja_stk_result(
  p_checkout_request_id text,p_merchant_request_id text,p_result_code integer,p_result_description text,
  p_receipt text,p_paid_amount numeric,p_phone text,p_raw_payload jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_payment public.payments%ROWTYPE; v_normalized_phone text; v_event_id text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF length(trim(COALESCE(p_checkout_request_id,'')))=0 OR length(p_checkout_request_id)>128 THEN RAISE EXCEPTION 'Invalid checkout reference'; END IF;
  v_event_id:='stk:'||p_checkout_request_id||':'||COALESCE(p_result_code,-1)::text;
  INSERT INTO public.provider_webhook_events(provider,event_id,result)
  VALUES('daraja',v_event_id,'received') ON CONFLICT(provider,event_id) DO NOTHING;
  IF NOT FOUND THEN RETURN true; END IF;
  SELECT * INTO v_payment FROM public.payments WHERE provider='daraja' AND mpesa_checkout_id=p_checkout_request_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.provider_webhook_events SET result='unmatched',processed_at=now() WHERE provider='daraja' AND event_id=v_event_id;
    RETURN false;
  END IF;
  IF v_payment.status='verified' THEN
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,result='already_verified',processed_at=now() WHERE provider='daraja' AND event_id=v_event_id;
    RETURN true;
  END IF;
  IF v_payment.provider_merchant_request_id IS NOT NULL AND p_merchant_request_id IS DISTINCT FROM v_payment.provider_merchant_request_id THEN
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,result='merchant_mismatch',processed_at=now() WHERE provider='daraja' AND event_id=v_event_id;
    RAISE EXCEPTION 'Merchant request mismatch';
  END IF;
  IF p_result_code=0 THEN
    v_normalized_phone:=regexp_replace(trim(COALESCE(p_phone,'')),'[^0-9]','','g');
    IF left(v_normalized_phone,1)='0' THEN v_normalized_phone:='254'||substr(v_normalized_phone,2); ELSIF length(v_normalized_phone)=9 THEN v_normalized_phone:='254'||v_normalized_phone; END IF;
    IF NULLIF(trim(COALESCE(p_receipt,'')),'') IS NULL OR p_paid_amount IS NULL OR round(p_paid_amount,2)<>round(v_payment.amount,2) OR v_normalized_phone IS DISTINCT FROM v_payment.provider_phone THEN
      UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,result='payment_mismatch',processed_at=now() WHERE provider='daraja' AND event_id=v_event_id;
      RAISE EXCEPTION 'Provider payment details do not match the sale';
    END IF;
    UPDATE public.payments SET status='verified',provider_transaction_id=trim(p_receipt),mpesa_ref_code=trim(p_receipt),reference_code=trim(p_receipt),
      verified_at=now(),reconciliation_status='matched' WHERE id=v_payment.id;
    UPDATE public.transactions t SET status='verified'
     WHERE t.id=v_payment.transaction_id AND t.business_id=v_payment.business_id
       AND NOT EXISTS(SELECT 1 FROM public.payments p WHERE p.transaction_id=t.id AND p.business_id=t.business_id AND p.status NOT IN ('verified','voided'))
       AND (SELECT COALESCE(sum(p.amount),0) FROM public.payments p WHERE p.transaction_id=t.id AND p.business_id=t.business_id AND p.status='verified')>=t.total_amount;
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,result='verified',processed_at=now() WHERE provider='daraja' AND event_id=v_event_id;
  ELSE
    UPDATE public.payments SET reconciliation_status='needs_review',reference_code=left(COALESCE(p_result_description,'Payment not completed'),180)
     WHERE id=v_payment.id;
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,result='not_completed',processed_at=now() WHERE provider='daraja' AND event_id=v_event_id;
  END IF;
  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.start_business_daraja_stk_checkout(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_business_daraja_stk_checkout(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_business_daraja_stk_result(text,text,integer,text,text,numeric,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_business_daraja_stk_result(text,text,integer,text,text,numeric,text,jsonb) TO service_role;
