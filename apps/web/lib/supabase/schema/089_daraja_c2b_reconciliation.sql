-- Ingest Daraja C2B confirmations into a review queue and allow authorized
-- owners/admins to reconcile a captured receipt to a matching pending sale.
CREATE OR REPLACE FUNCTION public.record_business_daraja_c2b_payment(
  p_shortcode text,p_receipt text,p_amount numeric,p_phone text,p_bill_reference text,p_transaction_time text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_business_id uuid; v_event_id text; v_phone text; v_shortcode_matches integer;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(COALESCE(p_shortcode,'')),'') IS NULL OR NULLIF(trim(COALESCE(p_receipt,'')),'') IS NULL
     OR p_amount IS NULL OR p_amount<=0 OR length(p_receipt)>64 THEN RAISE EXCEPTION 'Invalid C2B payment details'; END IF;
  v_event_id:='c2b:'||trim(p_receipt);
  INSERT INTO public.provider_webhook_events(provider,event_id,result)
  VALUES('daraja',v_event_id,'received') ON CONFLICT(provider,event_id) DO NOTHING;
  IF NOT FOUND THEN RETURN true; END IF;

  SELECT count(*)::integer INTO v_shortcode_matches FROM public.business_payment_provider_settings
    WHERE provider='daraja' AND is_active=true AND trim(business_shortcode)=trim(p_shortcode)
  ;
  IF v_shortcode_matches<>1 THEN
    UPDATE public.provider_webhook_events SET result=CASE WHEN v_shortcode_matches=0 THEN 'unknown_shortcode' ELSE 'ambiguous_shortcode' END,processed_at=now()
      WHERE provider='daraja' AND event_id=v_event_id;
    RETURN false;
  END IF;
  SELECT business_id INTO v_business_id FROM public.business_payment_provider_settings
    WHERE provider='daraja' AND is_active=true AND trim(business_shortcode)=trim(p_shortcode) LIMIT 1;
  v_phone:=regexp_replace(trim(COALESCE(p_phone,'')),'[^0-9]','','g');
  IF length(v_phone)<9 OR length(v_phone)>15 THEN v_phone:=NULL; END IF;
  INSERT INTO public.unmatched_provider_payments(
    business_id,provider,provider_transaction_id,reference_code,phone,amount,currency,status,raw_reference
  ) VALUES (
    v_business_id,'daraja',trim(p_receipt),NULLIF(trim(COALESCE(p_bill_reference,'')),''),v_phone,p_amount,'KES','unmatched',
    left(COALESCE(p_transaction_time,''),32)
  ) ON CONFLICT(business_id,provider,provider_transaction_id) DO NOTHING;
  UPDATE public.provider_webhook_events SET business_id=v_business_id,result='received_for_reconciliation',processed_at=now()
    WHERE provider='daraja' AND event_id=v_event_id;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.owner_reconcile_daraja_c2b_payment(
  p_unmatched_payment_id uuid,p_payment_id uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_business_id uuid:=public.get_my_business_id(); v_actor uuid:=auth.uid();
  v_external public.unmatched_provider_payments%ROWTYPE; v_payment public.payments%ROWTYPE; v_branch uuid;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL OR public.get_my_global_role() NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Only an authorized owner or admin can reconcile a provider payment' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_external FROM public.unmatched_provider_payments
    WHERE id=p_unmatched_payment_id AND business_id=v_business_id FOR UPDATE;
  IF NOT FOUND OR v_external.status<>'unmatched' OR v_external.provider<>'daraja' THEN RAISE EXCEPTION 'Provider payment is no longer unmatched'; END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id=p_payment_id AND business_id=v_business_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status<>'pending_verify'
     OR v_payment.payment_method<>'mpesa_manual'
     OR round(v_payment.amount,2)<>round(v_external.amount,2) THEN
    RAISE EXCEPTION 'Choose an unsettled mobile payment with the exact same amount';
  END IF;
  SELECT branch_id INTO v_branch FROM public.transactions WHERE id=v_payment.transaction_id AND business_id=v_business_id;
  IF v_branch IS NULL OR (public.get_my_global_role()<>'owner' AND
      public.branch_role_rank(public.get_effective_branch_role(v_actor,v_branch))<public.branch_role_rank('admin')) THEN
    RAISE EXCEPTION 'You are not assigned as administrator for this payment branch' USING ERRCODE='42501';
  END IF;
  UPDATE public.payments SET status='verified',provider='daraja',provider_transaction_id=v_external.provider_transaction_id,
    mpesa_ref_code=v_external.provider_transaction_id,reference_code=v_external.provider_transaction_id,
    provider_phone=COALESCE(v_external.phone,provider_phone),verified_by=v_actor,verified_at=now(),reconciliation_status='matched'
    WHERE id=v_payment.id;
  UPDATE public.transactions t SET status='verified'
    WHERE t.id=v_payment.transaction_id AND t.business_id=v_business_id
      AND NOT EXISTS(SELECT 1 FROM public.payments p WHERE p.transaction_id=t.id AND p.business_id=t.business_id AND p.status NOT IN ('verified','voided'));
  UPDATE public.unmatched_provider_payments SET status='matched',matched_transaction_id=v_payment.transaction_id,
    matched_payment_id=v_payment.id,matched_by=v_actor,matched_at=now() WHERE id=v_external.id;
  INSERT INTO public.audit_logs(business_id,actor_id,entity_type,entity_id,action,new_value)
    VALUES(v_business_id,v_actor,'provider_payment',v_external.id,'daraja_c2b_reconciled',
      jsonb_build_object('receipt',v_external.provider_transaction_id,'amount',v_external.amount,'payment_id',v_payment.id,'transaction_id',v_payment.transaction_id));
  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.record_business_daraja_c2b_payment(text,text,numeric,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_business_daraja_c2b_payment(text,text,numeric,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.owner_reconcile_daraja_c2b_payment(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_reconcile_daraja_c2b_payment(uuid,uuid) TO authenticated;
