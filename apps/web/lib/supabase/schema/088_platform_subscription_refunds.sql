ALTER TABLE public.platform_subscription_refunds
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.platform_request_subscription_refund(
  p_payment_request_id uuid,p_amount numeric,p_reason text,p_platform_user_id uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_payment public.subscription_payment_requests%ROWTYPE; v_reserved numeric(10,2); v_refund_id uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.platform_users WHERE id=p_platform_user_id AND role='developer' AND is_active=true) THEN
    RAISE EXCEPTION 'Only an active platform developer can request a subscription refund' USING ERRCODE='42501';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 OR length(trim(COALESCE(p_reason,'')))<10 THEN RAISE EXCEPTION 'Enter a refund amount and a reason of at least 10 characters'; END IF;
  SELECT * INTO v_payment FROM public.subscription_payment_requests WHERE id=p_payment_request_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status<>'verified' THEN RAISE EXCEPTION 'Only a verified subscription payment can be refunded'; END IF;
  SELECT COALESCE(sum(amount),0) INTO v_reserved FROM public.platform_subscription_refunds
    WHERE payment_request_id=p_payment_request_id AND status IN ('requested','approved','processing','refunded');
  IF round(v_reserved+p_amount,2)>round(v_payment.amount,2) THEN RAISE EXCEPTION 'Refund exceeds the unrefunded subscription payment amount'; END IF;
  INSERT INTO public.platform_subscription_refunds(payment_request_id,business_id,amount,status,reason,platform_user_id)
  VALUES(v_payment.id,v_payment.business_id,p_amount,'requested',trim(p_reason),p_platform_user_id) RETURNING id INTO v_refund_id;
  INSERT INTO public.platform_audit_logs(platform_user_id,entity_type,entity_id,action,new_value)
  VALUES(p_platform_user_id,'subscription_refund',v_refund_id,'requested',jsonb_build_object('payment_request_id',v_payment.id,'business_id',v_payment.business_id,'amount',p_amount,'reason',trim(p_reason)));
  RETURN v_refund_id;
END; $$;

CREATE OR REPLACE FUNCTION public.platform_review_subscription_refund(
  p_refund_id uuid,p_approved boolean,p_note text,p_platform_user_id uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_refund public.platform_subscription_refunds%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.platform_users WHERE id=p_platform_user_id AND role='developer' AND is_active=true) THEN
    RAISE EXCEPTION 'Only an active platform developer can review a subscription refund' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_refund FROM public.platform_subscription_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_refund.status<>'requested' THEN RETURN false; END IF;
  UPDATE public.platform_subscription_refunds SET status=CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
    reviewed_by=p_platform_user_id,reviewed_at=now() WHERE id=v_refund.id;
  INSERT INTO public.platform_audit_logs(platform_user_id,entity_type,entity_id,action,old_value,new_value)
  VALUES(p_platform_user_id,'subscription_refund',v_refund.id,CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
    jsonb_build_object('status',v_refund.status),jsonb_build_object('note',NULLIF(trim(COALESCE(p_note,'')),'')));
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.platform_record_subscription_refund(
  p_refund_id uuid,p_provider_reference text,p_platform_user_id uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_refund public.platform_subscription_refunds%ROWTYPE; v_reference text:=trim(COALESCE(p_provider_reference,''));
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.platform_users WHERE id=p_platform_user_id AND role='developer' AND is_active=true) THEN
    RAISE EXCEPTION 'Only an active platform developer can record a completed refund' USING ERRCODE='42501';
  END IF;
  IF length(v_reference)<3 THEN RAISE EXCEPTION 'Enter the payment provider refund reference'; END IF;
  SELECT * INTO v_refund FROM public.platform_subscription_refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_refund.status<>'approved' THEN RETURN false; END IF;
  UPDATE public.platform_subscription_refunds SET status='refunded',provider_refund_id=v_reference,reviewed_by=p_platform_user_id,reviewed_at=now() WHERE id=v_refund.id;
  INSERT INTO public.platform_audit_logs(platform_user_id,entity_type,entity_id,action,old_value,new_value)
  VALUES(p_platform_user_id,'subscription_refund',v_refund.id,'recorded_completed',jsonb_build_object('status',v_refund.status),jsonb_build_object('provider_reference',v_reference,'amount',v_refund.amount));
  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.platform_request_subscription_refund(uuid,numeric,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.platform_review_subscription_refund(uuid,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.platform_record_subscription_refund(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_request_subscription_refund(uuid,numeric,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_review_subscription_refund(uuid,boolean,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_record_subscription_refund(uuid,text,uuid) TO service_role;
