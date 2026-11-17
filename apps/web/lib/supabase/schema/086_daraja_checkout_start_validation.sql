-- Require the POS server action's short-lived intent marker before a pending
-- manual M-Pesa tender can be converted into a provider checkout.
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
  SELECT p.* INTO v_payment FROM public.payments p JOIN public.transactions t ON t.id=p.transaction_id AND t.business_id=p.business_id
   WHERE p.id=p_payment_id AND p.business_id=v_business FOR UPDATE OF p,t;
  IF NOT FOUND OR v_payment.payment_method<>'mpesa_manual' OR v_payment.amount<=0
     OR v_payment.status NOT IN ('pending_verify','verified') OR v_payment.reference_code NOT LIKE 'STK-PENDING:%' THEN
    RAISE EXCEPTION 'This sale is not an eligible, unsubmitted Daraja payment';
  END IF;
  SELECT t.branch_id INTO v_branch FROM public.transactions t WHERE t.id=v_payment.transaction_id AND t.business_id=v_business;
  v_role:=public.get_my_global_role();
  IF v_role<>'owner' AND public.branch_role_rank(public.get_effective_branch_role(v_actor,v_branch))<public.branch_role_rank('employee') THEN
    RAISE EXCEPTION 'You are not assigned to this store' USING ERRCODE='42501';
  END IF;
  IF v_payment.provider_checkout_started_at IS NOT NULL THEN RAISE EXCEPTION 'A payment prompt was already submitted for this sale; wait for its result before trying again'; END IF;
  SELECT u.id INTO v_owner FROM public.users u WHERE u.business_id=v_business AND u.global_role='owner' AND u.is_active=true AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Active business owner is unavailable'; END IF;
  UPDATE public.payments SET payment_method='mpesa_stk',status='pending_verify',provider='daraja',provider_phone=v_phone,
    provider_checkout_started_at=now(),mpesa_ref_code=NULL,reference_code=NULL,reconciliation_status='needs_review'
   WHERE id=v_payment.id;
  UPDATE public.transactions SET status='pending_verify' WHERE id=v_payment.transaction_id;
  RETURN QUERY SELECT v_business,v_owner,v_payment.transaction_id,v_payment.amount,v_phone;
END; $$;
