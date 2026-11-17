-- Multi-tender sales and auditable payment reconciliation/refund requests.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_transaction_id text,
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'unmatched'
    CHECK (reconciliation_status IN ('unmatched','matched','needs_review','reversed')),
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_business_idempotency
  ON public.payments (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_transaction
  ON public.payments (business_id, provider, provider_transaction_id)
  WHERE provider IS NOT NULL AND provider_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.unmatched_provider_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_transaction_id text NOT NULL,
  reference_code text,
  phone text,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL DEFAULT 'KES',
  status text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','ignored')),
  matched_transaction_id uuid REFERENCES public.transactions(id) ON DELETE RESTRICT,
  matched_payment_id uuid REFERENCES public.payments(id) ON DELETE RESTRICT,
  matched_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  matched_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_reference text,
  UNIQUE (business_id, provider, provider_transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_unmatched_provider_payments_business_status
  ON public.unmatched_provider_payments (business_id, status, received_at DESC);
ALTER TABLE public.unmatched_provider_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY unmatched_provider_payments_owner_admin_read ON public.unmatched_provider_payments
  FOR SELECT TO authenticated
  USING (business_id = public.get_my_business_id() AND public.get_my_global_role() IN ('owner','admin'));
GRANT SELECT ON public.unmatched_provider_payments TO authenticated;

CREATE TABLE IF NOT EXISTS public.provider_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  result text NOT NULL DEFAULT 'received',
  UNIQUE (provider, event_id)
);
ALTER TABLE public.provider_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_webhook_events FROM PUBLIC, anon, authenticated;

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS split_payments_finalized_at timestamptz;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_check
  CHECK (amount > 0 OR (amount = 0 AND status = 'voided'));

CREATE OR REPLACE FUNCTION public.finalize_sale_split_payments(
  p_transaction_id uuid,
  p_payments jsonb,
  p_customer_email text DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_is_credit boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_business_id uuid := public.get_my_business_id();
  v_actor uuid := auth.uid();
  v_total numeric(12,2);
  v_branch uuid;
  v_customer uuid;
  v_paid numeric(12,2) := 0;
  v_method text;
  v_amount numeric(12,2);
  v_tendered numeric(12,2);
  v_ref text;
  v_status text;
  v_payment_id uuid;
  v_initial_payment_id uuid;
  v_count integer;
  v_row_number bigint;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(COALESCE(p_payments,'[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_payments,'[]'::jsonb)) > 8 THEN
    RAISE EXCEPTION 'Provide up to eight payment entries';
  END IF;
  SELECT total_amount, branch_id, customer_id INTO v_total, v_branch, v_customer
    FROM public.transactions WHERE id=p_transaction_id AND business_id=v_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE id=p_transaction_id AND split_payments_finalized_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Split payments have already been finalized for this sale';
  END IF;
  IF public.get_my_global_role() <> 'owner' AND public.branch_role_rank(public.get_effective_branch_role(v_actor,v_branch)) < public.branch_role_rank('employee') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT id,status INTO v_initial_payment_id,v_status FROM public.payments
   WHERE transaction_id=p_transaction_id AND business_id=v_business_id ORDER BY payment_at LIMIT 1 FOR UPDATE;
  IF v_initial_payment_id IS NULL OR (SELECT count(*) FROM public.payments WHERE transaction_id=p_transaction_id AND business_id=v_business_id) <> 1 THEN
    RAISE EXCEPTION 'The original payment ledger row is missing or has already been changed';
  END IF;
  v_count := jsonb_array_length(COALESCE(p_payments,'[]'::jsonb));
  IF v_count = 0 THEN
    UPDATE public.payments SET payment_method='cash',amount=0,status='voided',amount_tendered=0,change_given=0,
      reference_code=NULL,mpesa_ref_code=NULL,reconciliation_status='matched'
     WHERE id=v_initial_payment_id;
  END IF;
  FOR v_method, v_amount, v_tendered, v_ref, v_row_number IN
    SELECT entry->>'paymentMethod', (entry->>'amount')::numeric,
           NULLIF(entry->>'amountTendered','')::numeric, NULLIF(trim(entry->>'referenceCode'),''), entries.ordinality
      FROM jsonb_array_elements(COALESCE(p_payments,'[]'::jsonb)) WITH ORDINALITY AS entries(entry,ordinality)
  LOOP
    IF v_method NOT IN ('cash','mpesa_manual') OR v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Only cash and mobile manual payments are currently enabled for split sales';
    END IF;
    IF v_method='mpesa_manual' AND length(COALESCE(v_ref,'')) < 5 THEN RAISE EXCEPTION 'Each mobile manual payment needs a valid reference'; END IF;
    IF v_method='cash' AND COALESCE(v_tendered,v_amount) < v_amount THEN RAISE EXCEPTION 'Cash received must cover its payment amount'; END IF;
    IF v_method <> 'cash' THEN v_tendered := v_amount; END IF;
    v_paid := v_paid + v_amount;
    IF v_row_number = 1 THEN
      v_payment_id := v_initial_payment_id;
      UPDATE public.payments SET payment_method=v_method,amount=v_amount,
        status=CASE WHEN v_method='mpesa_manual' THEN 'pending_verify' ELSE COALESCE(v_status,'pending_verify') END,
        amount_tendered=v_tendered,change_given=CASE WHEN v_method='cash' THEN v_tendered-v_amount ELSE 0 END,
        reference_code=CASE WHEN v_method='cash' THEN NULL ELSE v_ref END,
        mpesa_ref_code=CASE WHEN v_method='mpesa_manual' THEN v_ref ELSE NULL END,
        reconciliation_status=CASE WHEN v_method='mpesa_manual' THEN 'needs_review' ELSE 'matched' END
       WHERE id=v_initial_payment_id;
    ELSE
      INSERT INTO public.payments (
        transaction_id,business_id,payment_method,amount,status,amount_tendered,change_given,
        reference_code,mpesa_ref_code,payment_at,reconciliation_status
      ) VALUES (
        p_transaction_id,v_business_id,v_method,v_amount,CASE WHEN v_method='mpesa_manual' THEN 'pending_verify' ELSE COALESCE(v_status,'pending_verify') END,v_tendered,
        CASE WHEN v_method='cash' THEN v_tendered-v_amount ELSE 0 END,
        CASE WHEN v_method='cash' THEN NULL ELSE v_ref END,
        CASE WHEN v_method='mpesa_manual' THEN v_ref ELSE NULL END,now(),CASE WHEN v_method='mpesa_manual' THEN 'needs_review' ELSE 'matched' END
      ) RETURNING id INTO v_payment_id;
    END IF;
    INSERT INTO public.audit_logs (business_id,actor_id,entity_type,entity_id,action,new_value)
    VALUES (v_business_id,v_actor,'payment',v_payment_id,'split_sale_payment_recorded',
      jsonb_build_object('transaction_id',p_transaction_id,'method',v_method,'amount',v_amount,'status',CASE WHEN v_method='mpesa_manual' THEN 'pending_verify' ELSE COALESCE(v_status,'pending_verify') END));
  END LOOP;
  IF v_paid > v_total THEN RAISE EXCEPTION 'Payments exceed the sale total'; END IF;
  IF NOT p_is_credit AND round(v_paid,2) <> round(v_total,2) THEN RAISE EXCEPTION 'Split payments must cover the full sale unless it is a credit sale'; END IF;
  IF p_is_credit AND (v_customer IS NULL OR p_due_date IS NULL OR p_due_date < CURRENT_DATE OR NOT EXISTS (
    SELECT 1 FROM public.customers WHERE id=v_customer AND business_id=v_business_id
      AND NULLIF(trim(name),'') IS NOT NULL AND phone ~ '^254[17][0-9]{8}$'
  )) THEN RAISE EXCEPTION 'Credit sales need customer name, phone, and a due date'; END IF;
  IF p_customer_email IS NOT NULL AND v_customer IS NOT NULL THEN
    UPDATE public.customers SET email=NULLIF(trim(p_customer_email),'') WHERE id=v_customer AND business_id=v_business_id;
  END IF;
  IF p_is_credit AND v_paid < v_total THEN
    INSERT INTO public.receivable_accounts(business_id,branch_id,transaction_id,customer_id,due_date,created_by)
    VALUES(v_business_id,v_branch,p_transaction_id,v_customer,p_due_date,v_actor)
    ON CONFLICT(transaction_id) DO UPDATE SET customer_id=EXCLUDED.customer_id,due_date=EXCLUDED.due_date;
  END IF;
  UPDATE public.transactions SET split_payments_finalized_at=now() WHERE id=p_transaction_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.employee_record_transaction_split_v1(
  p_items jsonb,p_payments jsonb,p_discount_amount numeric DEFAULT 0,p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,p_customer_email text DEFAULT NULL,p_due_date date DEFAULT NULL,p_is_credit boolean DEFAULT false
)
RETURNS TABLE(transaction_id uuid,status text,recorded_at timestamptz,total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; v_phone text; v_first_method text := 'cash';
BEGIN
  IF auth.uid() IS NULL OR public.get_my_business_id() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(COALESCE(p_payments,'[]'::jsonb))='array' AND jsonb_array_length(COALESCE(p_payments,'[]'::jsonb)) > 0 THEN
    v_first_method := COALESCE(p_payments->0->>'paymentMethod','cash');
  END IF;
  v_phone := regexp_replace(trim(COALESCE(p_customer_phone,'')), '[^0-9]', '', 'g');
  IF left(v_phone,1)='0' THEN v_phone := '254' || substr(v_phone,2); ELSIF length(v_phone)=9 THEN v_phone := '254' || v_phone; END IF;
  SELECT * INTO r FROM public.employee_record_transaction(p_items,
    CASE WHEN v_first_method='mpesa_manual' THEN 'mpesa_manual' ELSE 'cash' END,p_discount_amount,
    p_customer_name,NULLIF(v_phone,''),CASE WHEN v_first_method='mpesa_manual' THEN p_payments->0->>'referenceCode' ELSE NULL END,NULL);
  PERFORM public.finalize_sale_split_payments(r.transaction_id,p_payments,p_customer_email,p_due_date,p_is_credit);
  RETURN QUERY SELECT r.transaction_id,r.status,r.recorded_at,r.total_amount;
END; $$;

CREATE OR REPLACE FUNCTION public.dashboard_record_transaction_split_v1(
  p_branch_id uuid,p_items jsonb,p_payments jsonb,p_discount_amount numeric DEFAULT 0,p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,p_customer_email text DEFAULT NULL,p_due_date date DEFAULT NULL,p_is_credit boolean DEFAULT false
)
RETURNS TABLE(transaction_id uuid,status text,recorded_at timestamptz,total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; v_phone text; v_first_method text := 'cash';
BEGIN
  IF auth.uid() IS NULL OR public.get_my_business_id() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(COALESCE(p_payments,'[]'::jsonb))='array' AND jsonb_array_length(COALESCE(p_payments,'[]'::jsonb)) > 0 THEN
    v_first_method := COALESCE(p_payments->0->>'paymentMethod','cash');
  END IF;
  v_phone := regexp_replace(trim(COALESCE(p_customer_phone,'')), '[^0-9]', '', 'g');
  IF left(v_phone,1)='0' THEN v_phone := '254' || substr(v_phone,2); ELSIF length(v_phone)=9 THEN v_phone := '254' || v_phone; END IF;
  SELECT * INTO r FROM public.dashboard_record_transaction(p_branch_id,p_items,
    CASE WHEN v_first_method='mpesa_manual' THEN 'mpesa_manual' ELSE 'cash' END,p_discount_amount,
    p_customer_name,NULLIF(v_phone,''),CASE WHEN v_first_method='mpesa_manual' THEN p_payments->0->>'referenceCode' ELSE NULL END,NULL);
  PERFORM public.finalize_sale_split_payments(r.transaction_id,p_payments,p_customer_email,p_due_date,p_is_credit);
  RETURN QUERY SELECT r.transaction_id,r.status,r.recorded_at,r.total_amount;
END; $$;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS refunded_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_refunded_amount_valid;
ALTER TABLE public.payments ADD CONSTRAINT payments_refunded_amount_valid CHECK (refunded_amount >= 0 AND refunded_amount <= amount);

CREATE OR REPLACE FUNCTION public.request_payment_refund(
  p_payment_id uuid,
  p_amount numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_business_id uuid := public.get_my_business_id();
  v_actor uuid := auth.uid();
  v_payment public.payments%ROWTYPE;
  v_reserved numeric(12,2);
  v_request_id uuid;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL OR public.get_my_global_role() NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR length(trim(COALESCE(p_reason,''))) < 5 THEN RAISE EXCEPTION 'Enter a refund amount and reason'; END IF;
  SELECT * INTO v_payment FROM public.payments WHERE id=p_payment_id AND business_id=v_business_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status <> 'verified' THEN RAISE EXCEPTION 'Only verified captured payments can be refunded'; END IF;
  IF public.get_my_global_role() <> 'owner' AND public.branch_role_rank(public.get_effective_branch_role(v_actor,
       (SELECT branch_id FROM public.transactions WHERE id=v_payment.transaction_id))) < public.branch_role_rank('admin') THEN
    RAISE EXCEPTION 'You are not assigned as administrator for this payment branch' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(sum(amount),0) INTO v_reserved FROM public.payment_refund_requests
   WHERE payment_id=p_payment_id AND status IN ('requested','approved','processing','refunded');
  IF round(v_reserved + p_amount,2) > round(v_payment.amount,2) THEN RAISE EXCEPTION 'Refund exceeds the remaining captured amount'; END IF;
  INSERT INTO public.payment_refund_requests(business_id,transaction_id,payment_id,requested_by,amount,reason)
  VALUES(v_business_id,v_payment.transaction_id,p_payment_id,v_actor,p_amount,trim(p_reason)) RETURNING id INTO v_request_id;
  INSERT INTO public.audit_logs(business_id,actor_id,entity_type,entity_id,action,new_value)
  VALUES(v_business_id,v_actor,'payment_refund',v_request_id,'requested',jsonb_build_object('payment_id',p_payment_id,'amount',p_amount,'reason',trim(p_reason)));
  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_payment_refund_request(
  p_refund_request_id uuid,
  p_approved boolean,
  p_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
  v_request public.payment_refund_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL OR public.get_my_global_role() NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_request FROM public.payment_refund_requests WHERE id=p_refund_request_id AND business_id=v_business_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'requested' THEN RETURN false; END IF;
  IF v_request.requested_by = v_actor THEN RAISE EXCEPTION 'A refund request must be reviewed by a different authorized user'; END IF;
  UPDATE public.payment_refund_requests SET status=CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
    reviewed_by=v_actor,reviewed_at=now(),review_note=NULLIF(trim(COALESCE(p_note,'')),'') WHERE id=v_request.id;
  INSERT INTO public.audit_logs(business_id,actor_id,entity_type,entity_id,action,new_value)
  VALUES(v_business_id,v_actor,'payment_refund',v_request.id,CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
    jsonb_build_object('amount',v_request.amount,'note',p_note));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_manual_payment_refund(p_refund_request_id uuid,p_reference text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
  v_request public.payment_refund_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN RAISE EXCEPTION 'Only the owner can record a completed manual refund' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_request FROM public.payment_refund_requests WHERE id=p_refund_request_id AND business_id=v_business_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved refund can be recorded as completed'; END IF;
  UPDATE public.payments SET refunded_amount=refunded_amount+v_request.amount
   WHERE id=v_request.payment_id AND business_id=v_business_id AND refunded_amount+v_request.amount<=amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund exceeds the remaining captured payment'; END IF;
  UPDATE public.payment_refund_requests SET status='refunded',provider_refund_id=NULLIF(trim(COALESCE(p_reference,'')),''),updated_at=now() WHERE id=v_request.id;
  INSERT INTO public.audit_logs(business_id,actor_id,entity_type,entity_id,action,new_value)
  VALUES(v_business_id,v_actor,'payment_refund',v_request.id,'manual_refund_recorded',jsonb_build_object('payment_id',v_request.payment_id,'amount',v_request.amount,'reference',p_reference));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_payment_reconciliation_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status='verified' THEN NEW.reconciliation_status := 'matched';
    ELSIF NEW.status='rejected' THEN NEW.reconciliation_status := 'needs_review';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_payment_reconciliation_status ON public.payments;
CREATE TRIGGER sync_payment_reconciliation_status BEFORE UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.sync_payment_reconciliation_status();

REVOKE ALL ON FUNCTION public.request_payment_refund(uuid,numeric,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.review_payment_refund_request(uuid,boolean,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.record_manual_payment_refund(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.sync_payment_reconciliation_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_payment_refund(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_payment_refund_request(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_payment_refund(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.finalize_sale_split_payments(uuid,jsonb,text,date,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.employee_record_transaction_split_v1(jsonb,jsonb,numeric,text,text,text,date,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.dashboard_record_transaction_split_v1(uuid,jsonb,jsonb,numeric,text,text,text,date,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.employee_record_transaction_split_v1(jsonb,jsonb,numeric,text,text,text,date,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_record_transaction_split_v1(uuid,jsonb,jsonb,numeric,text,text,text,date,boolean) TO authenticated;
