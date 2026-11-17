/*
 * Payment tender, additional manual payment methods, and credit receivables.
 * Sales continue to use the existing atomic pricing/stock RPCs; this migration
 * wraps them and adjusts the payment ledger in the same transaction.
 */

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS amount_tendered numeric(10,2),
  ADD COLUMN IF NOT EXISTS change_given numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reference_code text;

CREATE TABLE IF NOT EXISTS public.receivable_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches ON DELETE CASCADE,
  transaction_id uuid NOT NULL UNIQUE REFERENCES public.transactions ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers,
  due_date date NOT NULL,
  created_by uuid NOT NULL REFERENCES public.users,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receivable_accounts_business_due
  ON public.receivable_accounts (business_id, due_date);
CREATE INDEX IF NOT EXISTS idx_receivable_accounts_branch_due
  ON public.receivable_accounts (branch_id, due_date);
ALTER TABLE public.receivable_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Business users can read receivables" ON public.receivable_accounts;
CREATE POLICY "Business users can read receivables"
  ON public.receivable_accounts FOR SELECT TO authenticated
  USING (business_id = (SELECT public.get_my_business_id()) AND (
    public.get_my_global_role() = 'owner' OR
    public.branch_role_rank(public.get_effective_branch_role(auth.uid(), branch_id)) >= public.branch_role_rank('employee')
  ));
GRANT SELECT ON public.receivable_accounts TO authenticated;

CREATE OR REPLACE VIEW public.receivable_account_balances
WITH (security_invoker = true)
AS
SELECT ra.id, ra.business_id, ra.branch_id, ra.transaction_id, ra.customer_id,
       ra.due_date, ra.created_by, ra.created_at,
       c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
       b.name AS branch_name, t.total_amount,
       COALESCE(SUM(p.amount) FILTER (WHERE p.status NOT IN ('rejected')), 0)::numeric(10,2) AS amount_paid,
       GREATEST(t.total_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.status NOT IN ('rejected')), 0), 0)::numeric(10,2) AS balance_due,
       CASE WHEN COALESCE(SUM(p.amount) FILTER (WHERE p.status NOT IN ('rejected')), 0) >= t.total_amount THEN 'paid'
            WHEN ra.due_date < CURRENT_DATE THEN 'overdue'
            WHEN COALESCE(SUM(p.amount) FILTER (WHERE p.status NOT IN ('rejected')), 0) > 0 THEN 'partial'
            ELSE 'open' END AS account_status
  FROM public.receivable_accounts ra
  JOIN public.customers c ON c.id = ra.customer_id AND c.business_id = ra.business_id
  JOIN public.branches b ON b.id = ra.branch_id AND b.business_id = ra.business_id
  JOIN public.transactions t ON t.id = ra.transaction_id AND t.business_id = ra.business_id
  LEFT JOIN public.payments p ON p.transaction_id = ra.transaction_id AND p.business_id = ra.business_id
 GROUP BY ra.id, c.id, b.id, t.id;
GRANT SELECT ON public.receivable_account_balances TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_sale_payment(
  p_transaction_id uuid,
  p_method text,
  p_amount_paid numeric,
  p_amount_tendered numeric,
  p_reference_code text,
  p_customer_email text,
  p_due_date date,
  p_credit boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_id uuid := public.get_my_business_id();
  v_total numeric(10,2);
  v_branch_id uuid;
  v_customer_id uuid;
  v_status text;
  v_payment_id uuid;
  v_amount_paid numeric(10,2);
  v_tendered numeric(10,2);
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF p_method NOT IN ('cash','mpesa_manual','card','bank_transfer','other') THEN RAISE EXCEPTION 'Unsupported payment method'; END IF;
  SELECT total_amount, branch_id, customer_id INTO v_total, v_branch_id, v_customer_id
    FROM public.transactions WHERE id=p_transaction_id AND business_id=v_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  v_amount_paid := COALESCE(p_amount_paid, CASE WHEN NOT p_credit THEN v_total ELSE NULL END);
  v_tendered := COALESCE(p_amount_tendered, v_amount_paid);
  IF v_amount_paid IS NULL OR v_amount_paid < 0 OR v_amount_paid > v_total THEN RAISE EXCEPTION 'Amount paid must be between zero and the sale total'; END IF;
  IF NOT p_credit AND v_amount_paid <> v_total THEN RAISE EXCEPTION 'A non-credit sale must be paid in full'; END IF;
  IF p_method='cash' AND COALESCE(v_tendered,0) < v_amount_paid THEN RAISE EXCEPTION 'Cash received must cover the amount applied'; END IF;
  IF p_method='mpesa_manual' AND v_amount_paid > 0 AND length(trim(COALESCE(p_reference_code,''))) < 5 THEN RAISE EXCEPTION 'Enter a valid M-Pesa reference code'; END IF;
  IF p_credit AND (v_customer_id IS NULL OR p_due_date IS NULL) THEN RAISE EXCEPTION 'Credit sales require customer details and a due date'; END IF;
  IF p_credit AND (p_due_date < CURRENT_DATE OR NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id=v_customer_id AND c.business_id=v_business_id
      AND NULLIF(trim(c.name),'') IS NOT NULL AND c.phone ~ '^254[17][0-9]{8}$'
  )) THEN RAISE EXCEPTION 'Credit sales need a customer name, phone number, and a due date today or later'; END IF;
  IF p_customer_email IS NOT NULL AND v_customer_id IS NOT NULL THEN
    UPDATE public.customers SET email=NULLIF(trim(p_customer_email),'') WHERE id=v_customer_id AND business_id=v_business_id;
  END IF;
  SELECT id,status INTO v_payment_id,v_status FROM public.payments
   WHERE transaction_id=p_transaction_id AND business_id=v_business_id ORDER BY payment_at LIMIT 1 FOR UPDATE;
  IF v_amount_paid = 0 THEN
    IF v_payment_id IS NOT NULL THEN DELETE FROM public.payments WHERE id=v_payment_id; END IF;
  ELSIF v_payment_id IS NULL THEN
    RAISE EXCEPTION 'Sale payment ledger entry is missing';
  ELSE
    UPDATE public.payments SET payment_method=p_method, amount=v_amount_paid,
      amount_tendered=CASE WHEN p_method='cash' THEN v_tendered ELSE v_amount_paid END,
      change_given=CASE WHEN p_method='cash' THEN v_tendered-v_amount_paid ELSE 0 END,
      reference_code=CASE WHEN p_method IN ('mpesa_manual','bank_transfer','card','other') THEN NULLIF(trim(p_reference_code),'') ELSE NULL END,
      mpesa_ref_code=CASE WHEN p_method='mpesa_manual' THEN NULLIF(trim(p_reference_code),'') ELSE NULL END
     WHERE id=v_payment_id;
  END IF;
  IF p_credit AND v_amount_paid < v_total THEN
    INSERT INTO public.receivable_accounts(business_id,branch_id,transaction_id,customer_id,due_date,created_by)
    VALUES(v_business_id,v_branch_id,p_transaction_id,v_customer_id,p_due_date,auth.uid())
    ON CONFLICT(transaction_id) DO UPDATE SET customer_id=EXCLUDED.customer_id,due_date=EXCLUDED.due_date;
  ELSE
    DELETE FROM public.receivable_accounts WHERE transaction_id=p_transaction_id AND business_id=v_business_id;
  END IF;
  INSERT INTO public.audit_logs(business_id,actor_id,entity_type,entity_id,action,old_value,new_value)
  VALUES(v_business_id,auth.uid(),'transaction',p_transaction_id,
    CASE WHEN p_credit THEN 'credit_sale_payment_recorded' ELSE 'sale_payment_recorded' END,
    NULL,jsonb_build_object('payment_method',p_method,'amount_paid',v_amount_paid,
      'amount_tendered',CASE WHEN p_method='cash' THEN v_tendered ELSE NULL END,
      'change_given',CASE WHEN p_method='cash' THEN v_tendered-v_amount_paid ELSE 0 END,
      'balance_due',CASE WHEN p_credit THEN v_total-v_amount_paid ELSE 0 END,
      'due_date',CASE WHEN p_credit THEN p_due_date ELSE NULL END));
END;
$$;

CREATE OR REPLACE FUNCTION public.employee_record_transaction_v2(
  p_items jsonb,p_payment_method text,p_amount_paid numeric,p_amount_tendered numeric DEFAULT NULL,
  p_discount_amount numeric DEFAULT 0,p_customer_name text DEFAULT NULL,p_customer_phone text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,p_reference_code text DEFAULT NULL,p_due_date date DEFAULT NULL,p_is_credit boolean DEFAULT false
)
RETURNS TABLE(transaction_id uuid,status text,recorded_at timestamptz,total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; v_phone text;
BEGIN
  v_phone := regexp_replace(trim(COALESCE(p_customer_phone,'')), '[^0-9]', '', 'g');
  IF left(v_phone,1)='0' THEN v_phone := '254' || substr(v_phone,2); ELSIF length(v_phone)=9 THEN v_phone := '254' || v_phone; END IF;
  SELECT * INTO r FROM public.employee_record_transaction(p_items,
    CASE WHEN p_payment_method='mpesa_manual' AND NOT (p_is_credit AND COALESCE(p_amount_paid,0)=0) THEN 'mpesa_manual' ELSE 'cash' END,p_discount_amount,
    p_customer_name,NULLIF(v_phone,''),CASE WHEN p_payment_method='mpesa_manual' THEN p_reference_code ELSE NULL END,NULL);
  PERFORM public.finalize_sale_payment(r.transaction_id,p_payment_method,p_amount_paid,p_amount_tendered,p_reference_code,p_customer_email,p_due_date,p_is_credit);
  RETURN QUERY SELECT r.transaction_id,r.status,r.recorded_at,r.total_amount;
END; $$;

CREATE OR REPLACE FUNCTION public.dashboard_record_transaction_v2(
  p_branch_id uuid,p_items jsonb,p_payment_method text,p_amount_paid numeric,p_amount_tendered numeric DEFAULT NULL,
  p_discount_amount numeric DEFAULT 0,p_customer_name text DEFAULT NULL,p_customer_phone text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,p_reference_code text DEFAULT NULL,p_due_date date DEFAULT NULL,p_is_credit boolean DEFAULT false
)
RETURNS TABLE(transaction_id uuid,status text,recorded_at timestamptz,total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; v_phone text;
BEGIN
  v_phone := regexp_replace(trim(COALESCE(p_customer_phone,'')), '[^0-9]', '', 'g');
  IF left(v_phone,1)='0' THEN v_phone := '254' || substr(v_phone,2); ELSIF length(v_phone)=9 THEN v_phone := '254' || v_phone; END IF;
  SELECT * INTO r FROM public.dashboard_record_transaction(p_branch_id,p_items,
    CASE WHEN p_payment_method='mpesa_manual' AND NOT (p_is_credit AND COALESCE(p_amount_paid,0)=0) THEN 'mpesa_manual' ELSE 'cash' END,p_discount_amount,
    p_customer_name,NULLIF(v_phone,''),CASE WHEN p_payment_method='mpesa_manual' THEN p_reference_code ELSE NULL END,NULL);
  PERFORM public.finalize_sale_payment(r.transaction_id,p_payment_method,p_amount_paid,p_amount_tendered,p_reference_code,p_customer_email,p_due_date,p_is_credit);
  RETURN QUERY SELECT r.transaction_id,r.status,r.recorded_at,r.total_amount;
END; $$;

CREATE OR REPLACE FUNCTION public.employee_record_transaction_offline_v2(
  p_items jsonb,p_payment_method text,p_amount_paid numeric,p_amount_tendered numeric DEFAULT NULL,
  p_discount_amount numeric DEFAULT 0,p_customer_name text DEFAULT NULL,p_customer_phone text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,p_reference_code text DEFAULT NULL,p_due_date date DEFAULT NULL,p_is_credit boolean DEFAULT false,
  p_recorded_at timestamptz DEFAULT NULL,p_local_id text DEFAULT NULL
)
RETURNS TABLE(transaction_id uuid,status text,recorded_at timestamptz,total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; v_phone text;
BEGIN
  v_phone := regexp_replace(trim(COALESCE(p_customer_phone,'')), '[^0-9]', '', 'g');
  IF left(v_phone,1)='0' THEN v_phone := '254' || substr(v_phone,2); ELSIF length(v_phone)=9 THEN v_phone := '254' || v_phone; END IF;
  SELECT * INTO r FROM public.employee_record_transaction_offline(p_items,
    CASE WHEN p_payment_method='mpesa_manual' AND NOT (p_is_credit AND COALESCE(p_amount_paid,0)=0) THEN 'mpesa_manual' ELSE 'cash' END,p_discount_amount,
    p_customer_name,NULLIF(v_phone,''),CASE WHEN p_payment_method='mpesa_manual' THEN p_reference_code ELSE NULL END,NULL,p_recorded_at,p_local_id);
  PERFORM public.finalize_sale_payment(r.transaction_id,p_payment_method,p_amount_paid,p_amount_tendered,p_reference_code,p_customer_email,p_due_date,p_is_credit);
  RETURN QUERY SELECT r.transaction_id,r.status,r.recorded_at,r.total_amount;
END; $$;

CREATE OR REPLACE FUNCTION public.dashboard_record_transaction_offline_v2(
  p_branch_id uuid,p_items jsonb,p_payment_method text,p_amount_paid numeric,p_amount_tendered numeric DEFAULT NULL,
  p_discount_amount numeric DEFAULT 0,p_customer_name text DEFAULT NULL,p_customer_phone text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,p_reference_code text DEFAULT NULL,p_due_date date DEFAULT NULL,p_is_credit boolean DEFAULT false,
  p_recorded_at timestamptz DEFAULT NULL,p_local_id text DEFAULT NULL
)
RETURNS TABLE(transaction_id uuid,status text,recorded_at timestamptz,total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; v_phone text;
BEGIN
  v_phone := regexp_replace(trim(COALESCE(p_customer_phone,'')), '[^0-9]', '', 'g');
  IF left(v_phone,1)='0' THEN v_phone := '254' || substr(v_phone,2); ELSIF length(v_phone)=9 THEN v_phone := '254' || v_phone; END IF;
  SELECT * INTO r FROM public.dashboard_record_transaction_offline(p_branch_id,p_items,
    CASE WHEN p_payment_method='mpesa_manual' AND NOT (p_is_credit AND COALESCE(p_amount_paid,0)=0) THEN 'mpesa_manual' ELSE 'cash' END,p_discount_amount,
    p_customer_name,NULLIF(v_phone,''),CASE WHEN p_payment_method='mpesa_manual' THEN p_reference_code ELSE NULL END,NULL,p_recorded_at,p_local_id);
  PERFORM public.finalize_sale_payment(r.transaction_id,p_payment_method,p_amount_paid,p_amount_tendered,p_reference_code,p_customer_email,p_due_date,p_is_credit);
  RETURN QUERY SELECT r.transaction_id,r.status,r.recorded_at,r.total_amount;
END; $$;

CREATE OR REPLACE FUNCTION public.record_receivable_payment(
  p_receivable_id uuid, p_payment_method text, p_amount numeric,
  p_amount_tendered numeric DEFAULT NULL, p_reference_code text DEFAULT NULL
)
RETURNS TABLE(payment_id uuid, balance_due numeric, change_given numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_business_id uuid := public.get_my_business_id();
  v_actor uuid := auth.uid();
  v_account public.receivable_accounts%ROWTYPE;
  v_total numeric(10,2);
  v_paid numeric(10,2);
  v_balance numeric(10,2);
  v_status text;
  v_verified_by uuid;
  v_verified_at timestamptz;
  v_payment_id uuid;
  v_change numeric(10,2) := 0;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF p_payment_method NOT IN ('cash','mpesa_manual','card','bank_transfer','other') THEN RAISE EXCEPTION 'Unsupported payment method'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter an amount greater than zero'; END IF;
  IF p_payment_method='mpesa_manual' AND length(trim(COALESCE(p_reference_code,''))) < 5 THEN RAISE EXCEPTION 'Enter a valid M-Pesa reference code'; END IF;
  SELECT * INTO v_account FROM public.receivable_accounts WHERE id=p_receivable_id AND business_id=v_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credit account not found'; END IF;
  IF public.get_my_global_role() <> 'owner' AND public.branch_role_rank(public.get_effective_branch_role(v_actor,v_account.branch_id)) < public.branch_role_rank('employee') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT total_amount INTO v_total FROM public.transactions WHERE id=v_account.transaction_id AND business_id=v_business_id;
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.payments WHERE transaction_id=v_account.transaction_id AND business_id=v_business_id AND status <> 'rejected';
  v_balance := greatest(v_total-v_paid,0);
  IF p_amount > v_balance THEN RAISE EXCEPTION 'Payment exceeds the outstanding balance of %',v_balance; END IF;
  IF p_payment_method='cash' THEN
    IF COALESCE(p_amount_tendered,p_amount) < p_amount THEN RAISE EXCEPTION 'Cash received must cover the amount applied'; END IF;
    v_change := COALESCE(p_amount_tendered,p_amount)-p_amount;
  END IF;
  IF public.get_my_global_role()='owner' THEN v_status:='verified'; v_verified_by:=v_actor; v_verified_at:=now(); ELSE v_status:='pending_verify'; END IF;
  INSERT INTO public.payments(transaction_id,business_id,payment_method,amount,status,amount_tendered,change_given,reference_code,mpesa_ref_code,verified_by,verified_at,payment_at)
  VALUES(v_account.transaction_id,v_business_id,p_payment_method,p_amount,v_status,
    CASE WHEN p_payment_method='cash' THEN COALESCE(p_amount_tendered,p_amount) ELSE p_amount END,v_change,
    CASE WHEN p_payment_method='cash' THEN NULL ELSE NULLIF(trim(p_reference_code),'') END,
    CASE WHEN p_payment_method='mpesa_manual' THEN NULLIF(trim(p_reference_code),'') ELSE NULL END,
    v_verified_by,v_verified_at,now()) RETURNING id INTO v_payment_id;
  INSERT INTO public.audit_logs(business_id,actor_id,entity_type,entity_id,action,old_value,new_value)
  VALUES(v_business_id,v_actor,'payment',v_payment_id,'receivable_payment_recorded',
    jsonb_build_object('balance_due',v_balance),
    jsonb_build_object('transaction_id',v_account.transaction_id,'payment_method',p_payment_method,
      'amount',p_amount,'status',v_status,'balance_due',greatest(v_balance-p_amount,0)));
  RETURN QUERY SELECT v_payment_id,greatest(v_balance-p_amount,0),v_change;
END; $$;

REVOKE ALL ON FUNCTION public.finalize_sale_payment(uuid,text,numeric,numeric,text,text,date,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.employee_record_transaction_v2(jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.dashboard_record_transaction_v2(uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.employee_record_transaction_offline_v2(jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,timestamptz,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.dashboard_record_transaction_offline_v2(uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,timestamptz,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.record_receivable_payment(uuid,text,numeric,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.employee_record_transaction_v2(jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_record_transaction_v2(uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_record_transaction_offline_v2(jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_record_transaction_offline_v2(uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_receivable_payment(uuid,text,numeric,numeric,text) TO authenticated;
