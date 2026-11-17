-- Enforce online payment entitlements for every payment row, regardless of
-- which POS client or transaction RPC created it. Cash and Mobile manual are
-- baseline methods available on every plan.
CREATE OR REPLACE FUNCTION public.business_payment_method_enabled(p_business_id uuid,p_method text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_features jsonb; v_methods jsonb;
BEGIN
  IF p_method IN ('cash','mpesa_manual') THEN RETURN true; END IF;
  IF p_business_id IS NULL OR p_method NOT IN ('mpesa_stk','pesapal','card','bank_transfer') THEN RETURN false; END IF;
  IF auth.uid() IS NULL OR public.get_my_business_id() IS DISTINCT FROM p_business_id THEN RETURN false; END IF;
  SELECT plan.features INTO v_features
    FROM public.subscriptions subscription
    JOIN public.platform_subscription_plans plan ON plan.plan_key=subscription.plan
   WHERE subscription.business_id=p_business_id
     AND (subscription.license_type='lifetime'
       OR (subscription.status IN ('active','trial','past_due','cancelled')
         AND subscription.current_period_end IS NOT NULL
         AND subscription.current_period_end + CASE WHEN subscription.cancelled_at IS NOT NULL THEN interval '0 days' ELSE interval '7 days' END > now()))
   ORDER BY subscription.created_at DESC LIMIT 1;
  v_methods:=COALESCE(v_features->'payment_methods','[]'::jsonb);
  IF jsonb_typeof(v_methods)<>'array' THEN RETURN false; END IF;
  IF p_method='mpesa_stk' THEN
    RETURN v_methods ? 'daraja_stk' OR v_methods ? 'mpesa_stk';
  ELSIF p_method='pesapal' THEN
    RETURN v_methods ? 'pesapal_hosted';
  ELSIF p_method IN ('card','bank_transfer') THEN
    -- Pesapal is a hosted checkout; the provider determines which supported
    -- instrument was used. The package must permit that hosted checkout.
    RETURN v_methods ? 'pesapal_hosted';
  END IF;
  RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_payment_method_plan_entitlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.payment_method IN ('cash','mpesa_manual') OR auth.role()='service_role' THEN RETURN NEW; END IF;
  IF NOT public.business_payment_method_enabled(NEW.business_id,NEW.payment_method) THEN
    RAISE EXCEPTION 'This subscription plan does not include the selected online payment method. Contact the business owner to update plan entitlements.'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS payments_plan_method_entitlement ON public.payments;
CREATE TRIGGER payments_plan_method_entitlement
BEFORE INSERT OR UPDATE OF payment_method ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_method_plan_entitlement();

REVOKE ALL ON FUNCTION public.business_payment_method_enabled(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.business_payment_method_enabled(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.enforce_payment_method_plan_entitlement() FROM PUBLIC,anon,authenticated;
