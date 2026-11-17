-- Online tenders may only settle through trusted provider callbacks. This also
-- protects direct Data API writes, which remain available under tenant RLS.
CREATE OR REPLACE FUNCTION public.enforce_payment_method_plan_entitlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_required_provider text;
BEGIN
  IF NEW.payment_method IN ('mpesa_stk','pesapal','card','bank_transfer') THEN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND NOT public.business_payment_method_enabled(NEW.business_id,NEW.payment_method) THEN
      RAISE EXCEPTION 'This subscription plan does not include the selected online payment method. Contact the business owner to update plan entitlements.'
        USING ERRCODE='42501';
    END IF;
    v_required_provider:=CASE WHEN NEW.payment_method='mpesa_stk' THEN 'daraja' ELSE 'pesapal' END;
    IF NEW.provider IS DISTINCT FROM v_required_provider THEN
      RAISE EXCEPTION 'The selected online payment method must use its configured provider checkout.' USING ERRCODE='42501';
    END IF;
    IF NEW.status='verified' AND auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Online payments can only be verified by the payment provider callback.' USING ERRCODE='42501';
    END IF;
  ELSIF NEW.status='verified' AND NEW.provider IN ('daraja','pesapal')
        AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Provider payments can only be verified by the provider callback.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS payments_plan_method_entitlement ON public.payments;
CREATE TRIGGER payments_plan_method_entitlement
BEFORE INSERT OR UPDATE OF payment_method,status,provider ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_method_plan_entitlement();

REVOKE ALL ON FUNCTION public.enforce_payment_method_plan_entitlement() FROM PUBLIC,anon,authenticated;
