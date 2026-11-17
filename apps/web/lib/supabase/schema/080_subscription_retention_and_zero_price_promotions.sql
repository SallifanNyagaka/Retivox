-- Permit fully discounted subscription purchases and schedule tenant data
-- retention warnings without deleting records automatically.

ALTER TABLE public.subscription_payment_requests
  DROP CONSTRAINT IF EXISTS subscription_payment_requests_amount_positive,
  ADD CONSTRAINT subscription_payment_requests_amount_valid
    CHECK (amount > 0 OR (amount = 0 AND status = 'verified' AND provider = 'promotion'));

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS retention_delete_after timestamptz,
  ADD COLUMN IF NOT EXISTS retention_legal_hold boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.business_retention_warning_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  retention_delete_after timestamptz NOT NULL,
  days_before integer NOT NULL CHECK (days_before IN (30,14,7)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, retention_delete_after, days_before)
);
ALTER TABLE public.business_retention_warning_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_retention_warning_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_business_retention_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_months integer;
BEGIN
  IF NEW.license_type = 'lifetime' THEN
    UPDATE public.businesses SET retention_delete_after = NULL WHERE id = NEW.business_id;
  ELSIF NEW.status IN ('past_due','expired','cancelled') AND NEW.current_period_end IS NOT NULL
        AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.current_period_end IS DISTINCT FROM NEW.current_period_end) THEN
    SELECT retention_months INTO v_months FROM public.platform_retention_settings WHERE id = true;
    UPDATE public.businesses
       SET retention_delete_after = NEW.current_period_end + interval '7 days' + make_interval(months => COALESCE(v_months, 12))
     WHERE id = NEW.business_id AND retention_legal_hold = false;
  ELSIF NEW.status = 'active' THEN
    UPDATE public.businesses SET retention_delete_after = NULL WHERE id = NEW.business_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS update_business_retention_deadline ON public.subscriptions;
CREATE TRIGGER update_business_retention_deadline
AFTER INSERT OR UPDATE OF status, current_period_end, license_type ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_business_retention_deadline();
REVOKE ALL ON FUNCTION public.update_business_retention_deadline() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.process_business_retention_warnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_business record;
  v_owner record;
  v_days integer;
  v_inserted integer := 0;
  v_log_id uuid;
BEGIN
  FOR v_business IN
    SELECT business.id, business.name, business.retention_delete_after
      FROM public.businesses business
      JOIN public.subscriptions subscription ON subscription.business_id = business.id
     WHERE business.retention_delete_after IS NOT NULL
       AND NOT business.retention_legal_hold
       AND subscription.license_type <> 'lifetime'
       AND subscription.status <> 'active'
  LOOP
    v_days := ceil(extract(epoch FROM (v_business.retention_delete_after - now())) / 86400)::integer;
    IF v_days IN (30,14,7) THEN
      INSERT INTO public.business_retention_warning_log (business_id, retention_delete_after, days_before)
      VALUES (v_business.id, v_business.retention_delete_after, v_days)
      ON CONFLICT DO NOTHING RETURNING id INTO v_log_id;
      IF v_log_id IS NOT NULL THEN
        FOR v_owner IN
          SELECT id FROM public.users
           WHERE business_id = v_business.id AND global_role = 'owner' AND is_active = true AND deleted_at IS NULL
        LOOP
          INSERT INTO public.notifications (business_id, recipient_id, type, title, body, metadata)
          VALUES (v_business.id, v_owner.id, 'data_retention_warning', 'Business data retention notice',
            format('Data for %s is scheduled for retention review in %s days. Export your records or contact support if a legal hold applies.', v_business.name, v_days),
            jsonb_build_object('retention_delete_after', v_business.retention_delete_after, 'days_remaining', v_days));
        END LOOP;
        v_inserted := v_inserted + 1;
      END IF;
    END IF;
    v_log_id := NULL;
  END LOOP;
  RETURN v_inserted;
END;
$$;
REVOKE ALL ON FUNCTION public.process_business_retention_warnings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_business_retention_warnings() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'retivox-business-retention-warnings';
    PERFORM cron.schedule('retivox-business-retention-warnings', '30 6 * * *',
      'select public.process_business_retention_warnings();');
  END IF;
END;
$$;
