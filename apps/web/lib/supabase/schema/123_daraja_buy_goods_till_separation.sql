-- Store the Daraja Store/API shortcode and customer-facing Buy Goods Till
-- independently. Existing credentials remain in Vault and are not rewritten.
ALTER TABLE public.platform_payment_settings
  ADD COLUMN IF NOT EXISTS till_number text;

ALTER TABLE public.business_payment_provider_settings
  ADD COLUMN IF NOT EXISTS till_number text;

-- This platform merchant mapping was confirmed from Safaricom's production
-- credentials email. Do not infer or backfill Till values for tenant accounts.
UPDATE public.platform_payment_settings
   SET till_number = '1773827'
 WHERE provider = 'daraja'
   AND environment = 'production'
   AND business_shortcode = '1303513'
   AND transaction_type = 'CustomerBuyGoodsOnline'
   AND NULLIF(trim(till_number), '') IS NULL;

CREATE OR REPLACE FUNCTION public.platform_save_daraja_settings_v2(
  p_environment text,
  p_business_shortcode text,
  p_till_number text,
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
  v_id uuid;
  v_key_id uuid;
  v_secret_id uuid;
  v_passkey_id uuid;
  v_key text;
  v_secret text;
  v_passkey text;
BEGIN
  IF p_environment IS NULL OR p_environment NOT IN ('sandbox', 'production')
     OR NULLIF(trim(COALESCE(p_business_shortcode, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_callback_url, '')), '') IS NULL
     OR COALESCE(p_transaction_type, 'CustomerPayBillOnline') NOT IN ('CustomerPayBillOnline', 'CustomerBuyGoodsOnline')
     OR (p_transaction_type = 'CustomerBuyGoodsOnline' AND NULLIF(trim(COALESCE(p_till_number, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'Enter valid Daraja Store/API shortcode, Buy Goods Till when applicable, and callback URL';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('retivox_platform_daraja_settings')::bigint);
  SELECT id, consumer_key_secret_id, consumer_secret_secret_id, passkey_secret_id
    INTO v_id, v_key_id, v_secret_id, v_passkey_id
    FROM public.platform_payment_settings
   WHERE provider = 'daraja' AND is_active
   ORDER BY updated_at DESC LIMIT 1 FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO public.platform_payment_settings (
      provider, environment, business_shortcode, till_number, account_reference,
      transaction_type, callback_url, is_active, updated_by
    ) VALUES (
      'daraja', p_environment, trim(p_business_shortcode), NULLIF(trim(COALESCE(p_till_number, '')), ''),
      COALESCE(NULLIF(trim(p_account_reference), ''), 'RETIVOX'),
      COALESCE(NULLIF(trim(p_transaction_type), ''), 'CustomerPayBillOnline'), trim(p_callback_url), true, p_updated_by
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.platform_payment_settings
       SET environment = p_environment,
           business_shortcode = trim(p_business_shortcode),
           till_number = NULLIF(trim(COALESCE(p_till_number, '')), ''),
           account_reference = COALESCE(NULLIF(trim(p_account_reference), ''), 'RETIVOX'),
           transaction_type = COALESCE(NULLIF(trim(p_transaction_type), ''), 'CustomerPayBillOnline'),
           callback_url = trim(p_callback_url), updated_by = p_updated_by
     WHERE id = v_id;
  END IF;

  IF NULLIF(trim(COALESCE(p_consumer_key, '')), '') IS NOT NULL THEN
    IF v_key_id IS NULL THEN
      SELECT vault.create_secret(trim(p_consumer_key), 'retivox-platform-daraja-' || v_id || '-consumer-key', 'Retivox Daraja consumer key', NULL) INTO v_key_id;
    ELSE PERFORM vault.update_secret(v_key_id, trim(p_consumer_key), NULL, NULL, NULL); END IF;
  END IF;
  IF NULLIF(trim(COALESCE(p_consumer_secret, '')), '') IS NOT NULL THEN
    IF v_secret_id IS NULL THEN
      SELECT vault.create_secret(trim(p_consumer_secret), 'retivox-platform-daraja-' || v_id || '-consumer-secret', 'Retivox Daraja consumer secret', NULL) INTO v_secret_id;
    ELSE PERFORM vault.update_secret(v_secret_id, trim(p_consumer_secret), NULL, NULL, NULL); END IF;
  END IF;
  IF NULLIF(trim(COALESCE(p_passkey, '')), '') IS NOT NULL THEN
    IF v_passkey_id IS NULL THEN
      SELECT vault.create_secret(trim(p_passkey), 'retivox-platform-daraja-' || v_id || '-passkey', 'Retivox Daraja passkey', NULL) INTO v_passkey_id;
    ELSE PERFORM vault.update_secret(v_passkey_id, trim(p_passkey), NULL, NULL, NULL); END IF;
  END IF;

  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE id = v_key_id;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id = v_secret_id;
  SELECT decrypted_secret INTO v_passkey FROM vault.decrypted_secrets WHERE id = v_passkey_id;
  IF NULLIF(v_key, '') IS NULL OR NULLIF(v_secret, '') IS NULL OR NULLIF(v_passkey, '') IS NULL THEN
    RAISE EXCEPTION 'Enter all Daraja credentials on first setup';
  END IF;
  UPDATE public.platform_payment_settings
     SET consumer_key_secret_id = v_key_id, consumer_secret_secret_id = v_secret_id,
         passkey_secret_id = v_passkey_id, consumer_key = NULL, consumer_secret = NULL, passkey = NULL
   WHERE id = v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_get_daraja_settings_v2()
RETURNS TABLE(
  environment text, business_shortcode text, till_number text, account_reference text,
  transaction_type text, callback_url text, consumer_key text, consumer_secret text, passkey text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
  SELECT s.environment, s.business_shortcode, s.till_number, s.account_reference,
         s.transaction_type, s.callback_url,
         (SELECT d.decrypted_secret FROM vault.decrypted_secrets d WHERE d.id = s.consumer_key_secret_id),
         (SELECT d.decrypted_secret FROM vault.decrypted_secrets d WHERE d.id = s.consumer_secret_secret_id),
         (SELECT d.decrypted_secret FROM vault.decrypted_secrets d WHERE d.id = s.passkey_secret_id)
    FROM public.platform_payment_settings s
   WHERE s.provider = 'daraja' AND s.is_active
   ORDER BY s.updated_at DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.owner_save_payment_provider_settings_v2(
  p_business_id uuid, p_updated_by uuid, p_provider text, p_environment text,
  p_business_shortcode text, p_till_number text, p_account_reference text,
  p_transaction_type text, p_callback_url text, p_consumer_key text,
  p_consumer_secret text, p_passkey text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
DECLARE
  v_id uuid; v_key_id uuid; v_secret_id uuid; v_passkey_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_updated_by AND business_id = p_business_id
      AND global_role = 'owner' AND is_active AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Only an active business owner can configure payment providers'; END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('daraja', 'pesapal')
     OR p_environment IS NULL OR p_environment NOT IN ('sandbox', 'production')
     OR NULLIF(trim(COALESCE(p_callback_url, '')), '') IS NULL
     OR (p_provider = 'daraja' AND COALESCE(p_transaction_type, 'CustomerPayBillOnline') NOT IN ('CustomerPayBillOnline', 'CustomerBuyGoodsOnline'))
     OR (p_provider = 'daraja' AND (NULLIF(trim(COALESCE(p_business_shortcode, '')), '') IS NULL
       OR (p_transaction_type = 'CustomerBuyGoodsOnline' AND NULLIF(trim(COALESCE(p_till_number, '')), '') IS NULL))) THEN
    RAISE EXCEPTION 'Enter the required payment provider settings';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_business_id::text || ':' || p_provider)::bigint);
  SELECT id, consumer_key_secret_id, consumer_secret_secret_id, passkey_secret_id
    INTO v_id, v_key_id, v_secret_id, v_passkey_id
    FROM public.business_payment_provider_settings
   WHERE business_id = p_business_id AND provider = p_provider FOR UPDATE;
  IF v_id IS NULL THEN
    INSERT INTO public.business_payment_provider_settings (
      business_id, provider, environment, business_shortcode, till_number, account_reference,
      transaction_type, callback_url, updated_by
    ) VALUES (
      p_business_id, p_provider, p_environment, NULLIF(trim(COALESCE(p_business_shortcode, '')), ''),
      NULLIF(trim(COALESCE(p_till_number, '')), ''), COALESCE(NULLIF(trim(p_account_reference), ''), 'RETIVOX'),
      COALESCE(NULLIF(trim(p_transaction_type), ''), 'CustomerPayBillOnline'), trim(p_callback_url), p_updated_by
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.business_payment_provider_settings
       SET environment = p_environment,
           business_shortcode = NULLIF(trim(COALESCE(p_business_shortcode, '')), ''),
           till_number = NULLIF(trim(COALESCE(p_till_number, '')), ''),
           account_reference = COALESCE(NULLIF(trim(p_account_reference), ''), 'RETIVOX'),
           transaction_type = COALESCE(NULLIF(trim(COALESCE(p_transaction_type, '')), ''), 'CustomerPayBillOnline'),
           callback_url = trim(p_callback_url), is_active = true, updated_by = p_updated_by
     WHERE id = v_id;
  END IF;
  IF NULLIF(trim(COALESCE(p_consumer_key, '')), '') IS NOT NULL THEN
    IF v_key_id IS NULL THEN
      SELECT vault.create_secret(trim(p_consumer_key), 'retivox-business-' || p_business_id || '-' || p_provider || '-key', 'Retivox merchant payment provider key', NULL) INTO v_key_id;
    ELSE PERFORM vault.update_secret(v_key_id, trim(p_consumer_key), NULL, NULL, NULL); END IF;
  END IF;
  IF NULLIF(trim(COALESCE(p_consumer_secret, '')), '') IS NOT NULL THEN
    IF v_secret_id IS NULL THEN
      SELECT vault.create_secret(trim(p_consumer_secret), 'retivox-business-' || p_business_id || '-' || p_provider || '-secret', 'Retivox merchant payment provider secret', NULL) INTO v_secret_id;
    ELSE PERFORM vault.update_secret(v_secret_id, trim(p_consumer_secret), NULL, NULL, NULL); END IF;
  END IF;
  IF p_provider = 'daraja' AND NULLIF(trim(COALESCE(p_passkey, '')), '') IS NOT NULL THEN
    IF v_passkey_id IS NULL THEN
      SELECT vault.create_secret(trim(p_passkey), 'retivox-business-' || p_business_id || '-daraja-passkey', 'Retivox merchant Daraja passkey', NULL) INTO v_passkey_id;
    ELSE PERFORM vault.update_secret(v_passkey_id, trim(p_passkey), NULL, NULL, NULL); END IF;
  END IF;
  IF v_key_id IS NULL OR v_secret_id IS NULL OR (p_provider = 'daraja' AND v_passkey_id IS NULL) THEN
    RAISE EXCEPTION 'Enter required provider credentials on first setup';
  END IF;
  UPDATE public.business_payment_provider_settings
     SET consumer_key_secret_id = v_key_id, consumer_secret_secret_id = v_secret_id, passkey_secret_id = v_passkey_id
   WHERE id = v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_my_payment_provider_settings_v2(p_business_id uuid, p_actor_id uuid)
RETURNS TABLE(
  provider text, environment text, business_shortcode text, till_number text, account_reference text,
  transaction_type text, callback_url text, consumer_key_set boolean, consumer_secret_set boolean,
  passkey_set boolean, is_active boolean, updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, vault
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND business_id = p_business_id
      AND global_role = 'owner' AND is_active AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY SELECT s.provider, s.environment, s.business_shortcode, s.till_number,
    s.account_reference, s.transaction_type, s.callback_url,
    EXISTS(SELECT 1 FROM vault.secrets x WHERE x.id = s.consumer_key_secret_id),
    EXISTS(SELECT 1 FROM vault.secrets x WHERE x.id = s.consumer_secret_secret_id),
    EXISTS(SELECT 1 FROM vault.secrets x WHERE x.id = s.passkey_secret_id), s.is_active, s.updated_at
    FROM public.business_payment_provider_settings s WHERE s.business_id = p_business_id ORDER BY s.provider;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_get_payment_provider_config_v2(p_business_id uuid, p_actor_id uuid, p_provider text)
RETURNS TABLE(
  provider text, environment text, business_shortcode text, till_number text, account_reference text,
  transaction_type text, callback_url text, consumer_key text, consumer_secret text, passkey text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, vault
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND business_id = p_business_id
      AND global_role = 'owner' AND is_active AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY SELECT s.provider, s.environment, s.business_shortcode, s.till_number,
    s.account_reference, s.transaction_type, s.callback_url,
    (SELECT d.decrypted_secret FROM vault.decrypted_secrets d WHERE d.id = s.consumer_key_secret_id),
    (SELECT d.decrypted_secret FROM vault.decrypted_secrets d WHERE d.id = s.consumer_secret_secret_id),
    (SELECT d.decrypted_secret FROM vault.decrypted_secrets d WHERE d.id = s.passkey_secret_id)
    FROM public.business_payment_provider_settings s
    WHERE s.business_id = p_business_id AND s.provider = p_provider AND s.is_active;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_save_daraja_settings_v2(text,text,text,text,text,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_save_daraja_settings_v2(text,text,text,text,text,text,text,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.platform_get_daraja_settings_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_get_daraja_settings_v2() TO service_role;
REVOKE ALL ON FUNCTION public.owner_save_payment_provider_settings_v2(uuid,uuid,text,text,text,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_save_payment_provider_settings_v2(uuid,uuid,text,text,text,text,text,text,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.owner_my_payment_provider_settings_v2(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_my_payment_provider_settings_v2(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.owner_get_payment_provider_config_v2(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_get_payment_provider_config_v2(uuid,uuid,text) TO service_role;

-- A final nonzero Daraja callback is failed, and later callbacks cannot reverse
-- a verified or rejected payment. Event IDs remain checkout/result-code scoped.
CREATE OR REPLACE FUNCTION public.record_business_daraja_stk_result(
  p_checkout_request_id text, p_merchant_request_id text, p_result_code integer,
  p_result_description text, p_receipt text, p_paid_amount numeric, p_phone text, p_raw_payload jsonb
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_phone text;
  v_event_id text;
  v_old_result text;
  v_payload jsonb := COALESCE(p_raw_payload, '{}'::jsonb);
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF NULLIF(trim(COALESCE(p_checkout_request_id, '')), '') IS NULL OR length(p_checkout_request_id) > 128
     OR p_result_code IS NULL OR jsonb_typeof(v_payload) <> 'object' THEN RAISE EXCEPTION 'Invalid checkout callback'; END IF;
  v_event_id := 'stk:' || p_checkout_request_id || ':' || p_result_code::text;
  INSERT INTO public.provider_webhook_events(provider, event_id, result, provider_payload)
    VALUES ('daraja', v_event_id, 'received', v_payload) ON CONFLICT(provider, event_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT result INTO v_old_result FROM public.provider_webhook_events WHERE provider='daraja' AND event_id=v_event_id;
    IF v_old_result='unmatched' THEN
      UPDATE public.provider_webhook_events SET result='retrying_unmatched', processed_at=NULL, provider_payload=v_payload
       WHERE provider='daraja' AND event_id=v_event_id;
    ELSIF v_old_result IN ('payment_mismatch','merchant_request_mismatch','invalid_payment_method') THEN RETURN false;
    ELSE RETURN true;
    END IF;
  END IF;

  SELECT * INTO v_payment FROM public.payments
   WHERE provider='daraja' AND mpesa_checkout_id=p_checkout_request_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.provider_webhook_events SET result='unmatched', processed_at=now(), provider_payload=v_payload
     WHERE provider='daraja' AND event_id=v_event_id;
    RETURN false;
  END IF;
  IF v_payment.payment_method <> 'mpesa_stk' THEN
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id, result='invalid_payment_method', processed_at=now(), provider_payload=v_payload
     WHERE provider='daraja' AND event_id=v_event_id;
    RETURN false;
  END IF;
  IF v_payment.status IN ('verified','rejected','voided') THEN
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id, result='already_terminal', processed_at=now(), provider_payload=v_payload
     WHERE provider='daraja' AND event_id=v_event_id;
    RETURN true;
  END IF;
  IF v_payment.provider_merchant_request_id IS NOT NULL AND p_merchant_request_id IS DISTINCT FROM v_payment.provider_merchant_request_id THEN
    UPDATE public.payments SET reconciliation_status='needs_review' WHERE id=v_payment.id;
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id, result='merchant_request_mismatch', processed_at=now(), provider_payload=v_payload
     WHERE provider='daraja' AND event_id=v_event_id;
    RETURN false;
  END IF;

  IF p_result_code=0 THEN
    v_phone := regexp_replace(trim(COALESCE(p_phone,'')), '[^0-9]', '', 'g');
    IF left(v_phone,1)='0' THEN v_phone := '254' || substr(v_phone,2);
    ELSIF length(v_phone)=9 THEN v_phone := '254' || v_phone; END IF;
    IF NULLIF(trim(COALESCE(p_receipt,'')), '') IS NULL OR p_paid_amount IS NULL
       OR round(p_paid_amount,2) <> round(v_payment.amount,2)
       OR v_phone IS DISTINCT FROM v_payment.provider_phone THEN
      UPDATE public.payments SET reconciliation_status='needs_review' WHERE id=v_payment.id;
      UPDATE public.provider_webhook_events SET business_id=v_payment.business_id, result='payment_mismatch', processed_at=now(), provider_payload=v_payload
       WHERE provider='daraja' AND event_id=v_event_id;
      RETURN false;
    END IF;
    UPDATE public.payments SET status='verified', provider_transaction_id=trim(p_receipt), mpesa_ref_code=trim(p_receipt),
      reference_code=trim(p_receipt), verified_at=now(), reconciliation_status='matched' WHERE id=v_payment.id;
    UPDATE public.transactions t SET status='verified'
     WHERE t.id=v_payment.transaction_id AND t.business_id=v_payment.business_id
       AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.transaction_id=t.id AND p.business_id=t.business_id AND p.status NOT IN ('verified','voided'));
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id, result='verified', processed_at=now(), provider_payload=v_payload
     WHERE provider='daraja' AND event_id=v_event_id;
  ELSE
    UPDATE public.payments SET status='rejected', reconciliation_status='needs_review',
      reference_code=left(COALESCE(p_result_description,'Daraja payment failed'),180)
     WHERE id=v_payment.id AND status NOT IN ('verified','rejected','voided');
    UPDATE public.provider_webhook_events SET business_id=v_payment.business_id, result='failed', processed_at=now(), provider_payload=v_payload
     WHERE provider='daraja' AND event_id=v_event_id;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_business_daraja_stk_result(text,text,integer,text,text,numeric,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_business_daraja_stk_result(text,text,integer,text,text,numeric,text,jsonb) TO service_role;
