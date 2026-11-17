-- Optional customer-authorized Pesapal card renewals. Manual renewal remains
-- the default; recurring charges are accepted only after verified IPN status,
-- matching account/correlation identity, amount, currency, and price snapshot.
ALTER TABLE public.subscription_payment_requests
  ADD COLUMN IF NOT EXISTS auto_renew_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pesapal_account_reference text,
  ADD COLUMN IF NOT EXISTS pesapal_recurring_start_date date,
  ADD COLUMN IF NOT EXISTS pesapal_recurring_end_date date;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS auto_renew_status text NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS auto_renew_account_reference text,
  ADD COLUMN IF NOT EXISTS auto_renew_correlation_id text,
  ADD COLUMN IF NOT EXISTS auto_renew_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS auto_renew_plan_key text,
  ADD COLUMN IF NOT EXISTS auto_renew_billing_interval text;

-- Prior versions exposed this flag without a provider authorization workflow.
-- Do not assume an old true value means a customer has authorized card charges.
UPDATE public.subscriptions SET auto_renew_enabled=false
 WHERE auto_renew_account_reference IS NULL AND auto_renew_enabled=true;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_auto_renew_status_valid;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_auto_renew_status_valid
  CHECK (auto_renew_status IN ('disabled','pending_enrollment','active','cancel_requested','cancelled','payment_failed','reauthorization_required'));
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_auto_renew_interval_valid;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_auto_renew_interval_valid
  CHECK (auto_renew_billing_interval IS NULL OR auto_renew_billing_interval IN ('monthly','yearly'));
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_pesapal_auto_renew_reference_uidx
  ON public.subscriptions(auto_renew_account_reference) WHERE auto_renew_account_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.platform_pesapal_recurring_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  tracking_id text NOT NULL UNIQUE,
  account_reference text NOT NULL,
  correlation_id text,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL,
  payment_method text,
  status text NOT NULL CHECK (status IN ('received','verified','failed','review','reversed')),
  payment_request_id uuid REFERENCES public.subscription_payment_requests(id) ON DELETE SET NULL,
  provider_receipt_number text,
  review_note text,
  raw_provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS platform_pesapal_recurring_business_time_idx
  ON public.platform_pesapal_recurring_charges(business_id,received_at DESC);
ALTER TABLE public.platform_pesapal_recurring_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_pesapal_recurring_charges FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.sync_platform_pesapal_auto_renew_enrollment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_account_reference text; v_correlation_id text;
BEGIN
  IF NEW.auto_renew_requested AND NEW.status='verified' THEN
    v_account_reference:=NULLIF(trim(COALESCE(NEW.raw_provider_payload->'subscription_transaction_info'->>'account_reference','')),'');
    v_correlation_id:=NULLIF(trim(COALESCE(NEW.raw_provider_payload->'subscription_transaction_info'->>'correlation_id','')),'');
    IF v_account_reference=NEW.pesapal_account_reference AND v_correlation_id IS NOT NULL THEN
      UPDATE public.subscriptions SET auto_renew_enabled=true,auto_renew_status='active',
        auto_renew_correlation_id=v_correlation_id WHERE id=NEW.subscription_id
          AND auto_renew_account_reference=NEW.pesapal_account_reference;
    END IF;
  ELSIF NEW.auto_renew_requested AND NEW.status='rejected' THEN
    UPDATE public.subscriptions SET auto_renew_enabled=false,auto_renew_status='disabled',
      auto_renew_account_reference=NULL,auto_renew_correlation_id=NULL,auto_renew_amount=NULL,
      auto_renew_plan_key=NULL,auto_renew_billing_interval=NULL
      WHERE id=NEW.subscription_id AND auto_renew_account_reference=NEW.pesapal_account_reference
        AND auto_renew_status='pending_enrollment';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS sync_platform_pesapal_auto_renew_enrollment ON public.subscription_payment_requests;
CREATE TRIGGER sync_platform_pesapal_auto_renew_enrollment
AFTER UPDATE OF status,raw_provider_payload ON public.subscription_payment_requests
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.raw_provider_payload IS DISTINCT FROM NEW.raw_provider_payload)
EXECUTE FUNCTION public.sync_platform_pesapal_auto_renew_enrollment();
REVOKE ALL ON FUNCTION public.sync_platform_pesapal_auto_renew_enrollment() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.owner_prepare_subscription_pesapal_checkout_v2(
  p_plan_key text,p_billing_interval text,p_payer_phone text,p_promotion_code text,p_auto_renew boolean DEFAULT false
)
RETURNS TABLE(
  payment_request_id uuid,business_id uuid,owner_email text,amount numeric,currency text,
  merchant_reference text,ipn_id uuid,auto_renew_requested boolean,account_reference text,
  recurring_start_date date,recurring_end_date date,recurring_frequency text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_checkout record; v_payment public.subscription_payment_requests%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE; v_business uuid:=public.get_my_business_id();
  v_account_reference text; v_period_start timestamptz; v_period_end timestamptz;
  v_start_date date; v_end_date date; v_frequency text; v_timezone text;
BEGIN
  SELECT * INTO v_checkout FROM public.owner_prepare_subscription_pesapal_checkout(
    p_plan_key,p_billing_interval,p_payer_phone,p_promotion_code
  );
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_payment FROM public.subscription_payment_requests
    WHERE id=v_checkout.payment_request_id AND business_id=v_business FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription payment request could not be loaded'; END IF;
  IF NOT COALESCE(p_auto_renew,false) THEN
    RETURN QUERY SELECT v_checkout.payment_request_id,v_checkout.business_id,v_checkout.owner_email,
      v_checkout.amount,v_checkout.currency,v_checkout.merchant_reference,v_checkout.ipn_id,
      false::boolean,NULL::text,NULL::date,NULL::date,NULL::text;
    RETURN;
  END IF;
  IF p_billing_interval NOT IN ('monthly','yearly') OR v_payment.purchase_kind<>'subscription' THEN
    RAISE EXCEPTION 'Automatic renewal is available only for monthly or yearly subscriptions';
  END IF;
  IF NULLIF(trim(COALESCE(p_promotion_code,'')),'') IS NOT NULL OR v_payment.credit_applied<>0
     OR v_payment.discount_amount<>0 OR v_payment.plan_price_amount IS NULL
     OR round(v_payment.amount,2)<>round(v_payment.plan_price_amount,2) THEN
    RAISE EXCEPTION 'Automatic renewal requires a full-price payment without a promotion or one-time subscription credit';
  END IF;
  SELECT * INTO v_subscription FROM public.subscriptions
    WHERE id=v_payment.subscription_id AND business_id=v_business FOR UPDATE;
  IF NOT FOUND OR v_subscription.license_type='lifetime' THEN
    RAISE EXCEPTION 'Automatic renewal is not available for this license';
  END IF;
  IF v_subscription.auto_renew_status IN ('pending_enrollment','active','cancel_requested') THEN
    RAISE EXCEPTION 'A Pesapal automatic renewal schedule is already pending or active. Cancel it with Pesapal before enrolling again.';
  END IF;
  v_account_reference:='RV-AUTO-'||replace(v_business::text,'-','');
  v_frequency:=upper(p_billing_interval);
  v_period_start:=CASE WHEN v_payment.purchase_kind='subscription' AND v_subscription.current_period_end>now()
    THEN v_subscription.current_period_end ELSE now() END;
  v_period_end:=v_period_start+CASE WHEN p_billing_interval='yearly' THEN interval '1 year' ELSE interval '1 month' END;
  SELECT COALESCE(NULLIF(b.timezone,''),'UTC') INTO v_timezone FROM public.businesses b WHERE b.id=v_business;
  v_start_date:=((v_period_end AT TIME ZONE COALESCE(v_timezone,'UTC'))::date-1);
  v_end_date:=(v_start_date+interval '5 years')::date;
  IF v_start_date<=((now() AT TIME ZONE COALESCE(v_timezone,'UTC'))::date) THEN
    RAISE EXCEPTION 'Automatic renewal date is too close; complete a manual renewal and enable automatic renewal on the next checkout';
  END IF;
  UPDATE public.subscription_payment_requests SET auto_renew_requested=true,
    pesapal_account_reference=v_account_reference,pesapal_recurring_start_date=v_start_date,
    pesapal_recurring_end_date=v_end_date WHERE id=v_payment.id;
  UPDATE public.subscriptions SET auto_renew_enabled=false,auto_renew_status='pending_enrollment',
    auto_renew_account_reference=v_account_reference,auto_renew_correlation_id=NULL,
    auto_renew_amount=v_payment.amount,auto_renew_plan_key=v_payment.plan_key,
    auto_renew_billing_interval=p_billing_interval WHERE id=v_subscription.id;
  RETURN QUERY SELECT v_checkout.payment_request_id,v_checkout.business_id,v_checkout.owner_email,
    v_checkout.amount,v_checkout.currency,v_checkout.merchant_reference,v_checkout.ipn_id,
    true,v_account_reference,v_start_date,v_end_date,v_frequency;
END; $$;

CREATE OR REPLACE FUNCTION public.platform_record_pesapal_recurring_result(
  p_tracking_id text,p_ipn_account_reference text,p_account_reference text,p_correlation_id text,
  p_status_code integer,p_status_description text,p_paid_amount numeric,p_currency text,
  p_confirmation_code text,p_payment_method text,p_payload jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_event_id text:='recurring:'||trim(COALESCE(p_tracking_id,''));
  v_subscription public.subscriptions%ROWTYPE; v_charge_id uuid; v_request_id uuid;
  v_current_price numeric(10,2); v_current_currency text;
  v_owner uuid; v_review text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(COALESCE(p_tracking_id,'')),'') IS NULL OR length(p_tracking_id)>128 OR p_status_code IS NULL THEN
    RAISE EXCEPTION 'Invalid recurring payment result';
  END IF;
  INSERT INTO public.provider_webhook_events(provider,event_id,result)
    VALUES('pesapal_platform',v_event_id,'received') ON CONFLICT(provider,event_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT status INTO v_review FROM public.platform_pesapal_recurring_charges WHERE tracking_id=trim(p_tracking_id);
    RETURN jsonb_build_object('matched',v_review IS NOT NULL,'verified',v_review='verified','duplicate',true);
  END IF;
  SELECT * INTO v_subscription FROM public.subscriptions
    WHERE auto_renew_account_reference=trim(COALESCE(p_ipn_account_reference,'')) FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.provider_webhook_events SET result='unmatched_recurring_reference',processed_at=now()
      WHERE provider='pesapal_platform' AND event_id=v_event_id;
    RETURN jsonb_build_object('matched',false,'verified',false);
  END IF;
  INSERT INTO public.platform_pesapal_recurring_charges(
    subscription_id,business_id,tracking_id,account_reference,correlation_id,amount,currency,
    payment_method,status,provider_receipt_number,raw_provider_payload
  ) VALUES(v_subscription.id,v_subscription.business_id,trim(p_tracking_id),
    trim(COALESCE(p_account_reference,'')),NULLIF(trim(COALESCE(p_correlation_id,'')),''),
    COALESCE(p_paid_amount,0),upper(COALESCE(p_currency,'')),p_payment_method,'received',
    NULLIF(trim(COALESCE(p_confirmation_code,'')),''),COALESCE(p_payload,'{}'::jsonb))
  RETURNING id INTO v_charge_id;
  UPDATE public.provider_webhook_events SET business_id=v_subscription.business_id
    WHERE provider='pesapal_platform' AND event_id=v_event_id;

  IF p_ipn_account_reference IS DISTINCT FROM v_subscription.auto_renew_account_reference
     OR p_account_reference IS DISTINCT FROM v_subscription.auto_renew_account_reference THEN
    v_review:='Pesapal recurring account reference mismatch';
  ELSIF NULLIF(trim(COALESCE(p_correlation_id,'')),'') IS NULL THEN
    v_review:='Pesapal recurring correlation ID is missing';
  ELSIF v_subscription.auto_renew_correlation_id IS NOT NULL
     AND v_subscription.auto_renew_correlation_id IS DISTINCT FROM trim(p_correlation_id) THEN
    v_review:='Pesapal recurring correlation ID mismatch';
  ELSIF p_status_code=3 THEN
    UPDATE public.subscriptions SET auto_renew_enabled=false,auto_renew_status='payment_failed',
      next_plan_key=NULL,next_billing_interval=NULL,next_monthly_amount=NULL,next_currency=NULL,
      next_payment_provider=NULL,next_period_start=NULL,next_period_amount=NULL
      WHERE id=v_subscription.id;
    UPDATE public.platform_pesapal_recurring_charges SET status='reversed',review_note='Pesapal reported a reversed recurring payment',processed_at=now() WHERE id=v_charge_id;
    UPDATE public.provider_webhook_events SET result='recurring_reversed',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event_id;
    RETURN jsonb_build_object('matched',true,'verified',false,'reversed',true);
  ELSIF p_status_code<>1 OR upper(COALESCE(p_status_description,''))<>'COMPLETED' THEN
    UPDATE public.subscriptions SET auto_renew_status='payment_failed' WHERE id=v_subscription.id;
    UPDATE public.platform_pesapal_recurring_charges SET status='failed',review_note=left(COALESCE(p_status_description,'Recurring payment failed'),500),processed_at=now() WHERE id=v_charge_id;
    UPDATE public.provider_webhook_events SET result='recurring_failed',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event_id;
    SELECT u.id INTO v_owner FROM public.users u WHERE u.business_id=v_subscription.business_id AND u.global_role='owner' AND u.is_active=true AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1;
    IF v_owner IS NOT NULL THEN INSERT INTO public.notifications(business_id,recipient_id,type,title,body,metadata)
      VALUES(v_subscription.business_id,v_owner,'subscription_payment_failed','Automatic renewal payment failed',
        'Pesapal could not complete your subscription renewal. Your current paid access remains until its end date; arrange a manual renewal.',
        jsonb_build_object('provider','pesapal','tracking_id',p_tracking_id,'subscription_id',v_subscription.id)); END IF;
    RETURN jsonb_build_object('matched',true,'verified',false,'failed',true);
  ELSE
    IF v_subscription.auto_renew_status IN ('cancel_requested','cancelled','reauthorization_required','disabled')
       OR NOT v_subscription.auto_renew_enabled AND v_subscription.auto_renew_status<>'pending_enrollment' THEN
      v_review:='Recurring charge arrived while Retivox automatic renewal is not active';
    ELSIF upper(COALESCE(p_payment_method,'')) NOT IN ('VISA','MASTERCARD','MASTER CARD') THEN
      v_review:='Recurring charge payment method is not an eligible Pesapal card';
    ELSIF p_paid_amount IS NULL OR v_subscription.auto_renew_amount IS NULL
       OR round(p_paid_amount,2)<>round(v_subscription.auto_renew_amount,2)
       OR upper(COALESCE(p_currency,''))<>upper(v_subscription.currency)
       OR NULLIF(trim(COALESCE(p_confirmation_code,'')),'') IS NULL THEN
      v_review:='Recurring payment amount, currency, or receipt does not match the authorized schedule';
    ELSE
      SELECT h.amount,h.currency INTO v_current_price,v_current_currency
        FROM public.platform_subscription_price_history h
       WHERE h.plan_key=v_subscription.plan AND h.billing_interval=v_subscription.billing_interval
         AND h.existing_subscriber_effective_at<=COALESCE(v_subscription.current_period_end,now())
       ORDER BY h.existing_subscriber_effective_at DESC,h.created_at DESC LIMIT 1;
      IF v_current_price IS NOT NULL AND (round(v_current_price,2)<>round(v_subscription.auto_renew_amount,2)
         OR upper(v_current_currency)<>upper(v_subscription.currency)) THEN
        v_review:='Subscription price changed; the stored Pesapal authorization must be renewed at the new price';
      END IF;
    END IF;
    IF v_review IS NOT NULL THEN
      UPDATE public.platform_pesapal_recurring_charges SET status='review',review_note=v_review,processed_at=now() WHERE id=v_charge_id;
      UPDATE public.subscriptions SET auto_renew_enabled=false,auto_renew_status='reauthorization_required'
        WHERE id=v_subscription.id;
      UPDATE public.provider_webhook_events SET result='recurring_manual_review',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event_id;
      SELECT u.id INTO v_owner FROM public.users u WHERE u.business_id=v_subscription.business_id AND u.global_role='owner' AND u.is_active=true AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1;
      IF v_owner IS NOT NULL THEN INSERT INTO public.notifications(business_id,recipient_id,type,title,body,metadata)
        VALUES(v_subscription.business_id,v_owner,'subscription_payment_review','Automatic renewal needs review',
          left(v_review||'. Contact Retivox support to reconcile this provider payment.',500),
          jsonb_build_object('provider','pesapal','tracking_id',p_tracking_id,'subscription_id',v_subscription.id)); END IF;
      RETURN jsonb_build_object('matched',true,'verified',false,'review',true);
    END IF;
  END IF;

  INSERT INTO public.subscription_payment_requests(
    business_id,subscription_id,amount,currency,payment_method,reference_code,status,
    provider,provider_result_code,provider_result_description,raw_provider_payload,paid_at,
    provider_receipt_number,provider_paid_amount,plan_key,plan_monthly_amount,billing_interval,
    purchase_kind,plan_price_amount,credit_applied,discount_amount,pesapal_tracking_id
  ) VALUES(
    v_subscription.business_id,v_subscription.id,p_paid_amount,upper(p_currency),'pesapal',
    'PESAPAL-REC-'||left(regexp_replace(p_tracking_id,'[^A-Za-z0-9]','','g'),40),'verified',
    'pesapal',p_status_code,'Pesapal recurring payment verified',COALESCE(p_payload,'{}'::jsonb),now(),
    trim(p_confirmation_code),p_paid_amount,v_subscription.plan,v_subscription.monthly_amount,
    v_subscription.billing_interval,'subscription',p_paid_amount,0,0,trim(p_tracking_id)
  ) RETURNING id INTO v_request_id;
  IF NOT public.platform_apply_subscription_payment(v_request_id) THEN
    RAISE EXCEPTION 'Verified Pesapal recurring payment could not be applied';
  END IF;
  UPDATE public.subscriptions SET auto_renew_enabled=true,auto_renew_status='active',
    auto_renew_correlation_id=COALESCE(auto_renew_correlation_id,trim(p_correlation_id)) WHERE id=v_subscription.id;
  UPDATE public.platform_pesapal_recurring_charges SET status='verified',payment_request_id=v_request_id,processed_at=now() WHERE id=v_charge_id;
  UPDATE public.provider_webhook_events SET result='recurring_verified',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event_id;
  RETURN jsonb_build_object('matched',true,'verified',true,'payment_request_id',v_request_id);
END; $$;

CREATE OR REPLACE FUNCTION public.platform_owner_mark_pesapal_auto_renew_cancelled(p_business_id uuid,p_actor_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_actor_id OR public.get_my_business_id() IS DISTINCT FROM p_business_id
     OR public.get_my_global_role()<>'owner' THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  UPDATE public.subscriptions SET auto_renew_enabled=false,auto_renew_status='cancelled'
    WHERE business_id=p_business_id AND auto_renew_status='cancel_requested';
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.audit_logs(business_id,actor_id,entity_type,entity_id,action,new_value)
    SELECT p_business_id,p_actor_id,'subscription_auto_renewal',s.id,'pesapal_cancellation_confirmed',
      jsonb_build_object('provider','pesapal','confirmed_by_owner',true)
      FROM public.subscriptions s WHERE s.business_id=p_business_id;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.platform_owner_request_pesapal_auto_renew_cancel(p_business_id uuid,p_actor_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_actor_id OR public.get_my_business_id() IS DISTINCT FROM p_business_id
     OR public.get_my_global_role()<>'owner' THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  UPDATE public.subscriptions SET auto_renew_status='cancel_requested'
    WHERE business_id=p_business_id AND auto_renew_account_reference IS NOT NULL
      AND auto_renew_status IN ('active','payment_failed','reauthorization_required');
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.audit_logs(business_id,actor_id,entity_type,entity_id,action,new_value)
    SELECT p_business_id,p_actor_id,'subscription_auto_renewal',s.id,'pesapal_cancellation_requested',
      jsonb_build_object('provider','pesapal','requires_provider_portal_cancellation',true)
      FROM public.subscriptions s WHERE s.business_id=p_business_id;
  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.owner_prepare_subscription_pesapal_checkout_v2(text,text,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_prepare_subscription_pesapal_checkout_v2(text,text,text,text,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_record_pesapal_recurring_result(text,text,text,text,integer,text,numeric,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_record_pesapal_recurring_result(text,text,text,text,integer,text,numeric,text,text,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.platform_owner_mark_pesapal_auto_renew_cancelled(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_owner_mark_pesapal_auto_renew_cancelled(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_owner_request_pesapal_auto_renew_cancel(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_owner_request_pesapal_auto_renew_cancel(uuid,uuid) TO authenticated;
