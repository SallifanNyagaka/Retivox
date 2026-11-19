-- Keep cash sales reference-free during dashboard offline synchronization.
CREATE OR REPLACE FUNCTION public.dashboard_record_transaction_offline_v2(
  p_branch_id uuid,p_items jsonb,p_payment_method text,p_amount_paid numeric,p_amount_tendered numeric DEFAULT NULL,
  p_discount_amount numeric DEFAULT 0,p_customer_name text DEFAULT NULL,p_customer_phone text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,p_reference_code text DEFAULT NULL,p_due_date date DEFAULT NULL,p_is_credit boolean DEFAULT false,
  p_recorded_at timestamptz DEFAULT NULL,p_local_id text DEFAULT NULL
)
RETURNS TABLE(transaction_id uuid,status text,recorded_at timestamptz,total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_actor uuid := auth.uid(); v_business_id uuid := public.get_my_business_id(); v_role text := public.get_my_global_role();
  v_fingerprint text; v_existing public.transactions%ROWTYPE; r record; v_phone text;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL OR COALESCE(v_role,'') NOT IN ('owner','admin') OR p_branch_id IS NULL OR
     (v_role <> 'owner' AND public.branch_role_rank(public.get_effective_branch_role(v_actor,p_branch_id)) < public.branch_role_rank('admin')) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';
  END IF;
  IF NULLIF(trim(COALESCE(p_local_id,'')),'') IS NULL THEN RAISE EXCEPTION 'Offline sale requires its local request ID'; END IF;
  v_fingerprint := jsonb_build_object('actor',v_actor,'branch',p_branch_id,'items',p_items,'method',p_payment_method,
    'amount_paid',p_amount_paid,'amount_tendered',p_amount_tendered,'discount',p_discount_amount,'customer_name',p_customer_name,
    'customer_phone',p_customer_phone,'customer_email',p_customer_email,'reference',p_reference_code,'due_date',p_due_date,
    'is_credit',p_is_credit,'recorded_at',p_recorded_at)::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':offline:' || p_local_id,0));
  SELECT * INTO v_existing FROM public.transactions t WHERE t.business_id=v_business_id AND t.local_id=p_local_id;
  IF FOUND THEN
    IF v_existing.employee_id IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Local sale ID belongs to another operator' USING ERRCODE='42501'; END IF;
    IF v_existing.idempotency_fingerprint IS NOT NULL AND v_existing.idempotency_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'Local sale ID was already used with different sale details';
    END IF;
    RETURN QUERY SELECT v_existing.id,v_existing.status,v_existing.recorded_at,v_existing.total_amount; RETURN;
  END IF;
  v_phone := regexp_replace(trim(COALESCE(p_customer_phone,'')), '[^0-9]', '', 'g');
  IF left(v_phone,1)='0' THEN v_phone := '254' || substr(v_phone,2); ELSIF length(v_phone)=9 THEN v_phone := '254' || v_phone; END IF;
  SELECT * INTO r FROM public.dashboard_record_transaction_offline(p_branch_id,p_items,
    CASE WHEN p_payment_method='mpesa_manual' AND NOT (p_is_credit AND COALESCE(p_amount_paid,0)=0) THEN 'mpesa_manual' ELSE 'cash' END,
    p_discount_amount,p_customer_name,NULLIF(v_phone,''),CASE WHEN p_payment_method='mpesa_manual' THEN p_reference_code ELSE NULL END,
    NULL,p_recorded_at,p_local_id);
  UPDATE public.transactions t SET idempotency_key='offline:' || p_local_id,idempotency_fingerprint=v_fingerprint
   WHERE t.id=r.transaction_id AND t.business_id=v_business_id AND t.employee_id=v_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unable to bind local request ID to the saved transaction'; END IF;
  PERFORM public.finalize_sale_payment(r.transaction_id,p_payment_method,p_amount_paid,p_amount_tendered,p_reference_code,p_customer_email,p_due_date,p_is_credit);
  RETURN QUERY SELECT r.transaction_id,r.status,r.recorded_at,r.total_amount;
END; $$;

REVOKE ALL ON FUNCTION public.dashboard_record_transaction_offline_v2(uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dashboard_record_transaction_offline_v2(uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,timestamptz,text) TO authenticated;
