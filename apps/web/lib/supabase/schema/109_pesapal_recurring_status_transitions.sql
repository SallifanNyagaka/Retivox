-- A Pesapal recurring tracking ID can receive more than one terminal update
-- (for example, a later reversal). Deduplicate by status transition rather than
-- suppressing every later notification for the same charge.
CREATE OR REPLACE FUNCTION public.platform_record_pesapal_recurring_result(
  p_tracking_id text,p_ipn_account_reference text,p_account_reference text,p_correlation_id text,
  p_status_code integer,p_status_description text,p_paid_amount numeric,p_currency text,
  p_confirmation_code text,p_payment_method text,p_payload jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_event_id text:='recurring:'||trim(COALESCE(p_tracking_id,''))||':'||COALESCE(p_status_code::text,'unknown');
  v_subscription public.subscriptions%ROWTYPE; v_charge_id uuid; v_request_id uuid;
  v_current_price numeric(10,2); v_current_currency text; v_owner uuid; v_review text;
  v_prior_charge_status text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
  IF NULLIF(trim(COALESCE(p_tracking_id,'')),'') IS NULL OR length(p_tracking_id)>128 OR p_status_code IS NULL THEN
    RAISE EXCEPTION 'Invalid recurring payment result';
  END IF;
  INSERT INTO public.provider_webhook_events(provider,event_id,result)
    VALUES('pesapal_platform',v_event_id,'received') ON CONFLICT(provider,event_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT status INTO v_prior_charge_status FROM public.platform_pesapal_recurring_charges WHERE tracking_id=trim(p_tracking_id);
    RETURN jsonb_build_object('matched',v_prior_charge_status IS NOT NULL,
      'verified',v_prior_charge_status='verified','reversed',v_prior_charge_status='reversed','duplicate',true);
  END IF;

  SELECT status INTO v_prior_charge_status FROM public.platform_pesapal_recurring_charges
    WHERE tracking_id=trim(p_tracking_id) FOR UPDATE;
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
  ON CONFLICT(tracking_id) DO UPDATE SET account_reference=EXCLUDED.account_reference,
    correlation_id=EXCLUDED.correlation_id,amount=EXCLUDED.amount,currency=EXCLUDED.currency,
    payment_method=EXCLUDED.payment_method,provider_receipt_number=EXCLUDED.provider_receipt_number,
    raw_provider_payload=EXCLUDED.raw_provider_payload,status='received',review_note=NULL,processed_at=NULL
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
      next_payment_provider=NULL,next_period_start=NULL,next_period_amount=NULL WHERE id=v_subscription.id;
    UPDATE public.platform_pesapal_recurring_charges SET status='reversed',review_note='Pesapal reported a reversed recurring payment',processed_at=now() WHERE id=v_charge_id;
    UPDATE public.provider_webhook_events SET result='recurring_reversed',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event_id;
    RETURN jsonb_build_object('matched',true,'verified',false,'reversed',true);
  ELSIF p_status_code<>1 OR upper(COALESCE(p_status_description,''))<>'COMPLETED' THEN
    UPDATE public.subscriptions SET auto_renew_enabled=false,auto_renew_status='payment_failed' WHERE id=v_subscription.id;
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
       OR (NOT v_subscription.auto_renew_enabled AND v_subscription.auto_renew_status<>'pending_enrollment'
           AND NOT (v_subscription.auto_renew_status='payment_failed' AND v_prior_charge_status='failed')) THEN
      v_review:='Recurring charge arrived while Retivox automatic renewal is not active';
    ELSIF upper(COALESCE(p_payment_method,'')) NOT IN ('VISA','MASTERCARD','MASTER CARD') THEN
      v_review:='Recurring charge payment method is not an eligible Pesapal card';
    ELSIF p_paid_amount IS NULL OR v_subscription.auto_renew_amount IS NULL
       OR round(p_paid_amount,2)<>round(v_subscription.auto_renew_amount,2)
       OR upper(COALESCE(p_currency,''))<>upper(v_subscription.currency)
       OR NULLIF(trim(COALESCE(p_confirmation_code,'')),'') IS NULL THEN
      v_review:='Recurring payment amount, currency, or receipt does not match the authorized schedule';
    ELSE
      SELECT h.amount,h.currency INTO v_current_price,v_current_currency FROM public.platform_subscription_price_history h
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
      UPDATE public.subscriptions SET auto_renew_enabled=false,auto_renew_status='reauthorization_required' WHERE id=v_subscription.id;
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
  ) VALUES(v_subscription.business_id,v_subscription.id,p_paid_amount,upper(p_currency),'pesapal',
    'PESAPAL-REC-'||left(regexp_replace(p_tracking_id,'[^A-Za-z0-9]','','g'),40),'verified','pesapal',
    p_status_code,'Pesapal recurring payment verified',COALESCE(p_payload,'{}'::jsonb),now(),
    trim(p_confirmation_code),p_paid_amount,v_subscription.plan,v_subscription.monthly_amount,
    v_subscription.billing_interval,'subscription',p_paid_amount,0,0,trim(p_tracking_id))
  ON CONFLICT(pesapal_tracking_id) WHERE pesapal_tracking_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_request_id;
  IF v_request_id IS NOT NULL AND NOT public.platform_apply_subscription_payment(v_request_id) THEN
    RAISE EXCEPTION 'Verified Pesapal recurring payment could not be applied';
  END IF;
  UPDATE public.subscriptions SET auto_renew_enabled=true,auto_renew_status='active',
    auto_renew_correlation_id=COALESCE(auto_renew_correlation_id,trim(p_correlation_id)) WHERE id=v_subscription.id;
  UPDATE public.platform_pesapal_recurring_charges SET status='verified',payment_request_id=COALESCE(v_request_id,payment_request_id),processed_at=now() WHERE id=v_charge_id;
  UPDATE public.provider_webhook_events SET result='recurring_verified',processed_at=now() WHERE provider='pesapal_platform' AND event_id=v_event_id;
  RETURN jsonb_build_object('matched',true,'verified',true,'payment_request_id',v_request_id);
END; $$;

REVOKE ALL ON FUNCTION public.platform_record_pesapal_recurring_result(text,text,text,text,integer,text,numeric,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_record_pesapal_recurring_result(text,text,text,text,integer,text,numeric,text,text,text,jsonb) TO service_role;
