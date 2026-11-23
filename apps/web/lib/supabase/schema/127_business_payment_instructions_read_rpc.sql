-- Expose only public merchant instructions to active members of their own
-- business. Provider credentials remain in the owner-only settings flows.
CREATE OR REPLACE FUNCTION public.business_public_payment_methods()
RETURNS TABLE (
  id uuid,
  method_code text,
  account_type text,
  display_name text,
  merchant_number text,
  account_reference text,
  instructions text,
  is_active boolean,
  is_default boolean,
  configuration_version integer,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid := public.get_my_business_id();
  v_role text := public.get_my_global_role();
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL OR v_role NOT IN ('owner', 'admin', 'employee') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users AS app_user
     WHERE app_user.id = auth.uid()
       AND app_user.business_id = v_business_id
       AND app_user.is_active
       AND app_user.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT method.id,
         method.method_code,
         method.account_type,
         method.display_name,
         method.merchant_number,
         method.account_reference,
         method.instructions,
         method.is_active,
         method.is_default,
         method.configuration_version,
         method.updated_at
    FROM public.business_payment_methods AS method
   WHERE method.business_id = v_business_id
     AND method.is_active
   ORDER BY method.is_default DESC, method.updated_at DESC, method.id;
END;
$$;

REVOKE ALL ON FUNCTION public.business_public_payment_methods() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_public_payment_methods() TO authenticated;
