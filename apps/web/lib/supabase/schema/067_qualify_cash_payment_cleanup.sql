-- Avoid PL/pgSQL name resolution conflicts with the RETURNS TABLE
-- transaction_id output column in the cash-sale v2 wrappers.

CREATE OR REPLACE FUNCTION public.dashboard_record_transaction_v2(
  p_branch_id uuid, p_items jsonb, p_payment_method text, p_amount_paid numeric,
  p_amount_tendered numeric DEFAULT NULL, p_discount_amount numeric DEFAULT 0,
  p_customer_name text DEFAULT NULL, p_customer_phone text DEFAULT NULL,
  p_customer_email text DEFAULT NULL, p_reference_code text DEFAULT NULL,
  p_due_date date DEFAULT NULL, p_is_credit boolean DEFAULT false
)
RETURNS TABLE(transaction_id uuid, status text, recorded_at timestamptz, total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_phone text; v_base_method text;
BEGIN
  v_phone := regexp_replace(trim(COALESCE(p_customer_phone, '')), '[^0-9]', '', 'g');
  IF left(v_phone, 1) = '0' THEN
    v_phone := '254' || substr(v_phone, 2);
  ELSIF length(v_phone) = 9 THEN
    v_phone := '254' || v_phone;
  END IF;
  v_base_method := CASE
    WHEN p_payment_method = 'mpesa_manual'
      AND NOT (p_is_credit AND COALESCE(p_amount_paid, 0) = 0)
    THEN 'mpesa_manual' ELSE 'cash' END;
  SELECT * INTO r FROM public.dashboard_record_transaction(
    p_branch_id, p_items, v_base_method, p_discount_amount, p_customer_name,
    NULLIF(v_phone, ''),
    CASE WHEN v_base_method = 'mpesa_manual' THEN p_reference_code ELSE NULL END,
    CASE WHEN v_base_method = 'cash' THEN 'INTERNAL-CASH-SALE' ELSE NULL END
  );
  PERFORM public.finalize_sale_payment(
    r.transaction_id, p_payment_method, p_amount_paid, p_amount_tendered,
    p_reference_code, p_customer_email, p_due_date, p_is_credit
  );
  UPDATE public.payments AS payment SET cash_deposit_code = NULL
   WHERE payment.transaction_id = r.transaction_id
     AND payment.business_id = public.get_my_business_id()
     AND payment.payment_method = 'cash';
  RETURN QUERY SELECT r.transaction_id, r.status, r.recorded_at, r.total_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_record_transaction_offline_v2(
  p_branch_id uuid, p_items jsonb, p_payment_method text, p_amount_paid numeric,
  p_amount_tendered numeric DEFAULT NULL, p_discount_amount numeric DEFAULT 0,
  p_customer_name text DEFAULT NULL, p_customer_phone text DEFAULT NULL,
  p_customer_email text DEFAULT NULL, p_reference_code text DEFAULT NULL,
  p_due_date date DEFAULT NULL, p_is_credit boolean DEFAULT false,
  p_recorded_at timestamptz DEFAULT NULL, p_local_id text DEFAULT NULL
)
RETURNS TABLE(transaction_id uuid, status text, recorded_at timestamptz, total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_phone text; v_base_method text;
BEGIN
  v_phone := regexp_replace(trim(COALESCE(p_customer_phone, '')), '[^0-9]', '', 'g');
  IF left(v_phone, 1) = '0' THEN
    v_phone := '254' || substr(v_phone, 2);
  ELSIF length(v_phone) = 9 THEN
    v_phone := '254' || v_phone;
  END IF;
  v_base_method := CASE
    WHEN p_payment_method = 'mpesa_manual'
      AND NOT (p_is_credit AND COALESCE(p_amount_paid, 0) = 0)
    THEN 'mpesa_manual' ELSE 'cash' END;
  SELECT * INTO r FROM public.dashboard_record_transaction_offline(
    p_branch_id, p_items, v_base_method, p_discount_amount, p_customer_name,
    NULLIF(v_phone, ''),
    CASE WHEN v_base_method = 'mpesa_manual' THEN p_reference_code ELSE NULL END,
    CASE WHEN v_base_method = 'cash' THEN 'INTERNAL-CASH-SALE' ELSE NULL END,
    p_recorded_at, p_local_id
  );
  PERFORM public.finalize_sale_payment(
    r.transaction_id, p_payment_method, p_amount_paid, p_amount_tendered,
    p_reference_code, p_customer_email, p_due_date, p_is_credit
  );
  UPDATE public.payments AS payment SET cash_deposit_code = NULL
   WHERE payment.transaction_id = r.transaction_id
     AND payment.business_id = public.get_my_business_id()
     AND payment.payment_method = 'cash';
  RETURN QUERY SELECT r.transaction_id, r.status, r.recorded_at, r.total_amount;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_record_transaction_v2(uuid, jsonb, text, numeric, numeric, numeric, text, text, text, text, date, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dashboard_record_transaction_offline_v2(uuid, jsonb, text, numeric, numeric, numeric, text, text, text, text, date, boolean, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_record_transaction_v2(uuid, jsonb, text, numeric, numeric, numeric, text, text, text, text, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_record_transaction_offline_v2(uuid, jsonb, text, numeric, numeric, numeric, text, text, text, text, date, boolean, timestamptz, text) TO authenticated;
