-- Fully qualify database columns that collide with PL/pgSQL output variables.
-- Keep the existing sale flow, stable local-ID replay, timestamps and grants.
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

  UPDATE public.transactions AS saved_transaction
     SET recorded_at = v_recorded_at,
         local_id = NULLIF(trim(COALESCE(p_local_id, '')), ''),
         origin = CASE
           WHEN NULLIF(trim(COALESCE(p_local_id, '')), '') IS NOT NULL THEN 'offline'
           ELSE saved_transaction.origin
         END,
         sync_status = 'synced',
         synced_at = now()
   WHERE saved_transaction.id = v_result.transaction_id;

  UPDATE public.payments AS saved_payment
     SET payment_at = v_recorded_at
   WHERE saved_payment.transaction_id = v_result.transaction_id;

  RETURN QUERY
  SELECT
    v_result.transaction_id::uuid,
    v_result.status::text,
    v_recorded_at,
    v_result.total_amount::numeric;
END;
$$;

REVOKE ALL ON FUNCTION public.employee_record_transaction_offline(
  jsonb, text, numeric, text, text, text, text, timestamptz, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_record_transaction_offline(
  jsonb, text, numeric, text, text, text, text, timestamptz, text
) TO authenticated;

-- is_active is also a declared output field, so qualify the users table column
-- used by the owner authorization check.
CREATE OR REPLACE FUNCTION public.owner_my_payment_provider_settings_v2(
  p_business_id uuid,
  p_actor_id uuid
)
RETURNS TABLE(
  provider text,
  environment text,
  business_shortcode text,
  till_number text,
  account_reference text,
  transaction_type text,
  callback_url text,
  consumer_key_set boolean,
  consumer_secret_set boolean,
  passkey_set boolean,
  is_active boolean,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.users AS owner_user
     WHERE owner_user.id = p_actor_id
       AND owner_user.business_id = p_business_id
       AND owner_user.global_role = 'owner'
       AND owner_user.is_active
       AND owner_user.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    settings.provider,
    settings.environment,
    settings.business_shortcode,
    settings.till_number,
    settings.account_reference,
    settings.transaction_type,
    settings.callback_url,
    EXISTS(SELECT 1 FROM vault.secrets secret WHERE secret.id = settings.consumer_key_secret_id),
    EXISTS(SELECT 1 FROM vault.secrets secret WHERE secret.id = settings.consumer_secret_secret_id),
    EXISTS(SELECT 1 FROM vault.secrets secret WHERE secret.id = settings.passkey_secret_id),
    settings.is_active,
    settings.updated_at
    FROM public.business_payment_provider_settings AS settings
   WHERE settings.business_id = p_business_id
   ORDER BY settings.provider;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_my_payment_provider_settings_v2(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_my_payment_provider_settings_v2(uuid, uuid)
  TO service_role;
