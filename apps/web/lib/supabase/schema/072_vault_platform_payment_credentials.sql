-- Move platform Daraja credentials into Supabase Vault. The browser and public
-- database API never receive decrypted provider credentials.

ALTER TABLE public.platform_payment_settings
  ADD COLUMN IF NOT EXISTS consumer_key_secret_id uuid,
  ADD COLUMN IF NOT EXISTS consumer_secret_secret_id uuid,
  ADD COLUMN IF NOT EXISTS passkey_secret_id uuid;

DO $$
DECLARE
  v_setting record;
  v_consumer_key_id uuid;
  v_consumer_secret_id uuid;
  v_passkey_id uuid;
BEGIN
  FOR v_setting IN
    SELECT id, consumer_key, consumer_secret, passkey,
           consumer_key_secret_id, consumer_secret_secret_id, passkey_secret_id
      FROM public.platform_payment_settings
     WHERE consumer_key IS NOT NULL OR consumer_secret IS NOT NULL OR passkey IS NOT NULL
  LOOP
    v_consumer_key_id := v_setting.consumer_key_secret_id;
    v_consumer_secret_id := v_setting.consumer_secret_secret_id;
    v_passkey_id := v_setting.passkey_secret_id;

    IF v_consumer_key_id IS NULL AND NULLIF(v_setting.consumer_key, '') IS NOT NULL THEN
      SELECT vault.create_secret(
        v_setting.consumer_key,
        'retivox-platform-daraja-' || v_setting.id || '-consumer-key',
        'Retivox Daraja consumer key',
        NULL
      ) INTO v_consumer_key_id;
    END IF;
    IF v_consumer_secret_id IS NULL AND NULLIF(v_setting.consumer_secret, '') IS NOT NULL THEN
      SELECT vault.create_secret(
        v_setting.consumer_secret,
        'retivox-platform-daraja-' || v_setting.id || '-consumer-secret',
        'Retivox Daraja consumer secret',
        NULL
      ) INTO v_consumer_secret_id;
    END IF;
    IF v_passkey_id IS NULL AND NULLIF(v_setting.passkey, '') IS NOT NULL THEN
      SELECT vault.create_secret(
        v_setting.passkey,
        'retivox-platform-daraja-' || v_setting.id || '-passkey',
        'Retivox Daraja Lipa na M-Pesa passkey',
        NULL
      ) INTO v_passkey_id;
    END IF;

    UPDATE public.platform_payment_settings
       SET consumer_key_secret_id = v_consumer_key_id,
           consumer_secret_secret_id = v_consumer_secret_id,
           passkey_secret_id = v_passkey_id,
           consumer_key = NULL,
           consumer_secret = NULL,
           passkey = NULL
     WHERE id = v_setting.id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_save_daraja_settings(
  p_environment text,
  p_business_shortcode text,
  p_account_reference text,
  p_transaction_type text,
  p_callback_url text,
  p_consumer_key text,
  p_consumer_secret text,
  p_passkey text,
  p_updated_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
DECLARE
  v_setting_id uuid;
  v_consumer_key_id uuid;
  v_consumer_secret_id uuid;
  v_passkey_id uuid;
  v_consumer_key text;
  v_consumer_secret text;
  v_passkey text;
BEGIN
  IF p_environment IS NULL
     OR p_environment NOT IN ('sandbox', 'production')
     OR NULLIF(trim(COALESCE(p_business_shortcode, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_callback_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Enter a valid environment, shortcode, and callback URL';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('retivox_platform_daraja_settings')::bigint);

  SELECT id, consumer_key_secret_id, consumer_secret_secret_id, passkey_secret_id
    INTO v_setting_id, v_consumer_key_id, v_consumer_secret_id, v_passkey_id
    FROM public.platform_payment_settings
   WHERE provider = 'daraja' AND is_active = true
   ORDER BY updated_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_setting_id IS NULL THEN
    UPDATE public.platform_payment_settings
       SET is_active = false
     WHERE provider = 'daraja' AND is_active = true;

    INSERT INTO public.platform_payment_settings (
      provider, environment, business_shortcode, account_reference,
      transaction_type, callback_url, is_active, updated_by
    )
    VALUES (
      'daraja', p_environment, trim(p_business_shortcode),
      COALESCE(NULLIF(trim(p_account_reference), ''), 'RETIVOX'),
      COALESCE(NULLIF(trim(p_transaction_type), ''), 'CustomerPayBillOnline'),
      trim(p_callback_url), true, p_updated_by
    )
    RETURNING id INTO v_setting_id;
  ELSE
    UPDATE public.platform_payment_settings
       SET environment = p_environment,
           business_shortcode = trim(p_business_shortcode),
           account_reference = COALESCE(NULLIF(trim(p_account_reference), ''), 'RETIVOX'),
           transaction_type = COALESCE(NULLIF(trim(p_transaction_type), ''), 'CustomerPayBillOnline'),
           callback_url = trim(p_callback_url),
           updated_by = p_updated_by
     WHERE id = v_setting_id;
  END IF;

  IF NULLIF(trim(COALESCE(p_consumer_key, '')), '') IS NOT NULL THEN
    IF v_consumer_key_id IS NULL THEN
      SELECT vault.create_secret(trim(p_consumer_key), 'retivox-platform-daraja-' || v_setting_id || '-consumer-key', 'Retivox Daraja consumer key', NULL)
        INTO v_consumer_key_id;
    ELSE
      PERFORM vault.update_secret(v_consumer_key_id, trim(p_consumer_key), NULL, NULL, NULL);
    END IF;
  END IF;
  IF NULLIF(trim(COALESCE(p_consumer_secret, '')), '') IS NOT NULL THEN
    IF v_consumer_secret_id IS NULL THEN
      SELECT vault.create_secret(trim(p_consumer_secret), 'retivox-platform-daraja-' || v_setting_id || '-consumer-secret', 'Retivox Daraja consumer secret', NULL)
        INTO v_consumer_secret_id;
    ELSE
      PERFORM vault.update_secret(v_consumer_secret_id, trim(p_consumer_secret), NULL, NULL, NULL);
    END IF;
  END IF;
  IF NULLIF(trim(COALESCE(p_passkey, '')), '') IS NOT NULL THEN
    IF v_passkey_id IS NULL THEN
      SELECT vault.create_secret(trim(p_passkey), 'retivox-platform-daraja-' || v_setting_id || '-passkey', 'Retivox Daraja passkey', NULL)
        INTO v_passkey_id;
    ELSE
      PERFORM vault.update_secret(v_passkey_id, trim(p_passkey), NULL, NULL, NULL);
    END IF;
  END IF;

  SELECT decrypted_secret INTO v_consumer_key FROM vault.decrypted_secrets WHERE id = v_consumer_key_id;
  SELECT decrypted_secret INTO v_consumer_secret FROM vault.decrypted_secrets WHERE id = v_consumer_secret_id;
  SELECT decrypted_secret INTO v_passkey FROM vault.decrypted_secrets WHERE id = v_passkey_id;
  IF NULLIF(v_consumer_key, '') IS NULL OR NULLIF(v_consumer_secret, '') IS NULL OR NULLIF(v_passkey, '') IS NULL THEN
    RAISE EXCEPTION 'Enter each Daraja credential the first time you configure this account';
  END IF;

  UPDATE public.platform_payment_settings
     SET consumer_key_secret_id = v_consumer_key_id,
         consumer_secret_secret_id = v_consumer_secret_id,
         passkey_secret_id = v_passkey_id,
         consumer_key = NULL,
         consumer_secret = NULL,
         passkey = NULL
   WHERE id = v_setting_id;

  RETURN v_setting_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_get_daraja_settings()
RETURNS TABLE(
  environment text,
  business_shortcode text,
  account_reference text,
  transaction_type text,
  callback_url text,
  consumer_key text,
  consumer_secret text,
  passkey text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
  SELECT settings.environment,
         settings.business_shortcode,
         settings.account_reference,
         settings.transaction_type,
         settings.callback_url,
         (SELECT secret.decrypted_secret FROM vault.decrypted_secrets AS secret WHERE secret.id = settings.consumer_key_secret_id),
         (SELECT secret.decrypted_secret FROM vault.decrypted_secrets AS secret WHERE secret.id = settings.consumer_secret_secret_id),
         (SELECT secret.decrypted_secret FROM vault.decrypted_secrets AS secret WHERE secret.id = settings.passkey_secret_id)
    FROM public.platform_payment_settings AS settings
   WHERE settings.provider = 'daraja' AND settings.is_active = true
   ORDER BY settings.updated_at DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.platform_save_daraja_settings(text,text,text,text,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_save_daraja_settings(text,text,text,text,text,text,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.platform_get_daraja_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_get_daraja_settings() TO service_role;

-- Platform email delivery is also configured from the console rather than
-- deployment environment variables. Keep the Resend credential in Vault.
CREATE TABLE IF NOT EXISTS public.platform_email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'resend' CHECK (provider = 'resend'),
  from_email text NOT NULL,
  api_key_secret_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_email_settings_from_email_valid CHECK (position('@' in from_email) > 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_email_settings_one_active
  ON public.platform_email_settings (provider) WHERE is_active = true;
ALTER TABLE public.platform_email_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_email_settings FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS touch_platform_email_settings_updated_at ON public.platform_email_settings;
CREATE TRIGGER touch_platform_email_settings_updated_at
BEFORE UPDATE ON public.platform_email_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.platform_save_email_settings(
  p_from_email text,
  p_api_key text,
  p_updated_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
DECLARE
  v_id uuid;
  v_secret_id uuid;
BEGIN
  IF NULLIF(trim(COALESCE(p_from_email, '')), '') IS NULL
     OR position('@' in trim(p_from_email)) < 2 THEN
    RAISE EXCEPTION 'Enter a valid sender email address';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('retivox_platform_email_settings')::bigint);
  SELECT id, api_key_secret_id INTO v_id, v_secret_id
    FROM public.platform_email_settings
   WHERE provider = 'resend' AND is_active = true
   ORDER BY updated_at DESC LIMIT 1 FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO public.platform_email_settings (provider, from_email, updated_by)
    VALUES ('resend', lower(trim(p_from_email)), p_updated_by)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.platform_email_settings
       SET from_email = lower(trim(p_from_email)), updated_by = p_updated_by
     WHERE id = v_id;
  END IF;

  IF NULLIF(trim(COALESCE(p_api_key, '')), '') IS NOT NULL THEN
    IF v_secret_id IS NULL THEN
      SELECT vault.create_secret(trim(p_api_key), 'retivox-platform-email-' || v_id || '-resend-key', 'Retivox platform Resend API key', NULL)
        INTO v_secret_id;
    ELSE
      PERFORM vault.update_secret(v_secret_id, trim(p_api_key), NULL, NULL, NULL);
    END IF;
  END IF;

  IF v_secret_id IS NULL THEN
    RAISE EXCEPTION 'Enter a Resend API key to complete email setup';
  END IF;

  UPDATE public.platform_email_settings
     SET api_key_secret_id = v_secret_id
   WHERE id = v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_get_email_settings()
RETURNS TABLE(from_email text, api_key_set boolean, is_active boolean, updated_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT settings.from_email,
         EXISTS (SELECT 1 FROM vault.secrets AS secret WHERE secret.id = settings.api_key_secret_id),
         settings.is_active, settings.updated_at
    FROM public.platform_email_settings AS settings
   WHERE settings.provider = 'resend' AND settings.is_active = true
   ORDER BY settings.updated_at DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.platform_get_email_delivery_config()
RETURNS TABLE(from_email text, api_key text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
  SELECT settings.from_email,
         (SELECT secret.decrypted_secret FROM vault.decrypted_secrets AS secret WHERE secret.id = settings.api_key_secret_id)
    FROM public.platform_email_settings AS settings
   WHERE settings.provider = 'resend' AND settings.is_active = true
   ORDER BY settings.updated_at DESC LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.platform_save_email_settings(text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_save_email_settings(text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.platform_get_email_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_get_email_settings() TO service_role;
REVOKE ALL ON FUNCTION public.platform_get_email_delivery_config() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_get_email_delivery_config() TO service_role;
