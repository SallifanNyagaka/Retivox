-- Merchant-owned online collection configuration. Provider credentials are
-- kept in Supabase Vault and never returned by the owner-facing settings read.

CREATE TABLE IF NOT EXISTS public.business_payment_provider_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('daraja', 'pesapal')),
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  business_shortcode text,
  account_reference text NOT NULL DEFAULT 'RETIVOX',
  transaction_type text NOT NULL DEFAULT 'CustomerPayBillOnline',
  callback_url text NOT NULL,
  consumer_key_secret_id uuid,
  consumer_secret_secret_id uuid,
  passkey_secret_id uuid,
  provider_account_id text,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, provider),
  CHECK (provider <> 'daraja' OR NULLIF(trim(business_shortcode), '') IS NOT NULL)
);

ALTER TABLE public.business_payment_provider_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_payment_provider_settings FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS touch_business_payment_provider_settings_updated_at ON public.business_payment_provider_settings;
CREATE TRIGGER touch_business_payment_provider_settings_updated_at
BEFORE UPDATE ON public.business_payment_provider_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.owner_save_payment_provider_settings(
  p_business_id uuid,
  p_updated_by uuid,
  p_provider text,
  p_environment text,
  p_business_shortcode text,
  p_account_reference text,
  p_transaction_type text,
  p_callback_url text,
  p_consumer_key text,
  p_consumer_secret text,
  p_passkey text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
DECLARE
  v_id uuid;
  v_key_id uuid;
  v_secret_id uuid;
  v_passkey_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = p_updated_by
       AND business_id = p_business_id
       AND global_role = 'owner'
       AND is_active = true
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Only an active business owner can configure payment providers';
  END IF;
  IF p_provider NOT IN ('daraja', 'pesapal') OR p_environment NOT IN ('sandbox', 'production')
     OR NULLIF(trim(COALESCE(p_callback_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Enter a provider, environment, and callback URL';
  END IF;
  IF p_provider = 'daraja'
     AND (NULLIF(trim(COALESCE(p_business_shortcode, '')), '') IS NULL
       OR NULLIF(trim(COALESCE(p_passkey, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'Daraja requires a shortcode and Lipa na M-Pesa passkey';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_business_id::text || ':' || p_provider)::bigint);
  SELECT id, consumer_key_secret_id, consumer_secret_secret_id, passkey_secret_id
    INTO v_id, v_key_id, v_secret_id, v_passkey_id
    FROM public.business_payment_provider_settings
   WHERE business_id = p_business_id AND provider = p_provider
   FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO public.business_payment_provider_settings (
      business_id, provider, environment, business_shortcode, account_reference,
      transaction_type, callback_url, updated_by
    ) VALUES (
      p_business_id, p_provider, p_environment,
      NULLIF(trim(COALESCE(p_business_shortcode, '')), ''),
      COALESCE(NULLIF(trim(p_account_reference), ''), 'RETIVOX'),
      COALESCE(NULLIF(trim(p_transaction_type), ''), 'CustomerPayBillOnline'),
      trim(p_callback_url), p_updated_by
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.business_payment_provider_settings
       SET environment = p_environment,
           business_shortcode = NULLIF(trim(COALESCE(p_business_shortcode, '')), ''),
           account_reference = COALESCE(NULLIF(trim(p_account_reference), ''), 'RETIVOX'),
           transaction_type = COALESCE(NULLIF(trim(p_transaction_type), ''), 'CustomerPayBillOnline'),
           callback_url = trim(p_callback_url),
           is_active = true,
           updated_by = p_updated_by
     WHERE id = v_id;
  END IF;

  IF NULLIF(trim(COALESCE(p_consumer_key, '')), '') IS NOT NULL THEN
    IF v_key_id IS NULL THEN
      SELECT vault.create_secret(trim(p_consumer_key), 'retivox-business-' || p_business_id || '-' || p_provider || '-key', 'Retivox merchant payment provider key', NULL) INTO v_key_id;
    ELSE
      PERFORM vault.update_secret(v_key_id, trim(p_consumer_key), NULL, NULL, NULL);
    END IF;
  END IF;
  IF NULLIF(trim(COALESCE(p_consumer_secret, '')), '') IS NOT NULL THEN
    IF v_secret_id IS NULL THEN
      SELECT vault.create_secret(trim(p_consumer_secret), 'retivox-business-' || p_business_id || '-' || p_provider || '-secret', 'Retivox merchant payment provider secret', NULL) INTO v_secret_id;
    ELSE
      PERFORM vault.update_secret(v_secret_id, trim(p_consumer_secret), NULL, NULL, NULL);
    END IF;
  END IF;
  IF p_provider = 'daraja' THEN
    IF NULLIF(trim(COALESCE(p_passkey, '')), '') IS NOT NULL THEN
      IF v_passkey_id IS NULL THEN
        SELECT vault.create_secret(trim(p_passkey), 'retivox-business-' || p_business_id || '-daraja-passkey', 'Retivox merchant Daraja passkey', NULL) INTO v_passkey_id;
      ELSE
        PERFORM vault.update_secret(v_passkey_id, trim(p_passkey), NULL, NULL, NULL);
      END IF;
    END IF;
  END IF;

  IF v_key_id IS NULL OR v_secret_id IS NULL OR (p_provider = 'daraja' AND v_passkey_id IS NULL) THEN
    RAISE EXCEPTION 'Enter the required provider credentials on first setup';
  END IF;

  UPDATE public.business_payment_provider_settings
     SET consumer_key_secret_id = v_key_id,
         consumer_secret_secret_id = v_secret_id,
         passkey_secret_id = v_passkey_id
   WHERE id = v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_my_payment_provider_settings(
  p_business_id uuid,
  p_actor_id uuid
)
RETURNS TABLE(
  provider text,
  environment text,
  business_shortcode text,
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
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = p_actor_id AND business_id = p_business_id
       AND global_role = 'owner' AND is_active = true AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  RETURN QUERY
  SELECT settings.provider, settings.environment, settings.business_shortcode,
         settings.account_reference, settings.transaction_type, settings.callback_url,
         EXISTS (SELECT 1 FROM vault.secrets secret WHERE secret.id = settings.consumer_key_secret_id),
         EXISTS (SELECT 1 FROM vault.secrets secret WHERE secret.id = settings.consumer_secret_secret_id),
         EXISTS (SELECT 1 FROM vault.secrets secret WHERE secret.id = settings.passkey_secret_id),
         settings.is_active, settings.updated_at
    FROM public.business_payment_provider_settings settings
   WHERE settings.business_id = p_business_id
   ORDER BY settings.provider;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_get_payment_provider_config(
  p_business_id uuid,
  p_actor_id uuid,
  p_provider text
)
RETURNS TABLE(
  provider text,
  environment text,
  business_shortcode text,
  account_reference text,
  transaction_type text,
  callback_url text,
  consumer_key text,
  consumer_secret text,
  passkey text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = p_actor_id AND business_id = p_business_id
       AND global_role = 'owner' AND is_active = true AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  RETURN QUERY
  SELECT settings.provider, settings.environment, settings.business_shortcode,
         settings.account_reference, settings.transaction_type, settings.callback_url,
         (SELECT secret.decrypted_secret FROM vault.decrypted_secrets secret WHERE secret.id = settings.consumer_key_secret_id),
         (SELECT secret.decrypted_secret FROM vault.decrypted_secrets secret WHERE secret.id = settings.consumer_secret_secret_id),
         (SELECT secret.decrypted_secret FROM vault.decrypted_secrets secret WHERE secret.id = settings.passkey_secret_id)
    FROM public.business_payment_provider_settings settings
   WHERE settings.business_id = p_business_id
     AND settings.provider = p_provider AND settings.is_active = true;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_save_payment_provider_settings(uuid,uuid,text,text,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_save_payment_provider_settings(uuid,uuid,text,text,text,text,text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.owner_my_payment_provider_settings(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_my_payment_provider_settings(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.owner_get_payment_provider_config(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_get_payment_provider_config(uuid,uuid,text) TO service_role;
