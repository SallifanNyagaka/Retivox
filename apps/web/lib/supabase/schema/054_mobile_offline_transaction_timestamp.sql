/*
 * Mobile offline transaction bridge for Retivox.
 *
 * Mobile records the exact local transaction time before it queues a sale.
 * This wrapper keeps the existing employee sale RPC unchanged, then applies
 * that captured time to the resulting transaction and payment records.
 * The local id makes reconnect retries idempotent.
 */

DROP FUNCTION IF EXISTS public.employee_record_transaction_offline(
  jsonb,
  text,
  numeric,
  text,
  text,
  text,
  text,
  timestamptz
);

DROP FUNCTION IF EXISTS public.employee_record_transaction_offline(
  jsonb,
  text,
  numeric,
  text,
  text,
  text,
  text,
  timestamptz,
  text
);

CREATE OR REPLACE FUNCTION public.employee_record_transaction_offline(
  p_items jsonb,
  p_payment_method text,
  p_discount_amount numeric DEFAULT 0,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_mpesa_ref_code text DEFAULT NULL,
  p_cash_deposit_code text DEFAULT NULL,
  p_recorded_at timestamptz DEFAULT NULL,
  p_local_id text DEFAULT NULL
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
  v_has_timestamped_rpc boolean;
  v_has_standard_rpc boolean;
BEGIN
  IF NULLIF(trim(COALESCE(p_local_id, '')), '') IS NOT NULL THEN
    SELECT
      transactions.id AS transaction_id,
      transactions.status,
      transactions.recorded_at,
      transactions.total_amount
      INTO v_result
      FROM public.transactions
     WHERE transactions.business_id = public.get_my_business_id()
       AND transactions.employee_id = auth.uid()
       AND transactions.local_id = trim(p_local_id)
     LIMIT 1;

    IF FOUND THEN
      RETURN QUERY
      SELECT
        v_result.transaction_id::uuid,
        v_result.status::text,
        v_result.recorded_at::timestamptz,
        v_result.total_amount::numeric;
      RETURN;
    END IF;
  END IF;

  v_has_timestamped_rpc := to_regprocedure(
    'public.employee_record_transaction(jsonb,text,numeric,text,text,text,text,timestamptz)'
  ) IS NOT NULL;
  v_has_standard_rpc := to_regprocedure(
    'public.employee_record_transaction(jsonb,text,numeric,text,text,text,text)'
  ) IS NOT NULL;

  IF v_has_timestamped_rpc THEN
    EXECUTE $query$
      SELECT *
        FROM public.employee_record_transaction($1, $2, $3, $4, $5, $6, $7, $8)
    $query$
      INTO v_result
      USING p_items,
            p_payment_method,
            p_discount_amount,
            p_customer_name,
            p_customer_phone,
            p_mpesa_ref_code,
            p_cash_deposit_code,
            v_recorded_at;
  ELSIF v_has_standard_rpc THEN
    EXECUTE $query$
      SELECT *
        FROM public.employee_record_transaction($1, $2, $3, $4, $5, $6, $7)
    $query$
      INTO v_result
      USING p_items,
            p_payment_method,
            p_discount_amount,
            p_customer_name,
            p_customer_phone,
            p_mpesa_ref_code,
            p_cash_deposit_code;
  ELSE
    RAISE EXCEPTION 'Employee transaction RPC is not installed';
  END IF;

  IF v_result.transaction_id IS NULL THEN
    RAISE EXCEPTION 'Transaction could not be recorded';
  END IF;

  UPDATE public.transactions
     SET recorded_at = v_recorded_at,
         local_id = NULLIF(trim(COALESCE(p_local_id, '')), ''),
         origin = CASE
           WHEN NULLIF(trim(COALESCE(p_local_id, '')), '') IS NOT NULL THEN 'offline'
           ELSE origin
         END,
         sync_status = 'synced',
         synced_at = now()
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
