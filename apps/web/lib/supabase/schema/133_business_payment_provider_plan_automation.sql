-- Keep merchant payment-provider credentials aligned with the active plan.
-- A lower-tier plan removes provider details and unshared Vault secrets;
-- a later eligible upgrade exposes setup again, and the owner can reconfigure.

CREATE OR REPLACE FUNCTION public.business_payment_provider_plan_allows(
  p_business_id uuid,
  p_provider text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT CASE p_provider
      WHEN 'daraja' THEN
        COALESCE(plan.features->'payment_methods', '[]'::jsonb) ? 'daraja_stk'
        OR COALESCE(plan.features->'payment_methods', '[]'::jsonb) ? 'mpesa_stk'
      WHEN 'pesapal' THEN
        COALESCE(plan.features->'payment_methods', '[]'::jsonb) ? 'pesapal_hosted'
      ELSE false
    END
      FROM public.subscriptions AS subscription
      JOIN public.platform_subscription_plans AS plan
        ON plan.plan_key = subscription.plan
     WHERE subscription.business_id = p_business_id
       AND (
         subscription.license_type = 'lifetime'
         OR (
           subscription.status IN ('active', 'trial', 'past_due', 'cancelled')
           AND subscription.current_period_end IS NOT NULL
           AND subscription.current_period_end
             + CASE WHEN subscription.cancelled_at IS NOT NULL
                    THEN interval '0 days'
                    ELSE interval '7 days'
               END > now()
         )
       )
     ORDER BY subscription.created_at DESC
     LIMIT 1
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.purge_unentitled_business_payment_provider_settings(
  p_business_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
DECLARE
  setting record;
  secret_id uuid;
  removed integer := 0;
BEGIN
  FOR setting IN
    SELECT id, provider, consumer_key_secret_id,
           consumer_secret_secret_id, passkey_secret_id
      FROM public.business_payment_provider_settings
     WHERE business_id = p_business_id
       AND provider IN ('daraja', 'pesapal')
       AND NOT public.business_payment_provider_plan_allows(business_id, provider)
  LOOP
    DELETE FROM public.business_payment_provider_settings WHERE id = setting.id;
    removed := removed + 1;

    FOREACH secret_id IN ARRAY ARRAY[
      setting.consumer_key_secret_id,
      setting.consumer_secret_secret_id,
      setting.passkey_secret_id
    ] LOOP
      IF secret_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.business_payment_provider_settings AS item
            WHERE item.consumer_key_secret_id = secret_id
               OR item.consumer_secret_secret_id = secret_id
               OR item.passkey_secret_id = secret_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.platform_payment_settings AS item
            WHERE item.consumer_key_secret_id = secret_id
               OR item.consumer_secret_secret_id = secret_id
               OR item.passkey_secret_id = secret_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.platform_pesapal_settings AS item
            WHERE item.consumer_key_secret_id = secret_id
               OR item.consumer_secret_secret_id = secret_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.platform_email_settings AS item
            WHERE item.api_key_secret_id = secret_id
         ) THEN
        DELETE FROM vault.secrets WHERE id = secret_id;
      END IF;
    END LOOP;
  END LOOP;

  RETURN removed;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_business_payment_provider_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.provider IN ('daraja', 'pesapal')
     AND NOT public.business_payment_provider_plan_allows(NEW.business_id, NEW.provider) THEN
    RAISE EXCEPTION 'This subscription plan does not include the selected online payment provider.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_unentitled_payment_provider_settings_after_subscription_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.purge_unentitled_business_payment_provider_settings(OLD.business_id);
    RETURN OLD;
  END IF;
  PERFORM public.purge_unentitled_business_payment_provider_settings(NEW.business_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_unentitled_payment_provider_settings_after_plan_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT DISTINCT business_id
      FROM public.subscriptions
     WHERE plan = NEW.plan_key
  LOOP
    PERFORM public.purge_unentitled_business_payment_provider_settings(target.business_id);
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.business_payment_provider_plan_allows(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_unentitled_business_payment_provider_settings(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_unentitled_business_payment_provider_settings(uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.enforce_business_payment_provider_plan()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_unentitled_payment_provider_settings_after_subscription_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_unentitled_payment_provider_settings_after_plan_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS business_payment_provider_plan_entitlement
  ON public.business_payment_provider_settings;
CREATE TRIGGER business_payment_provider_plan_entitlement
BEFORE INSERT OR UPDATE ON public.business_payment_provider_settings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_business_payment_provider_plan();

DROP TRIGGER IF EXISTS purge_unentitled_payment_provider_settings_after_subscription_insert
  ON public.subscriptions;
CREATE TRIGGER purge_unentitled_payment_provider_settings_after_subscription_insert
AFTER INSERT ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.purge_unentitled_payment_provider_settings_after_subscription_change();

DROP TRIGGER IF EXISTS purge_unentitled_payment_provider_settings_after_subscription_update
  ON public.subscriptions;
CREATE TRIGGER purge_unentitled_payment_provider_settings_after_subscription_update
AFTER UPDATE OF plan, status, license_type, current_period_end, cancelled_at
ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.purge_unentitled_payment_provider_settings_after_subscription_change();

DROP TRIGGER IF EXISTS purge_unentitled_payment_provider_settings_after_subscription_delete
  ON public.subscriptions;
CREATE TRIGGER purge_unentitled_payment_provider_settings_after_subscription_delete
AFTER DELETE ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.purge_unentitled_payment_provider_settings_after_subscription_change();

DROP TRIGGER IF EXISTS purge_unentitled_payment_provider_settings_after_plan_update
  ON public.platform_subscription_plans;
CREATE TRIGGER purge_unentitled_payment_provider_settings_after_plan_update
AFTER UPDATE OF features ON public.platform_subscription_plans
FOR EACH ROW
WHEN (OLD.features IS DISTINCT FROM NEW.features)
EXECUTE FUNCTION public.purge_unentitled_payment_provider_settings_after_plan_change();
