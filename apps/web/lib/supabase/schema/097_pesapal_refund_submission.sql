-- Record provider refund submissions separately from refunds that have actually
-- reached the customer. Pesapal acceptance is not proof that funds were sent.
ALTER TABLE public.payment_refund_requests
  ADD COLUMN IF NOT EXISTS provider_submission_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_submission_message text;
ALTER TABLE public.platform_subscription_refunds
  ADD COLUMN IF NOT EXISTS provider_submission_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_submission_message text;

CREATE OR REPLACE FUNCTION public.request_payment_refund(p_payment_id uuid,p_amount numeric,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_business_id uuid:=public.get_my_business_id(); v_actor uuid:=auth.uid(); v_payment public.payments%ROWTYPE;
  v_reserved numeric(12,2); v_request_id uuid; v_prior integer;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL OR public.get_my_global_role() NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF p_amount IS NULL OR p_amount<=0 OR length(trim(COALESCE(p_reason,'')))<5 THEN RAISE EXCEPTION 'Enter a refund amount and reason'; END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id=p_payment_id AND business_id=v_business_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status<>'verified' THEN RAISE EXCEPTION 'Only verified captured payments can be refunded'; END IF;
  IF public.get_my_global_role()<>'owner' AND public.branch_role_rank(public.get_effective_branch_role(v_actor,
       (SELECT branch_id FROM public.transactions WHERE id=v_payment.transaction_id)))<public.branch_role_rank('admin') THEN
    RAISE EXCEPTION 'You are not assigned as administrator for this payment branch' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(sum(amount),0),count(*) FILTER(WHERE status IN ('requested','approved','processing','refunded'))
    INTO v_reserved,v_prior FROM public.payment_refund_requests WHERE payment_id=p_payment_id;
  IF round(v_reserved+p_amount,2)>round(v_payment.amount,2) THEN RAISE EXCEPTION 'Refund exceeds the remaining captured amount'; END IF;
  IF v_payment.provider='pesapal' THEN
    IF v_payment.payment_method NOT IN ('card','mpesa_stk') THEN RAISE EXCEPTION 'Pesapal refunds are not enabled for this payment method'; END IF;
    IF v_prior>0 THEN RAISE EXCEPTION 'Pesapal allows one refund request per captured payment'; END IF;
    IF v_payment.payment_method='mpesa_stk' AND round(p_amount,2)<>round(v_payment.amount-v_payment.refunded_amount,2) THEN
      RAISE EXCEPTION 'Pesapal mobile refunds must refund the full remaining captured amount';
    END IF;
  END IF;
  INSERT INTO public.payment_refund_requests(business_id,transaction_id,payment_id,requested_by,amount,reason)
    VALUES(v_business_id,v_payment.transaction_id,p_payment_id,v_actor,p_amount,trim(p_reason)) RETURNING id INTO v_request_id;
  INSERT INTO public.audit_logs(business_id,actor_id,entity_type,entity_id,action,new_value)
    VALUES(v_business_id,v_actor,'payment_refund',v_request_id,'requested',jsonb_build_object('payment_id',p_payment_id,'amount',p_amount,'reason',trim(p_reason)));
  RETURN v_request_id;
END; $$;

CREATE OR REPLACE FUNCTION public.record_manual_payment_refund(p_refund_request_id uuid,p_reference text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor uuid:=auth.uid(); v_business_id uuid:=public.get_my_business_id(); v_request public.payment_refund_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL OR public.get_my_global_role()<>'owner' THEN RAISE EXCEPTION 'Only the owner can record a completed manual refund' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_request FROM public.payment_refund_requests WHERE id=p_refund_request_id AND business_id=v_business_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('approved','processing') THEN RAISE EXCEPTION 'Only an approved or submitted refund can be recorded as completed'; END IF;
  UPDATE public.payments SET refunded_amount=refunded_amount+v_request.amount
    WHERE id=v_request.payment_id AND business_id=v_business_id AND refunded_amount+v_request.amount<=amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund exceeds the remaining captured payment'; END IF;
  UPDATE public.payment_refund_requests SET status='refunded',provider_refund_id=NULLIF(trim(COALESCE(p_reference,'')),''),updated_at=now()
    WHERE id=v_request.id;
  INSERT INTO public.audit_logs(business_id,actor_id,entity_type,entity_id,action,new_value)
    VALUES(v_business_id,v_actor,'payment_refund',v_request.id,'refund_completion_recorded',
      jsonb_build_object('payment_id',v_request.payment_id,'amount',v_request.amount,'reference',p_reference,'previous_status',v_request.status));
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.platform_request_subscription_refund(
  p_payment_request_id uuid,p_amount numeric,p_reason text,p_platform_user_id uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_payment public.subscription_payment_requests%ROWTYPE; v_reserved numeric(10,2); v_refund_id uuid; v_prior integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.platform_users WHERE id=p_platform_user_id AND role='developer' AND is_active=true) THEN
    RAISE EXCEPTION 'Only an active platform developer can request a subscription refund' USING ERRCODE='42501'; END IF;
  IF p_amount IS NULL OR p_amount<=0 OR length(trim(COALESCE(p_reason,'')))<10 THEN RAISE EXCEPTION 'Enter a refund amount and a reason of at least 10 characters'; END IF;
  SELECT * INTO v_payment FROM public.subscription_payment_requests WHERE id=p_payment_request_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status<>'verified' THEN RAISE EXCEPTION 'Only a verified subscription payment can be refunded'; END IF;
  SELECT COALESCE(sum(amount),0),count(*) FILTER(WHERE status IN ('requested','approved','processing','refunded'))
    INTO v_reserved,v_prior FROM public.platform_subscription_refunds WHERE payment_request_id=p_payment_request_id;
  IF round(v_reserved+p_amount,2)>round(v_payment.amount,2) THEN RAISE EXCEPTION 'Refund exceeds the unrefunded subscription payment amount'; END IF;
  IF v_payment.provider='pesapal' THEN
    IF v_prior>0 THEN RAISE EXCEPTION 'Pesapal allows one refund request per captured payment'; END IF;
    IF round(p_amount,2)<>round(v_payment.amount,2) THEN RAISE EXCEPTION 'Platform Pesapal subscription refunds must refund the full captured amount'; END IF;
    IF NULLIF(trim(COALESCE(v_payment.provider_receipt_number,'')),'') IS NULL THEN RAISE EXCEPTION 'Pesapal confirmation code is unavailable for refund processing'; END IF;
  END IF;
  INSERT INTO public.platform_subscription_refunds(payment_request_id,business_id,amount,status,reason,platform_user_id)
    VALUES(v_payment.id,v_payment.business_id,p_amount,'requested',trim(p_reason),p_platform_user_id) RETURNING id INTO v_refund_id;
  INSERT INTO public.platform_audit_logs(platform_user_id,entity_type,entity_id,action,new_value)
    VALUES(p_platform_user_id,'subscription_refund',v_refund_id,'requested',jsonb_build_object('payment_request_id',v_payment.id,'business_id',v_payment.business_id,'amount',p_amount,'reason',trim(p_reason)));
  RETURN v_refund_id;
END; $$;

CREATE OR REPLACE FUNCTION public.platform_record_subscription_refund(p_refund_id uuid,p_provider_reference text,p_platform_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_refund public.platform_subscription_refunds%ROWTYPE; v_reference text:=trim(COALESCE(p_provider_reference,''));
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.platform_users WHERE id=p_platform_user_id AND role='developer' AND is_active=true) THEN
    RAISE EXCEPTION 'Only an active platform developer can record a completed refund' USING ERRCODE='42501'; END IF;
  IF length(v_reference)<3 THEN RAISE EXCEPTION 'Enter the payment provider refund reference'; END IF;
  SELECT * INTO v_refund FROM public.platform_subscription_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_refund.status NOT IN ('approved','processing') THEN RETURN false; END IF;
  UPDATE public.platform_subscription_refunds SET status='refunded',provider_refund_id=v_reference,reviewed_by=p_platform_user_id,reviewed_at=now() WHERE id=v_refund.id;
  INSERT INTO public.platform_audit_logs(platform_user_id,entity_type,entity_id,action,old_value,new_value)
    VALUES(p_platform_user_id,'subscription_refund',v_refund.id,'recorded_completed',jsonb_build_object('status',v_refund.status),jsonb_build_object('provider_reference',v_reference,'amount',v_refund.amount));
  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.request_payment_refund(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_payment_refund(uuid,numeric,text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_manual_payment_refund(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_manual_payment_refund(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_request_subscription_refund(uuid,numeric,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.platform_record_subscription_refund(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_request_subscription_refund(uuid,numeric,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_record_subscription_refund(uuid,text,uuid) TO service_role;
