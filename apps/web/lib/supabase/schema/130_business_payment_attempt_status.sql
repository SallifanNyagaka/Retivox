-- Narrow status projection for the payment progress UI. Clients can resume a
-- pending attempt by payment ID but cannot read provider configuration or
-- mutate settlement state.
CREATE OR REPLACE FUNCTION public.business_payment_attempt_status(p_payment_id uuid)
RETURNS TABLE (
  payment_id uuid,
  amount numeric,
  payment_method text,
  status text,
  confirmed_reference text,
  payment_at timestamptz,
  verified_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users AS app_user
     WHERE app_user.id = v_actor
       AND app_user.business_id = v_business_id
       AND app_user.is_active
       AND app_user.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT payment.id,
         payment.amount,
         payment.payment_method,
         payment.status,
         CASE WHEN payment.status = 'verified'
              THEN COALESCE(payment.provider_transaction_id, payment.mpesa_ref_code)
              ELSE NULL END,
         payment.payment_at,
         payment.verified_at
    FROM public.payments AS payment
   WHERE payment.id = p_payment_id
     AND payment.business_id = v_business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.business_payment_attempt_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_payment_attempt_status(uuid) TO authenticated;
