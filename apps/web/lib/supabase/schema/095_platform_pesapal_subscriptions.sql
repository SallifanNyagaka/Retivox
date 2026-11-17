-- Separate platform Pesapal credentials and subscription checkout from
-- merchant-owned Pesapal settings and POS customer payments.
CREATE TABLE IF NOT EXISTS public.platform_pesapal_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','production')),
  callback_url text NOT NULL CHECK (callback_url ~ '^https://'),
  consumer_key_secret_id uuid,
  consumer_secret_secret_id uuid,
  ipn_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_pesapal_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_pesapal_settings FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.platform_save_pesapal_settings(
  p_environment text,p_callback_url text,p_consumer_key text,p_consumer_secret text,p_updated_by uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,vault AS $$
DECLARE v_key_id uuid; v_secret_id uuid; v_key text; v_secret text; v_ipn uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.platform_users u WHERE u.id=p_updated_by AND u.is_active=true) THEN
    RAISE EXCEPTION 'Active platform administrator required' USING ERRCODE='42501';
  END IF;
  IF p_environment NOT IN ('sandbox','production') OR NULLIF(trim(COALESCE(p_callback_url,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Enter a valid environment and callback URL';
  END IF;
  IF split_part(trim(p_callback_url),'/',1) !~* '^https:' THEN RAISE EXCEPTION 'Pesapal callback must use HTTPS'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('retivox_platform_pesapal_settings')::bigint);
  SELECT consumer_key_secret_id,consumer_secret_secret_id,ipn_id INTO v_key_id,v_secret_id,v_ipn
    FROM public.platform_pesapal_settings WHERE id=true FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.platform_pesapal_settings(id,environment,callback_url,updated_by)
      VALUES(true,p_environment,trim(p_callback_url),p_updated_by);
  ELSE
    UPDATE public.platform_pesapal_settings SET environment=p_environment,callback_url=trim(p_callback_url),updated_by=p_updated_by,
      ipn_id=CASE WHEN callback_url IS DISTINCT FROM trim(p_callback_url) OR environment IS DISTINCT FROM p_environment THEN NULL ELSE ipn_id END
      WHERE id=true;
  END IF;
  IF NULLIF(trim(COALESCE(p_consumer_key,'')),'') IS NOT NULL THEN
    IF v_key_id IS NULL THEN SELECT vault.create_secret(trim(p_consumer_key),'retivox-platform-pesapal-consumer-key','Retivox platform Pesapal consumer key',NULL) INTO v_key_id;
    ELSE PERFORM vault.update_secret(v_key_id,trim(p_consumer_key),NULL,NULL,NULL); END IF;
  END IF;
  IF NULLIF(trim(COALESCE(p_consumer_secret,'')),'') IS NOT NULL THEN
    IF v_secret_id IS NULL THEN SELECT vault.create_secret(trim(p_consumer_secret),'retivox-platform-pesapal-consumer-secret','Retivox platform Pesapal consumer secret',NULL) INTO v_secret_id;
    ELSE PERFORM vault.update_secret(v_secret_id,trim(p_consumer_secret),NULL,NULL,NULL); END IF;
  END IF;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE id=v_key_id;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id=v_secret_id;
  IF NULLIF(v_key,'') IS NULL OR NULLIF(v_secret,'') IS NULL THEN RAISE EXCEPTION 'Enter both Pesapal credentials for first setup'; END IF;
  UPDATE public.platform_pesapal_settings SET consumer_key_secret_id=v_key_id,consumer_secret_secret_id=v_secret_id WHERE id=true;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.platform_get_pesapal_settings()
RETURNS TABLE(environment text,callback_url text,consumer_key text,consumer_secret text,ipn_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,vault AS $$
 SELECT s.environment,s.callback_url,
   (SELECT d.decrypted_secret FROM vault.decrypted_secrets d WHERE d.id=s.consumer_key_secret_id),
   (SELECT d.decrypted_secret FROM vault.decrypted_secrets d WHERE d.id=s.consumer_secret_secret_id),s.ipn_id
 FROM public.platform_pesapal_settings s WHERE s.id=true AND s.is_active=true;
$$;

CREATE OR REPLACE FUNCTION public.platform_get_pesapal_status()
RETURNS TABLE(environment text,callback_url text,credentials_set boolean,ipn_id uuid,updated_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,vault AS $$
 SELECT s.environment,s.callback_url,
   EXISTS(SELECT 1 FROM vault.secrets v WHERE v.id=s.consumer_key_secret_id)
     AND EXISTS(SELECT 1 FROM vault.secrets v WHERE v.id=s.consumer_secret_secret_id),s.ipn_id,s.updated_at
 FROM public.platform_pesapal_settings s WHERE s.id=true AND s.is_active=true;
$$;

CREATE OR REPLACE FUNCTION public.platform_set_pesapal_ipn(p_ipn_id uuid,p_updated_by uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_ipn_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.platform_users WHERE id=p_updated_by AND is_active=true) THEN
    RAISE EXCEPTION 'Active platform administrator and valid IPN id required' USING ERRCODE='42501';
  END IF;
  UPDATE public.platform_pesapal_settings SET ipn_id=p_ipn_id,updated_by=p_updated_by,updated_at=now() WHERE id=true AND is_active=true;
  RETURN FOUND;
END; $$;

REVOKE ALL ON FUNCTION public.platform_save_pesapal_settings(text,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_save_pesapal_settings(text,text,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.platform_get_pesapal_settings() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_get_pesapal_settings() TO service_role;
REVOKE ALL ON FUNCTION public.platform_get_pesapal_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_get_pesapal_status() TO service_role;
REVOKE ALL ON FUNCTION public.platform_set_pesapal_ipn(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_set_pesapal_ipn(uuid,uuid) TO service_role;

ALTER TABLE public.subscription_payment_requests
  ADD COLUMN IF NOT EXISTS pesapal_tracking_id text,
  ADD COLUMN IF NOT EXISTS pesapal_merchant_reference text;
ALTER TABLE public.subscription_payment_requests DROP CONSTRAINT IF EXISTS subscription_payment_requests_method_valid;
ALTER TABLE public.subscription_payment_requests ADD CONSTRAINT subscription_payment_requests_method_valid
  CHECK (payment_method IN ('mpesa_stk','mpesa_manual','bank_transfer','cash_deposit','other','pesapal'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_requests_pesapal_tracking
  ON public.subscription_payment_requests(pesapal_tracking_id) WHERE pesapal_tracking_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_requests_pesapal_reference
  ON public.subscription_payment_requests(pesapal_merchant_reference) WHERE pesapal_merchant_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.owner_prepare_subscription_pesapal_checkout(
  p_plan_key text,p_billing_interval text,p_payer_phone text,p_promotion_code text
)
RETURNS TABLE(payment_request_id uuid,business_id uuid,owner_email text,amount numeric,currency text,merchant_reference text,ipn_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_request_id uuid; v_owner uuid:=auth.uid(); v_business uuid:=public.get_my_business_id(); v_reference text;
  v_payment public.subscription_payment_requests%ROWTYPE; v_ipn uuid; v_email text;
BEGIN
  IF v_owner IS NULL OR v_business IS NULL OR public.get_my_global_role()<>'owner' THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  SELECT s.ipn_id INTO v_ipn FROM public.platform_pesapal_settings s WHERE s.id=true AND s.is_active=true;
  IF v_ipn IS NULL THEN RAISE EXCEPTION 'Platform Pesapal checkout is not configured'; END IF;
  v_reference:='RV-SUB-'||replace(gen_random_uuid()::text,'-','');
  v_request_id:=public.owner_submit_subscription_payment_v2(p_plan_key,p_billing_interval,v_reference,'other',p_payer_phone);
  IF v_request_id IS NULL THEN RETURN; END IF;
  IF NULLIF(trim(COALESCE(p_promotion_code,'')),'') IS NOT NULL THEN
    PERFORM public.owner_apply_subscription_promotion(v_request_id,p_promotion_code);
  END IF;
  SELECT * INTO v_payment FROM public.subscription_payment_requests WHERE id=v_request_id AND business_id=v_business FOR UPDATE;
  SELECT u.email INTO v_email FROM public.users u WHERE u.id=v_owner AND u.business_id=v_business;
  IF v_payment.status='verified' OR v_payment.amount<=0 THEN RETURN; END IF;
  IF v_payment.status<>'pending' THEN RAISE EXCEPTION 'Subscription payment is not payable'; END IF;
  UPDATE public.subscription_payment_requests SET provider='pesapal',payment_method='pesapal',pesapal_merchant_reference=v_reference,reference_code=v_reference
    WHERE id=v_request_id AND business_id=v_business AND status='pending';
  RETURN QUERY SELECT v_request_id,v_business,v_email,v_payment.amount,v_payment.currency,v_reference,v_ipn;
END; $$;

CREATE OR REPLACE FUNCTION public.record_platform_pesapal_subscription_result(
  p_tracking_id text,p_merchant_reference text,p_status_code integer,p_status_description text,
  p_paid_amount numeric,p_currency text,p_confirmation_code text,p_payload jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_request public.subscription_payment_requests%ROWTYPE; v_event text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(COALESCE(p_tracking_id,'')),'') IS NULL OR length(p_tracking_id)>128 OR p_status_code IS NULL THEN RAISE EXCEPTION 'Invalid Pesapal result'; END IF;
  v_event:='subscription-pesapal:'||trim(p_tracking_id)||':'||p_status_code::text;
  INSERT INTO public.provider_webhook_events(provider,event_id,result) VALUES('pesapal_platform',v_event,'received') ON CONFLICT(provider,event_id) DO NOTHING;
  IF NOT FOUND THEN RETURN true; END IF;
  SELECT * INTO v_request FROM public.subscription_payment_requests WHERE pesapal_tracking_id=trim(p_tracking_id) FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.provider_webhook_events SET result='unmatched',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event;
    RETURN false;
  END IF;
  IF v_request.pesapal_merchant_reference IS DISTINCT FROM p_merchant_reference THEN
    UPDATE public.subscription_payment_requests SET review_note='Pesapal merchant reference mismatch; manual review required',provider_result_description='Provider reference mismatch' WHERE id=v_request.id;
    UPDATE public.provider_webhook_events SET business_id=v_request.business_id,result='merchant_reference_mismatch',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event;
    RETURN false;
  END IF;
  IF p_status_code=1 AND upper(COALESCE(p_status_description,''))='COMPLETED' THEN
    IF p_paid_amount IS NULL OR round(p_paid_amount,2)<>round(v_request.amount,2)
       OR upper(COALESCE(p_currency,''))<>upper(COALESCE(v_request.currency,''))
       OR NULLIF(trim(COALESCE(p_confirmation_code,'')),'') IS NULL THEN
      UPDATE public.subscription_payment_requests SET review_note='Pesapal amount, currency, or receipt mismatch; manual review required',provider_result_description='Payment details mismatch' WHERE id=v_request.id;
      UPDATE public.provider_webhook_events SET business_id=v_request.business_id,result='payment_mismatch',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event;
      RETURN false;
    END IF;
    IF v_request.status='pending' THEN
      UPDATE public.subscription_payment_requests SET status='verified',provider='pesapal',provider_result_code=p_status_code,
        provider_result_description='Pesapal payment verified',provider_receipt_number=trim(p_confirmation_code),
        provider_paid_amount=p_paid_amount,paid_at=now(),raw_provider_payload=p_payload,review_note='Automatically verified with Pesapal'
        WHERE id=v_request.id;
      IF NOT public.platform_apply_subscription_payment(v_request.id) THEN RAISE EXCEPTION 'Subscription license could not be applied'; END IF;
    END IF;
    UPDATE public.provider_webhook_events SET business_id=v_request.business_id,result='verified',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event;
  ELSIF p_status_code=2 OR p_status_code=3 THEN
    IF v_request.status='pending' THEN
      UPDATE public.subscription_payment_requests SET status='rejected',provider_result_code=p_status_code,
        provider_result_description=left(COALESCE(p_status_description,'Pesapal payment not completed'),500),raw_provider_payload=p_payload,reviewed_at=now()
        WHERE id=v_request.id;
    ELSIF p_status_code=3 AND v_request.status='verified' AND v_request.license_applied_at IS NOT NULL THEN
      UPDATE public.subscriptions SET status='past_due' WHERE id=v_request.subscription_id AND business_id=v_request.business_id AND license_type<>'lifetime';
      UPDATE public.businesses SET subscription_status='past_due' WHERE id=v_request.business_id;
      UPDATE public.subscription_payment_requests SET review_note='Pesapal reversal received after license activation; access moved to grace period for platform review',
        provider_result_code=p_status_code,provider_result_description='Provider reversal received',raw_provider_payload=p_payload WHERE id=v_request.id;
    END IF;
    UPDATE public.provider_webhook_events SET business_id=v_request.business_id,result=CASE WHEN p_status_code=3 THEN 'reversed' ELSE 'not_completed' END,processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event;
  ELSE
    UPDATE public.subscription_payment_requests SET review_note='Pesapal returned an invalid or unknown status; payment remains pending',
      provider_result_code=p_status_code,provider_result_description=left(COALESCE(p_status_description,'Unrecognized Pesapal status'),500),raw_provider_payload=p_payload WHERE id=v_request.id AND status='pending';
    UPDATE public.provider_webhook_events SET business_id=v_request.business_id,result='pending_review',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event;
  END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.platform_apply_subscription_payment(p_payment_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_payment public.subscription_payment_requests%ROWTYPE; v_subscription public.subscriptions%ROWTYPE;
  v_event_type text; v_period_start timestamptz; v_provider text;
BEGIN
  SELECT * INTO v_payment FROM public.subscription_payment_requests WHERE id=p_payment_request_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status<>'verified' OR v_payment.license_applied_at IS NOT NULL
     OR v_payment.plan_key IS NULL OR v_payment.plan_price_amount IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_subscription FROM public.subscriptions WHERE id=v_payment.subscription_id AND business_id=v_payment.business_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  v_provider:=CASE WHEN v_payment.provider='pesapal' THEN 'pesapal' WHEN v_payment.payment_method='mpesa_stk' THEN 'daraja' ELSE 'manual' END;
  IF v_payment.billing_interval='lifetime' THEN
    v_event_type:=CASE WHEN v_subscription.license_type='lifetime' THEN 'lifetime_upgraded' ELSE 'lifetime_purchased' END;
    UPDATE public.subscriptions SET plan=v_payment.plan_key,status='active',license_type='lifetime',billing_interval='lifetime',
      monthly_amount=v_payment.plan_monthly_amount,paid_period_amount=0,
      lifetime_purchase_credit=CASE WHEN v_subscription.license_type='lifetime' THEN v_subscription.lifetime_purchase_credit+v_payment.amount ELSE v_payment.amount END,
      currency=v_payment.currency,payment_provider=v_provider,current_period_start=now(),current_period_end=NULL,cancelled_at=NULL,
      next_plan_key=NULL,next_billing_interval=NULL,next_monthly_amount=NULL,next_currency=NULL,next_payment_provider=NULL,next_period_start=NULL,next_period_amount=NULL
      WHERE id=v_subscription.id;
  ELSIF v_subscription.license_type='lifetime' THEN RETURN false;
  ELSIF v_payment.purchase_kind='subscription' AND v_subscription.current_period_end>now() THEN
    UPDATE public.subscriptions SET next_plan_key=v_payment.plan_key,next_billing_interval=v_payment.billing_interval,
      next_monthly_amount=v_payment.plan_monthly_amount,next_currency=v_payment.currency,next_payment_provider=v_provider,
      next_period_start=v_subscription.current_period_end,next_period_amount=v_payment.plan_price_amount WHERE id=v_subscription.id;
    v_event_type:='subscription_renewed';
  ELSE
    v_period_start:=now();
    UPDATE public.subscriptions SET plan=v_payment.plan_key,status='active',license_type='subscription',billing_interval=v_payment.billing_interval,
      monthly_amount=v_payment.plan_monthly_amount,paid_period_amount=v_payment.plan_price_amount,currency=v_payment.currency,
      payment_provider=v_provider,current_period_start=v_period_start,
      current_period_end=v_period_start+CASE WHEN v_payment.billing_interval='yearly' THEN interval '1 year' ELSE interval '1 month' END,
      cancelled_at=NULL,next_plan_key=NULL,next_billing_interval=NULL,next_monthly_amount=NULL,next_currency=NULL,
      next_payment_provider=NULL,next_period_start=NULL,next_period_amount=NULL WHERE id=v_subscription.id;
    v_event_type:=CASE WHEN v_payment.purchase_kind='plan_upgrade' THEN 'plan_upgraded' ELSE 'subscription_started' END;
  END IF;
  UPDATE public.businesses SET subscription_plan=v_payment.plan_key,subscription_status='active' WHERE id=v_payment.business_id;
  INSERT INTO public.subscription_license_events(business_id,subscription_id,payment_request_id,actor_user_id,event_type,
    from_plan,to_plan,from_interval,to_interval,paid_amount,credit_applied,reason)
    VALUES(v_payment.business_id,v_subscription.id,v_payment.id,v_payment.submitted_by,v_event_type,v_subscription.plan,
      v_payment.plan_key,v_subscription.billing_interval,v_payment.billing_interval,v_payment.amount,v_payment.credit_applied,
      'Verified subscription payment applied');
  UPDATE public.subscription_payment_requests SET license_applied_at=now() WHERE id=v_payment.id;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.platform_apply_subscription_payment(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_apply_subscription_payment(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.owner_prepare_subscription_pesapal_checkout(text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_prepare_subscription_pesapal_checkout(text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_platform_pesapal_subscription_result(text,text,integer,text,numeric,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_platform_pesapal_subscription_result(text,text,integer,text,numeric,text,text,jsonb) TO service_role;
