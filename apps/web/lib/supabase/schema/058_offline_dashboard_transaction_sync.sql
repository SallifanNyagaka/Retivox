/*
 * Idempotent offline sale synchronization for owner and admin dashboard users.
 *
 * The existing dashboard RPC remains the authority for branch access, pricing,
 * stock, discounts, transaction status, and audit entries. This wrapper adds a
 * device-generated id and the original local sale timestamp for safe retries.
 */

CREATE OR REPLACE FUNCTION public.dashboard_record_transaction_offline(
  p_branch_id uuid,
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
  v_actor_id uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
  v_result record;
  v_existing record;
  v_local_id text := NULLIF(trim(COALESCE(p_local_id, '')), '');
  v_recorded_at timestamptz := COALESCE(p_recorded_at, now());
  v_updated_rows integer;
BEGIN
  IF v_actor_id IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF v_local_id IS NULL OR length(v_local_id) > 128 THEN
    RAISE EXCEPTION 'A valid local transaction id is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_business_id::text || ':' || v_actor_id::text || ':' || v_local_id, 0)
  );

  SELECT
    transactions.id AS transaction_id,
    transactions.status,
    transactions.recorded_at,
    transactions.total_amount
    INTO v_existing
    FROM public.transactions
   WHERE transactions.business_id = v_business_id
     AND transactions.employee_id = v_actor_id
     AND transactions.local_id = v_local_id
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY
    SELECT
      v_existing.transaction_id::uuid,
      v_existing.status::text,
      v_existing.recorded_at::timestamptz,
      v_existing.total_amount::numeric;
    RETURN;
  END IF;

  SELECT *
    INTO v_result
    FROM public.dashboard_record_transaction(
      p_branch_id,
      p_items,
      p_payment_method,
      p_discount_amount,
      p_customer_name,
      p_customer_phone,
      p_mpesa_ref_code,
      p_cash_deposit_code
    );

  IF v_result.transaction_id IS NULL THEN
    RAISE EXCEPTION 'Transaction could not be recorded';
  END IF;

  UPDATE public.transactions
     SET local_id = v_local_id,
         recorded_at = v_recorded_at,
         origin = 'offline',
         sync_status = 'synced',
         synced_at = now()
   WHERE id = v_result.transaction_id
     AND business_id = v_business_id
     AND employee_id = v_actor_id;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows <> 1 THEN
    RAISE EXCEPTION 'Transaction could not be linked to its offline id';
  END IF;

  UPDATE public.payments
     SET payment_at = v_recorded_at
   WHERE payments.transaction_id = v_result.transaction_id
     AND payments.business_id = v_business_id;

  RETURN QUERY
  SELECT
    v_result.transaction_id::uuid,
    v_result.status::text,
    v_recorded_at,
    v_result.total_amount::numeric;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_record_transaction_offline(uuid, jsonb, text, numeric, text, text, text, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_record_transaction_offline(uuid, jsonb, text, numeric, text, text, text, text, timestamptz, text) TO authenticated;

REVOKE ALL ON FUNCTION public.employee_record_transaction_offline(jsonb, text, numeric, text, text, text, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_record_transaction_offline(jsonb, text, numeric, text, text, text, text, timestamptz, text) TO authenticated;
