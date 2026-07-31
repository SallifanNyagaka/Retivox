/*
 * Mobile offline transaction bridge for Retivox.
 *
 * The existing employee sale RPC remains unchanged for web and current
 * clients. This bridge accepts the timestamp captured on the device and
 * updates the created transaction/payment after the normal stock and pricing
 * workflow succeeds. The dynamic call supports databases that already have
 * either the seven-argument or newer eight-argument sale RPC installed.
 */

CREATE OR REPLACE FUNCTION public.employee_record_transaction_offline(
  p_items jsonb,
  p_payment_method text,
  p_discount_amount numeric DEFAULT 0,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_mpesa_ref_code text DEFAULT NULL,
  p_cash_deposit_code text DEFAULT NULL,
  p_recorded_at timestamptz DEFAULT NULL
)
RETURNS TABLE(
  transaction_id uuid,
  status text,
  recorded_at timestamptz,
  total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result record;
  v_recorded_at timestamptz := COALESCE(p_recorded_at, now());
BEGIN
  IF to_regprocedure('public.employee_record_transaction(jsonb,text,numeric,text,text,text,text,timestamptz)') IS NOT NULL THEN
    EXECUTE $query$
      SELECT *
        FROM public.employee_record_transaction($1, $2, $3, $4, $5, $6, $7, $8)
    $query$
      INTO v_result
      USING p_items, p_payment_method, p_discount_amount, p_customer_name,
            p_customer_phone, p_mpesa_ref_code, p_cash_deposit_code, v_recorded_at;
  ELSE
    EXECUTE $query$
      SELECT *
        FROM public.employee_record_transaction($1, $2, $3, $4, $5, $6, $7)
    $query$
      INTO v_result
      USING p_items, p_payment_method, p_discount_amount, p_customer_name,
            p_customer_phone, p_mpesa_ref_code, p_cash_deposit_code;
  END IF;

  UPDATE public.transactions
     SET recorded_at = v_recorded_at
   WHERE id = v_result.transaction_id;

  UPDATE public.payments
     SET payment_at = v_recorded_at
   WHERE transaction_id = v_result.transaction_id;

  RETURN QUERY
  SELECT
    v_result.transaction_id::uuid,
    v_result.status::text,
    v_recorded_at,
    v_result.total_amount::numeric;
END;
$$;
