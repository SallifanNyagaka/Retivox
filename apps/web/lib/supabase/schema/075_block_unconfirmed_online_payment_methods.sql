-- Do not mark external provider payments settled through the manual POS RPCs.
-- Daraja and hosted checkout will use separate pending/verified workflows.

CREATE OR REPLACE FUNCTION public.block_unconfirmed_online_payment_method()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.payment_method IN ('card', 'bank_transfer', 'other') THEN
    RAISE EXCEPTION 'This payment method requires an online provider checkout and verified callback';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_require_provider_confirmation ON public.payments;
CREATE TRIGGER payments_require_provider_confirmation
BEFORE INSERT OR UPDATE OF payment_method ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.block_unconfirmed_online_payment_method();

REVOKE ALL ON FUNCTION public.block_unconfirmed_online_payment_method() FROM PUBLIC, anon, authenticated;
