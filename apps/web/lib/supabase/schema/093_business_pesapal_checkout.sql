-- Merchant-owned Pesapal hosted checkout with provider-confirmed settlement.
ALTER TABLE public.business_payment_provider_settings
  ADD COLUMN IF NOT EXISTS pesapal_ipn_id uuid;
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider_checkout_id text,
  ADD COLUMN IF NOT EXISTS provider_merchant_reference text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_business_provider_checkout
  ON public.payments(business_id,provider,provider_checkout_id)
  WHERE provider IS NOT NULL AND provider_checkout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_business_provider_merchant_ref
  ON public.payments(business_id,provider,provider_merchant_reference)
  WHERE provider IS NOT NULL AND provider_merchant_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.start_business_pesapal_checkout(
  p_payment_id uuid,p_customer_phone text,p_customer_email text
)
RETURNS TABLE(business_id uuid,owner_id uuid,transaction_id uuid,amount numeric,currency text,
              merchant_reference text,customer_phone text,customer_email text,branch_name text,ipn_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_business_id uuid:=public.get_my_business_id(); v_actor uuid:=auth.uid();
  v_role text:=public.get_my_global_role(); v_payment public.payments%ROWTYPE;
  v_branch uuid; v_currency text; v_branch_name text; v_owner uuid; v_ipn uuid; v_reference text;
  v_phone text:=NULLIF(trim(COALESCE(p_customer_phone,'')),'');
  v_email text:=NULLIF(lower(trim(COALESCE(p_customer_email,''))),'');
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL OR v_role NOT IN ('owner','admin','employee') THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF v_phone IS NULL AND v_email IS NULL THEN RAISE EXCEPTION 'Pesapal needs a customer phone number or email address'; END IF;
  SELECT * INTO v_payment FROM public.payments p WHERE p.id=p_payment_id AND p.business_id=v_business_id FOR UPDATE;
  IF NOT FOUND OR v_payment.payment_method<>'mpesa_manual' OR v_payment.status NOT IN ('pending_verify','verified')
     OR COALESCE(v_payment.reference_code,'') NOT LIKE 'PESAPAL-PENDING:%'
     OR (v_payment.provider='pesapal' AND v_payment.provider_merchant_reference IS NOT NULL) THEN
    RAISE EXCEPTION 'This sale is not an unused Pesapal checkout intent';
  END IF;
  SELECT t.branch_id,b.currency,br.name INTO v_branch,v_currency,v_branch_name
    FROM public.transactions t JOIN public.businesses b ON b.id=t.business_id
    LEFT JOIN public.branches br ON br.id=t.branch_id
    WHERE t.id=v_payment.transaction_id AND t.business_id=v_business_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Sale branch is unavailable'; END IF;
  IF v_role<>'owner' AND public.branch_role_rank(public.get_effective_branch_role(v_actor,v_branch))<public.branch_role_rank('employee') THEN
    RAISE EXCEPTION 'You are not assigned to this sale branch' USING ERRCODE='42501';
  END IF;
  IF v_role='admin' AND public.branch_role_rank(public.get_effective_branch_role(v_actor,v_branch))<public.branch_role_rank('admin') THEN
    RAISE EXCEPTION 'You are not an administrator for this sale branch' USING ERRCODE='42501';
  END IF;
  SELECT u.id INTO v_owner FROM public.users u WHERE u.business_id=v_business_id AND u.global_role='owner'
    AND u.is_active=true AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1;
  SELECT s.pesapal_ipn_id INTO v_ipn FROM public.business_payment_provider_settings s
    WHERE s.business_id=v_business_id AND s.provider='pesapal' AND s.is_active=true;
  IF v_owner IS NULL OR v_ipn IS NULL THEN RAISE EXCEPTION 'Configure Pesapal credentials and register its IPN before checkout'; END IF;
  v_reference:='RV-'||replace(gen_random_uuid()::text,'-','');
  UPDATE public.payments SET payment_method='pesapal',status='pending_verify',provider='pesapal',
    provider_phone=v_phone,provider_merchant_reference=v_reference,provider_checkout_started_at=now(),
    reference_code=NULL,mpesa_ref_code=NULL,reconciliation_status='needs_review'
    WHERE id=v_payment.id;
  UPDATE public.transactions SET status='pending_verify' WHERE id=v_payment.transaction_id AND business_id=v_business_id;
  RETURN QUERY SELECT v_business_id,v_owner,v_payment.transaction_id,v_payment.amount,v_currency,
    v_reference,v_phone,v_email,v_branch_name,v_ipn;
END; $$;

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
  ELSE
    UPDATE public.payments SET status='rejected',reconciliation_status=CASE WHEN p_status_code=3 THEN 'reversed' ELSE 'needs_review' END
      WHERE id=v_payment.id;
    UPDATE public.transactions SET status='pending_verify' WHERE id=v_payment.transaction_id AND business_id=v_payment.business_id;
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id,
      result=CASE WHEN p_status_code=3 THEN 'reversed' ELSE 'not_completed' END,processed_at=now()
      WHERE provider='pesapal' AND event_id=v_event_id;
  END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.prevent_manual_pesapal_verification()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.provider='pesapal' AND NEW.status='verified' AND auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'Pesapal payments can only be verified after a provider status check';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS payments_pesapal_provider_verification_only ON public.payments;
CREATE TRIGGER payments_pesapal_provider_verification_only BEFORE UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_manual_pesapal_verification();

REVOKE ALL ON FUNCTION public.start_business_pesapal_checkout(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_business_pesapal_checkout(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_business_pesapal_checkout_result(text,text,integer,text,numeric,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_business_pesapal_checkout_result(text,text,integer,text,numeric,text,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.prevent_manual_pesapal_verification() FROM PUBLIC,anon,authenticated;
