-- Expand the existing subscription model for configurable trials, lifetime
-- licenses, plan entitlements, and immutable price history.

ALTER TABLE public.platform_subscription_plans
  ADD COLUMN IF NOT EXISTS yearly_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS lifetime_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS monthly_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS yearly_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS lifetime_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL;

UPDATE public.platform_subscription_plans
   SET yearly_amount = round(monthly_amount * 12 * (1 - annual_discount_percent / 100), 2)
 WHERE yearly_amount IS NULL;

ALTER TABLE public.platform_subscription_plans
  ALTER COLUMN yearly_amount SET NOT NULL,
  ALTER COLUMN yearly_amount SET DEFAULT 0;

ALTER TABLE public.platform_subscription_plans
  DROP CONSTRAINT IF EXISTS platform_subscription_plans_key_valid,
  DROP CONSTRAINT IF EXISTS platform_subscription_plans_yearly_amount_valid,
  DROP CONSTRAINT IF EXISTS platform_subscription_plans_lifetime_amount_valid,
  DROP CONSTRAINT IF EXISTS platform_subscription_plans_trial_days_valid,
  DROP CONSTRAINT IF EXISTS platform_subscription_plans_features_object;

ALTER TABLE public.platform_subscription_plans
  ADD CONSTRAINT platform_subscription_plans_key_valid
    CHECK (plan_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  ADD CONSTRAINT platform_subscription_plans_yearly_amount_valid
    CHECK (yearly_amount >= 0),
  ADD CONSTRAINT platform_subscription_plans_lifetime_amount_valid
    CHECK (lifetime_amount IS NULL OR lifetime_amount >= 0),
  ADD CONSTRAINT platform_subscription_plans_trial_days_valid
    CHECK (trial_days BETWEEN 0 AND 90),
  ADD CONSTRAINT platform_subscription_plans_features_object
    CHECK (jsonb_typeof(features) = 'object'),
  ADD CONSTRAINT platform_subscription_plans_lifetime_price_required
    CHECK (NOT lifetime_enabled OR (plan_key <> 'trial' AND lifetime_amount IS NOT NULL AND lifetime_amount > 0));

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS license_type text NOT NULL DEFAULT 'subscription',
  ADD COLUMN IF NOT EXISTS lifetime_purchase_credit numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_renew_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_period_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS next_period_amount numeric(10,2);

UPDATE public.subscriptions AS subscription
   SET paid_period_amount = CASE
     WHEN subscription.billing_interval = 'yearly' THEN round(
       subscription.monthly_amount * 12 * (1 - COALESCE(plan.annual_discount_percent, 0) / 100), 2
     )
     ELSE subscription.monthly_amount
   END
  FROM public.platform_subscription_plans AS plan
 WHERE plan.plan_key = subscription.plan
   AND subscription.license_type = 'subscription'
   AND subscription.paid_period_amount IS NULL;
UPDATE public.subscriptions
   SET paid_period_amount = monthly_amount
 WHERE license_type = 'subscription' AND paid_period_amount IS NULL;
UPDATE public.subscriptions
   SET paid_period_amount = 0
 WHERE license_type = 'lifetime' AND paid_period_amount IS NULL;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_billing_interval_valid,
  DROP CONSTRAINT IF EXISTS subscriptions_next_billing_interval_valid,
  DROP CONSTRAINT IF EXISTS subscriptions_license_type_valid,
  DROP CONSTRAINT IF EXISTS subscriptions_lifetime_credit_nonnegative;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_billing_interval_valid
    CHECK (billing_interval IN ('monthly', 'yearly', 'lifetime')),
  ADD CONSTRAINT subscriptions_next_billing_interval_valid
    CHECK (next_billing_interval IS NULL OR next_billing_interval IN ('monthly', 'yearly', 'lifetime')),
  ADD CONSTRAINT subscriptions_license_type_valid
    CHECK (license_type IN ('subscription', 'lifetime')),
  ADD CONSTRAINT subscriptions_lifetime_credit_nonnegative
    CHECK (lifetime_purchase_credit >= 0);

ALTER TABLE public.subscription_payment_requests
  ADD COLUMN IF NOT EXISTS purchase_kind text NOT NULL DEFAULT 'subscription',
  ADD COLUMN IF NOT EXISTS plan_price_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS credit_applied numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_version_id uuid,
  ADD COLUMN IF NOT EXISTS license_applied_at timestamptz;

UPDATE public.subscription_payment_requests
   SET plan_price_amount = amount
 WHERE plan_price_amount IS NULL;

ALTER TABLE public.subscription_payment_requests
  DROP CONSTRAINT IF EXISTS subscription_payment_requests_billing_interval_valid,
  DROP CONSTRAINT IF EXISTS subscription_payment_requests_purchase_kind_valid,
  DROP CONSTRAINT IF EXISTS subscription_payment_requests_credit_nonnegative;

ALTER TABLE public.subscription_payment_requests
  ADD CONSTRAINT subscription_payment_requests_billing_interval_valid
    CHECK (billing_interval IN ('monthly', 'yearly', 'lifetime')),
  ADD CONSTRAINT subscription_payment_requests_purchase_kind_valid
    CHECK (purchase_kind IN ('subscription', 'plan_upgrade', 'lifetime_purchase', 'lifetime_upgrade')),
  ADD CONSTRAINT subscription_payment_requests_credit_nonnegative
    CHECK (credit_applied >= 0);

CREATE TABLE IF NOT EXISTS public.platform_subscription_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.platform_subscription_plans(id) ON DELETE RESTRICT,
  plan_key text NOT NULL,
  billing_interval text NOT NULL CHECK (billing_interval IN ('monthly', 'yearly', 'lifetime')),
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL,
  new_purchase_effective_at timestamptz NOT NULL DEFAULT now(),
  existing_subscriber_effective_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, billing_interval, created_at)
);
CREATE INDEX IF NOT EXISTS idx_platform_subscription_price_history_lookup
  ON public.platform_subscription_price_history (plan_key, billing_interval, new_purchase_effective_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_subscription_price_history_renewal
  ON public.platform_subscription_price_history (plan_key, billing_interval, existing_subscriber_effective_at DESC);
ALTER TABLE public.platform_subscription_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_subscription_price_history FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.subscription_license_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  payment_request_id uuid REFERENCES public.subscription_payment_requests(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  platform_user_id uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'trial_started', 'subscription_started', 'subscription_renewed', 'plan_upgraded',
    'plan_downgrade_scheduled', 'lifetime_purchased', 'lifetime_upgraded',
    'complimentary_access', 'license_suspended', 'license_reactivated', 'period_extended',
    'subscription_cancelled', 'subscription_expired'
  )),
  from_plan text,
  to_plan text,
  from_interval text,
  to_interval text,
  paid_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  credit_applied numeric(10,2) NOT NULL DEFAULT 0 CHECK (credit_applied >= 0),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscription_license_events_business
  ON public.subscription_license_events (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_license_events_subscription
  ON public.subscription_license_events (subscription_id, created_at DESC);
ALTER TABLE public.subscription_license_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_license_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.capture_subscription_plan_price_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing_effective_at timestamptz := now();
  v_price_increased boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_price_increased := NEW.monthly_amount > OLD.monthly_amount
      OR NEW.yearly_amount > OLD.yearly_amount
      OR COALESCE(NEW.lifetime_amount, 0) > COALESCE(OLD.lifetime_amount, 0);
    IF v_price_increased THEN
      v_existing_effective_at := now() + interval '30 days';
    END IF;
  END IF;

  INSERT INTO public.platform_subscription_price_history (
    plan_id, plan_key, billing_interval, amount, currency,
    new_purchase_effective_at, existing_subscriber_effective_at, published_by, reason
  ) VALUES
    (NEW.id, NEW.plan_key, 'monthly', NEW.monthly_amount, NEW.currency, now(), v_existing_effective_at, NEW.updated_by,
      CASE WHEN v_price_increased THEN 'Price increase; existing subscribers receive 30 days notice' ELSE NULL END),
    (NEW.id, NEW.plan_key, 'yearly', NEW.yearly_amount, NEW.currency, now(), v_existing_effective_at, NEW.updated_by,
      CASE WHEN v_price_increased THEN 'Price increase; existing subscribers receive 30 days notice' ELSE NULL END);
  IF NEW.lifetime_enabled AND NEW.lifetime_amount IS NOT NULL THEN
    INSERT INTO public.platform_subscription_price_history (
      plan_id, plan_key, billing_interval, amount, currency,
      new_purchase_effective_at, existing_subscriber_effective_at, published_by, reason
    ) VALUES (
      NEW.id, NEW.plan_key, 'lifetime', NEW.lifetime_amount, NEW.currency,
      now(), v_existing_effective_at, NEW.updated_by,
      CASE WHEN v_price_increased THEN 'Price increase; existing subscribers receive 30 days notice' ELSE NULL END
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_subscription_plan_price_history ON public.platform_subscription_plans;
CREATE TRIGGER capture_subscription_plan_price_history
AFTER INSERT OR UPDATE OF monthly_amount, yearly_amount, lifetime_amount, lifetime_enabled, currency
ON public.platform_subscription_plans
FOR EACH ROW EXECUTE FUNCTION public.capture_subscription_plan_price_history();
REVOKE ALL ON FUNCTION public.capture_subscription_plan_price_history() FROM PUBLIC, anon, authenticated;

INSERT INTO public.platform_subscription_price_history (
  plan_id, plan_key, billing_interval, amount, currency,
  new_purchase_effective_at, existing_subscriber_effective_at, reason
)
SELECT plan.id, plan.plan_key, price.billing_interval, price.amount, plan.currency,
       now(), now(), 'Initial price snapshot'
  FROM public.platform_subscription_plans AS plan
 CROSS JOIN LATERAL (VALUES
   ('monthly'::text, plan.monthly_amount),
   ('yearly'::text, plan.yearly_amount)
 ) AS price(billing_interval, amount)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.platform_subscription_price_history history
    WHERE history.plan_id = plan.id AND history.billing_interval = price.billing_interval
 );

INSERT INTO public.platform_subscription_price_history (
  plan_id, plan_key, billing_interval, amount, currency,
  new_purchase_effective_at, existing_subscriber_effective_at, reason
)
SELECT id, plan_key, 'lifetime', lifetime_amount, currency, now(), now(), 'Initial price snapshot'
  FROM public.platform_subscription_plans AS plan
 WHERE lifetime_enabled AND lifetime_amount IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.platform_subscription_price_history history
      WHERE history.plan_id = plan.id AND history.billing_interval = 'lifetime'
   );

CREATE OR REPLACE FUNCTION public.owner_submit_subscription_payment_v2(
  p_plan_key text,
  p_billing_interval text,
  p_reference_code text,
  p_payment_method text DEFAULT 'mpesa_manual',
  p_payer_phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
  v_plan public.platform_subscription_plans%ROWTYPE;
  v_current_plan public.platform_subscription_plans%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_amount numeric(10,2);
  v_target_amount numeric(10,2);
  v_credit numeric(10,2) := 0;
  v_remaining_fraction numeric := 0;
  v_current_total numeric(10,2) := 0;
  v_request_id uuid;
  v_price_version_id uuid;
  v_purchase_kind text;
  v_defer_until_period_end boolean := false;
BEGIN
  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_payment_method NOT IN ('mpesa_stk', 'mpesa_manual', 'bank_transfer', 'cash_deposit', 'other') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;
  IF p_billing_interval NOT IN ('monthly', 'yearly', 'lifetime') THEN
    RAISE EXCEPTION 'Unsupported billing interval';
  END IF;
  IF length(NULLIF(trim(COALESCE(p_reference_code, '')), '')) < 3 THEN
    RAISE EXCEPTION 'Enter a valid payment reference';
  END IF;

  SELECT * INTO v_plan
    FROM public.platform_subscription_plans
   WHERE plan_key = p_plan_key AND is_active = true AND plan_key <> 'trial';
  IF NOT FOUND THEN RAISE EXCEPTION 'Selected plan is not available'; END IF;

  IF (p_billing_interval = 'monthly' AND NOT v_plan.monthly_enabled)
     OR (p_billing_interval = 'yearly' AND NOT v_plan.yearly_enabled)
     OR (p_billing_interval = 'lifetime' AND NOT v_plan.lifetime_enabled) THEN
    RAISE EXCEPTION 'This billing option is not available for the selected package';
  END IF;
  v_target_amount := CASE p_billing_interval
    WHEN 'monthly' THEN v_plan.monthly_amount
    WHEN 'yearly' THEN v_plan.yearly_amount
    ELSE v_plan.lifetime_amount
  END;
  IF v_target_amount IS NULL OR v_target_amount <= 0 THEN
    RAISE EXCEPTION 'Selected package does not have a payable price';
  END IF;

  INSERT INTO public.subscriptions (
    business_id, plan, status, branch_count, monthly_amount, currency,
    current_period_start, current_period_end, paid_period_amount
  )
  SELECT v_business_id, 'trial', 'active', 1, 0, v_plan.currency,
         now(), now() + make_interval(days => trial_plan.trial_days), 0
    FROM public.platform_subscription_plans AS trial_plan
   WHERE trial_plan.plan_key = 'trial'
  ON CONFLICT (business_id) DO NOTHING;

  SELECT * INTO v_subscription
    FROM public.subscriptions
   WHERE business_id = v_business_id
   FOR UPDATE;

  IF v_subscription.next_plan_key IS NOT NULL THEN
    RAISE EXCEPTION 'A verified plan change is already scheduled. Review it before making another change.';
  END IF;
  IF v_subscription.license_type = 'lifetime' AND p_billing_interval <> 'lifetime' THEN
    RAISE EXCEPTION 'A lifetime license cannot be changed to a recurring subscription';
  END IF;

  v_purchase_kind := CASE
    WHEN p_billing_interval = 'lifetime' AND v_subscription.license_type = 'lifetime' THEN 'lifetime_upgrade'
    WHEN p_billing_interval = 'lifetime' THEN 'lifetime_purchase'
    WHEN v_subscription.plan <> 'trial' AND (v_subscription.plan <> p_plan_key OR v_subscription.billing_interval <> p_billing_interval) THEN 'plan_upgrade'
    ELSE 'subscription'
  END;

  IF v_purchase_kind = 'subscription'
     AND v_subscription.plan = p_plan_key
     AND v_subscription.billing_interval = p_billing_interval
     AND v_subscription.current_period_end > now() THEN
    v_defer_until_period_end := true;
    SELECT history.id, history.amount INTO v_price_version_id, v_target_amount
      FROM public.platform_subscription_price_history AS history
     WHERE history.plan_key = p_plan_key
       AND history.billing_interval = p_billing_interval
       AND history.existing_subscriber_effective_at <= v_subscription.current_period_end
     ORDER BY history.existing_subscriber_effective_at DESC, history.created_at DESC
     LIMIT 1;
  ELSE
    SELECT history.id INTO v_price_version_id
      FROM public.platform_subscription_price_history AS history
     WHERE history.plan_key = p_plan_key
       AND history.billing_interval = p_billing_interval
       AND history.new_purchase_effective_at <= now()
     ORDER BY history.new_purchase_effective_at DESC, history.created_at DESC
     LIMIT 1;
  END IF;

  IF v_defer_until_period_end THEN
    v_credit := 0;
  ELSIF p_billing_interval = 'lifetime' AND v_subscription.license_type = 'lifetime'
        AND v_subscription.currency = v_plan.currency THEN
    v_credit := v_subscription.lifetime_purchase_credit;
  ELSIF p_billing_interval = 'lifetime'
        AND v_subscription.plan <> 'trial'
        AND v_subscription.status IN ('active', 'past_due')
        AND v_subscription.current_period_start IS NOT NULL
        AND v_subscription.current_period_end > now()
        AND v_subscription.currency = v_plan.currency THEN
    v_remaining_fraction := greatest(0, least(1,
      extract(epoch FROM (v_subscription.current_period_end - now())) /
      nullif(extract(epoch FROM (v_subscription.current_period_end - v_subscription.current_period_start)), 0)
    ));
    v_credit := round(COALESCE(v_subscription.paid_period_amount, 0) * v_remaining_fraction, 2);
  ELSIF p_billing_interval IN ('monthly', 'yearly')
        AND v_subscription.plan <> 'trial'
        AND v_subscription.status IN ('active', 'past_due')
        AND v_subscription.current_period_start IS NOT NULL
        AND v_subscription.current_period_end > now()
        AND v_subscription.currency = v_plan.currency
        AND (p_plan_key <> v_subscription.plan OR p_billing_interval <> v_subscription.billing_interval) THEN
    SELECT * INTO v_current_plan FROM public.platform_subscription_plans WHERE plan_key = v_subscription.plan;
    IF FOUND AND (v_plan.sort_order < v_current_plan.sort_order OR v_target_amount < COALESCE(v_subscription.paid_period_amount, 0)) THEN
      RAISE EXCEPTION 'Downgrades are scheduled for the end of the paid period';
    END IF;
    v_remaining_fraction := greatest(0, least(1,
      extract(epoch FROM (v_subscription.current_period_end - now())) /
      nullif(extract(epoch FROM (v_subscription.current_period_end - v_subscription.current_period_start)), 0)
    ));
    v_credit := round(COALESCE(v_subscription.paid_period_amount, 0) * v_remaining_fraction, 2);
  END IF;

  v_credit := least(v_target_amount, greatest(0, v_credit));
  v_amount := round(greatest(0, v_target_amount - v_credit), 2);

  IF v_amount = 0 THEN
    IF p_billing_interval = 'lifetime' THEN
      UPDATE public.subscriptions
         SET plan = p_plan_key, status = 'active', license_type = 'lifetime',
             billing_interval = 'lifetime', monthly_amount = v_plan.monthly_amount,
             paid_period_amount = 0, currency = v_plan.currency, payment_provider = 'credit',
             current_period_start = now(), current_period_end = NULL, cancelled_at = NULL,
             next_plan_key = NULL, next_billing_interval = NULL, next_monthly_amount = NULL,
             next_currency = NULL, next_payment_provider = NULL, next_period_start = NULL,
             next_period_amount = NULL
       WHERE id = v_subscription.id;
      UPDATE public.businesses SET subscription_plan = p_plan_key, subscription_status = 'active'
       WHERE id = v_business_id;
      INSERT INTO public.subscription_license_events (
        business_id, subscription_id, actor_user_id, event_type, from_plan, to_plan,
        from_interval, to_interval, credit_applied, reason
      ) VALUES (
        v_business_id, v_subscription.id, v_actor_id,
        CASE WHEN v_subscription.license_type = 'lifetime' THEN 'lifetime_upgraded' ELSE 'lifetime_purchased' END,
        v_subscription.plan, p_plan_key, v_subscription.billing_interval, 'lifetime', v_credit,
        'Lifetime price fully covered by eligible purchase credit'
      );
    ELSE
      UPDATE public.subscriptions
         SET plan = p_plan_key, status = 'active', license_type = 'subscription',
             billing_interval = p_billing_interval, monthly_amount = v_plan.monthly_amount,
             paid_period_amount = v_target_amount, currency = v_plan.currency, payment_provider = 'credit',
             current_period_start = now(),
             current_period_end = now() + CASE WHEN p_billing_interval = 'yearly' THEN interval '1 year' ELSE interval '1 month' END,
             cancelled_at = NULL, next_plan_key = NULL, next_billing_interval = NULL,
             next_monthly_amount = NULL, next_currency = NULL, next_payment_provider = NULL,
             next_period_start = NULL, next_period_amount = NULL
       WHERE id = v_subscription.id;
      UPDATE public.businesses SET subscription_plan = p_plan_key, subscription_status = 'active'
       WHERE id = v_business_id;
      INSERT INTO public.subscription_license_events (
        business_id, subscription_id, actor_user_id, event_type, from_plan, to_plan,
        from_interval, to_interval, credit_applied, reason
      ) VALUES (
        v_business_id, v_subscription.id, v_actor_id, 'plan_upgraded',
        v_subscription.plan, p_plan_key, v_subscription.billing_interval, p_billing_interval,
        v_credit, 'Subscription upgrade fully covered by eligible unused period credit'
      );
    END IF;
    RETURN NULL;
  END IF;

  INSERT INTO public.subscription_payment_requests (
    business_id, subscription_id, submitted_by, amount, currency, payment_method,
    reference_code, payer_phone, status, plan_key, plan_monthly_amount, billing_interval,
    purchase_kind, plan_price_amount, credit_applied, price_version_id
  ) VALUES (
    v_business_id, v_subscription.id, v_actor_id, v_amount, v_plan.currency, p_payment_method,
    trim(p_reference_code), NULLIF(trim(COALESCE(p_payer_phone, '')), ''), 'pending',
    p_plan_key, v_plan.monthly_amount, p_billing_interval, v_purchase_kind,
    v_target_amount, v_credit, v_price_version_id
  ) RETURNING id INTO v_request_id;

  INSERT INTO public.audit_logs (
    business_id, actor_id, entity_type, entity_id, action, old_value, new_value
  ) VALUES (
    v_business_id, v_actor_id, 'subscription_payment_request', v_request_id, 'submitted', NULL,
    jsonb_build_object('plan_key', p_plan_key, 'billing_interval', p_billing_interval,
      'purchase_kind', v_purchase_kind, 'target_price', v_target_amount,
      'credit_applied', v_credit, 'amount_due', v_amount, 'currency', v_plan.currency,
      'payment_method', p_payment_method)
  );
  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_submit_subscription_payment_v2(text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_submit_subscription_payment_v2(text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_schedule_subscription_downgrade(
  p_plan_key text,
  p_billing_interval text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
  v_current public.subscriptions%ROWTYPE;
  v_plan public.platform_subscription_plans%ROWTYPE;
  v_current_plan public.platform_subscription_plans%ROWTYPE;
  v_target_amount numeric(10,2);
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_billing_interval NOT IN ('monthly', 'yearly') THEN RAISE EXCEPTION 'Invalid downgrade interval'; END IF;
  SELECT * INTO v_current FROM public.subscriptions WHERE business_id = v_business_id FOR UPDATE;
  IF NOT FOUND OR v_current.license_type = 'lifetime' OR v_current.current_period_end IS NULL THEN
    RAISE EXCEPTION 'A recurring paid subscription is required to schedule a downgrade';
  END IF;
  IF v_current.next_plan_key IS NOT NULL THEN RAISE EXCEPTION 'A plan change is already scheduled'; END IF;
  SELECT * INTO v_plan FROM public.platform_subscription_plans
   WHERE plan_key = p_plan_key AND is_active AND plan_key <> 'trial';
  IF NOT FOUND THEN RAISE EXCEPTION 'Selected plan is unavailable'; END IF;
  SELECT * INTO v_current_plan FROM public.platform_subscription_plans WHERE plan_key = v_current.plan;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current plan is unavailable'; END IF;
  IF (p_billing_interval = 'monthly' AND NOT v_plan.monthly_enabled)
     OR (p_billing_interval = 'yearly' AND NOT v_plan.yearly_enabled) THEN
    RAISE EXCEPTION 'Selected billing interval is unavailable';
  END IF;
  v_target_amount := CASE WHEN p_billing_interval = 'yearly' THEN v_plan.yearly_amount ELSE v_plan.monthly_amount END;
  IF v_plan.sort_order > v_current_plan.sort_order
     OR (v_plan.sort_order = v_current_plan.sort_order AND v_target_amount >= COALESCE(v_current.paid_period_amount, 0)) THEN
    RAISE EXCEPTION 'The selected option is not a downgrade';
  END IF;

  UPDATE public.subscriptions
     SET next_plan_key = p_plan_key,
         next_billing_interval = p_billing_interval,
         next_monthly_amount = v_plan.monthly_amount,
         next_currency = v_plan.currency,
         next_payment_provider = 'manual',
         next_period_start = current_period_end,
         next_period_amount = v_target_amount
   WHERE id = v_current.id;
  INSERT INTO public.subscription_license_events (
    business_id, subscription_id, actor_user_id, event_type, from_plan, to_plan,
    from_interval, to_interval, reason
  ) VALUES (
    v_business_id, v_current.id, v_actor, 'plan_downgrade_scheduled',
    v_current.plan, p_plan_key, v_current.billing_interval, p_billing_interval,
    'Requested downgrade effective at the end of the paid period'
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_schedule_subscription_downgrade(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_schedule_subscription_downgrade(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_apply_subscription_payment(p_payment_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_payment public.subscription_payment_requests%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_event_type text;
  v_period_start timestamptz;
BEGIN
  SELECT * INTO v_payment FROM public.subscription_payment_requests
   WHERE id = p_payment_request_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status <> 'verified' OR v_payment.license_applied_at IS NOT NULL
     OR v_payment.plan_key IS NULL OR v_payment.plan_price_amount IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO v_subscription FROM public.subscriptions
   WHERE id = v_payment.subscription_id AND business_id = v_payment.business_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_payment.billing_interval = 'lifetime' THEN
    v_event_type := CASE WHEN v_subscription.license_type = 'lifetime' THEN 'lifetime_upgraded' ELSE 'lifetime_purchased' END;
    UPDATE public.subscriptions
       SET plan = v_payment.plan_key, status = 'active', license_type = 'lifetime',
           billing_interval = 'lifetime', monthly_amount = v_payment.plan_monthly_amount,
           paid_period_amount = 0,
           lifetime_purchase_credit = CASE WHEN v_subscription.license_type = 'lifetime'
             THEN v_subscription.lifetime_purchase_credit + v_payment.amount
             ELSE v_payment.amount END,
           currency = v_payment.currency,
           payment_provider = CASE WHEN v_payment.payment_method = 'mpesa_stk' THEN 'daraja' ELSE 'manual' END,
           current_period_start = now(), current_period_end = NULL, cancelled_at = NULL,
           next_plan_key = NULL, next_billing_interval = NULL, next_monthly_amount = NULL,
           next_currency = NULL, next_payment_provider = NULL, next_period_start = NULL,
           next_period_amount = NULL
     WHERE id = v_subscription.id;
  ELSIF v_subscription.license_type = 'lifetime' THEN
    RETURN false;
  ELSIF v_payment.purchase_kind = 'subscription'
        AND v_subscription.current_period_end > now() THEN
    UPDATE public.subscriptions
       SET next_plan_key = v_payment.plan_key,
           next_billing_interval = v_payment.billing_interval,
           next_monthly_amount = v_payment.plan_monthly_amount,
           next_currency = v_payment.currency,
           next_payment_provider = CASE WHEN v_payment.payment_method = 'mpesa_stk' THEN 'daraja' ELSE 'manual' END,
           next_period_start = v_subscription.current_period_end,
           next_period_amount = v_payment.plan_price_amount
     WHERE id = v_subscription.id;
    v_event_type := 'subscription_renewed';
  ELSE
    v_period_start := now();
    UPDATE public.subscriptions
       SET plan = v_payment.plan_key, status = 'active', license_type = 'subscription',
           billing_interval = v_payment.billing_interval,
           monthly_amount = v_payment.plan_monthly_amount,
           paid_period_amount = v_payment.plan_price_amount,
           currency = v_payment.currency,
           payment_provider = CASE WHEN v_payment.payment_method = 'mpesa_stk' THEN 'daraja' ELSE 'manual' END,
           current_period_start = v_period_start,
           current_period_end = v_period_start + CASE
             WHEN v_payment.billing_interval = 'yearly' THEN interval '1 year' ELSE interval '1 month' END,
           cancelled_at = NULL,
           next_plan_key = NULL, next_billing_interval = NULL, next_monthly_amount = NULL,
           next_currency = NULL, next_payment_provider = NULL, next_period_start = NULL,
           next_period_amount = NULL
     WHERE id = v_subscription.id;
    v_event_type := CASE WHEN v_payment.purchase_kind = 'plan_upgrade' THEN 'plan_upgraded' ELSE 'subscription_started' END;
  END IF;

  UPDATE public.businesses SET subscription_plan = v_payment.plan_key, subscription_status = 'active'
   WHERE id = v_payment.business_id;
  INSERT INTO public.subscription_license_events (
    business_id, subscription_id, payment_request_id, actor_user_id, event_type,
    from_plan, to_plan, from_interval, to_interval, paid_amount, credit_applied, reason
  ) VALUES (
    v_payment.business_id, v_subscription.id, v_payment.id, v_payment.submitted_by,
    v_event_type, v_subscription.plan, v_payment.plan_key,
    v_subscription.billing_interval, v_payment.billing_interval,
    v_payment.amount, v_payment.credit_applied, 'Verified subscription payment applied'
  );
  UPDATE public.subscription_payment_requests SET license_applied_at = now() WHERE id = v_payment.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_apply_subscription_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_apply_subscription_payment(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.capture_scheduled_period_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.next_plan_key IS NOT NULL AND NEW.next_plan_key IS NULL
     AND NEW.current_period_start IS DISTINCT FROM OLD.current_period_start THEN
    NEW.paid_period_amount := COALESCE(OLD.next_period_amount, NEW.paid_period_amount);
    NEW.next_period_amount := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS capture_scheduled_period_amount ON public.subscriptions;
CREATE TRIGGER capture_scheduled_period_amount
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.capture_scheduled_period_amount();
REVOKE ALL ON FUNCTION public.capture_scheduled_period_amount() FROM PUBLIC, anon, authenticated;

