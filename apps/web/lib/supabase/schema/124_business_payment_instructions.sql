-- Safe, non-secret merchant payment destinations and customer instructions.
-- Provider credentials remain in business_payment_provider_settings/Vault.
CREATE TABLE IF NOT EXISTS public.business_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  method_code text NOT NULL CHECK (method_code IN ('mpesa_manual','bank_transfer','card','other')),
  account_type text NOT NULL CHECK (account_type IN ('buy_goods','paybill','pochi','bank_account','other')),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  merchant_number text,
  account_reference text,
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 1000),
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  configuration_version bigint NOT NULL DEFAULT 1 CHECK (configuration_version > 0),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_default OR is_active),
  CHECK (
    method_code <> 'mpesa_manual'
    OR (account_type IN ('buy_goods','paybill','pochi') AND NULLIF(trim(merchant_number), '') IS NOT NULL)
  ),
  CHECK (
    method_code <> 'mpesa_manual' OR account_type <> 'paybill'
    OR NULLIF(trim(account_reference), '') IS NOT NULL
  ),
  CHECK (method_code <> 'bank_transfer' OR account_type = 'bank_account')
);

CREATE INDEX IF NOT EXISTS idx_business_payment_methods_active
  ON public.business_payment_methods (business_id, is_active, method_code, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_payment_methods_single_default
  ON public.business_payment_methods (business_id) WHERE is_default;

ALTER TABLE public.business_payment_methods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_payment_methods FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS touch_business_payment_methods_updated_at ON public.business_payment_methods;
CREATE TRIGGER touch_business_payment_methods_updated_at
BEFORE UPDATE ON public.business_payment_methods
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.owner_save_business_payment_method(
  p_method_id uuid,
  p_business_id uuid,
  p_actor_id uuid,
  p_method_code text,
  p_account_type text,
  p_display_name text,
  p_merchant_number text,
  p_account_reference text,
  p_instructions text,
  p_is_active boolean,
  p_is_default boolean
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = p_actor_id AND business_id = p_business_id
       AND global_role = 'owner' AND is_active = true AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Only an active business owner can configure payment methods' USING ERRCODE = '42501'; END IF;
  IF p_method_code NOT IN ('mpesa_manual','bank_transfer','card','other')
     OR p_account_type NOT IN ('buy_goods','paybill','pochi','bank_account','other')
     OR NULLIF(trim(COALESCE(p_display_name,'')), '') IS NULL
     OR length(p_display_name) > 80 OR length(COALESCE(p_merchant_number,'')) > 80
     OR length(COALESCE(p_account_reference,'')) > 80 OR length(COALESCE(p_instructions,'')) > 1000
     OR (p_is_default AND NOT p_is_active) THEN
    RAISE EXCEPTION 'Check the payment method details';
  END IF;
  IF p_method_code = 'mpesa_manual' AND (
    p_account_type NOT IN ('buy_goods','paybill','pochi')
    OR NULLIF(trim(COALESCE(p_merchant_number,'')), '') IS NULL
    OR (p_account_type = 'paybill' AND NULLIF(trim(COALESCE(p_account_reference,'')), '') IS NULL)
  ) THEN RAISE EXCEPTION 'Manual M-PESA needs a Till, Paybill and account reference, or Pochi receiving number'; END IF;
  IF p_method_code = 'bank_transfer' AND p_account_type <> 'bank_account' THEN
    RAISE EXCEPTION 'Bank transfer details must use the bank account type';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':payment-methods', 0));
  IF p_method_id IS NOT NULL THEN
    SELECT id, jsonb_build_object(
      'method_code',method_code,'account_type',account_type,'display_name',display_name,
      'merchant_number',merchant_number,'account_reference',account_reference,
      'instructions',instructions,'is_active',is_active,'is_default',is_default
    ) INTO v_id, v_old
      FROM public.business_payment_methods
     WHERE id = p_method_id AND business_id = p_business_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment method was not found for this business'; END IF;
  END IF;

  IF p_is_default THEN
    UPDATE public.business_payment_methods SET is_default = false
     WHERE business_id = p_business_id AND is_default AND id IS DISTINCT FROM p_method_id;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.business_payment_methods(
      business_id,method_code,account_type,display_name,merchant_number,account_reference,
      instructions,is_active,is_default,updated_by
    ) VALUES (
      p_business_id,p_method_code,p_account_type,trim(p_display_name),
      NULLIF(trim(COALESCE(p_merchant_number,'')),''),NULLIF(trim(COALESCE(p_account_reference,'')),''),
      trim(COALESCE(p_instructions,'')),p_is_active,p_is_default,p_actor_id
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.business_payment_methods SET
      method_code=p_method_code,account_type=p_account_type,display_name=trim(p_display_name),
      merchant_number=NULLIF(trim(COALESCE(p_merchant_number,'')),''),
      account_reference=NULLIF(trim(COALESCE(p_account_reference,'')),''),
      instructions=trim(COALESCE(p_instructions,'')),is_active=p_is_active,
      is_default=p_is_default,updated_by=p_actor_id,
      configuration_version=configuration_version+1
     WHERE id=v_id AND business_id=p_business_id;
  END IF;

  SELECT jsonb_build_object(
    'method_code',method_code,'account_type',account_type,'display_name',display_name,
    'merchant_number',merchant_number,'account_reference',account_reference,
    'instructions',instructions,'is_active',is_active,'is_default',is_default,
    'configuration_version',configuration_version
  ) INTO v_new FROM public.business_payment_methods WHERE id=v_id AND business_id=p_business_id;
  INSERT INTO public.audit_logs(business_id,actor_id,entity_type,entity_id,action,old_value,new_value)
  VALUES(p_business_id,p_actor_id,'payment_method',v_id,
    CASE WHEN v_old IS NULL THEN 'payment_method_created' ELSE 'payment_method_updated' END,v_old,v_new);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_save_business_payment_method(uuid,uuid,uuid,text,text,text,text,text,text,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_save_business_payment_method(uuid,uuid,uuid,text,text,text,text,text,text,boolean,boolean) TO service_role;
