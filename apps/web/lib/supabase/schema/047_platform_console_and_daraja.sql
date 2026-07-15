/*
 * Platform console and Daraja STK Push billing for Retivox.
 *
 * Platform users are separate from tenant business users. They operate Retivox
 * itself: subscriptions, payment status, platform-level login audits, and
 * business oversight.
 */

CREATE TABLE IF NOT EXISTS public.platform_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'developer',
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_users_role_valid CHECK (role IN ('developer', 'operator', 'support'))
);

CREATE TABLE IF NOT EXISTS public.platform_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id uuid NOT NULL REFERENCES public.platform_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  ip_address text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_sessions_user
  ON public.platform_sessions (platform_user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_sessions_token_hash
  ON public.platform_sessions (token_hash);

CREATE TABLE IF NOT EXISTS public.platform_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  platform_user_id uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  email text NOT NULL,
  attempted_role text,
  surface text NOT NULL DEFAULT 'tenant',
  success boolean NOT NULL,
  failure_reason text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_login_attempts_surface_valid CHECK (surface IN ('tenant', 'platform'))
);

CREATE INDEX IF NOT EXISTS idx_platform_login_attempts_business_created
  ON public.platform_login_attempts (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_login_attempts_surface_created
  ON public.platform_login_attempts (surface, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_login_attempts_email_created
  ON public.platform_login_attempts (email, created_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_created
  ON public.platform_audit_logs (created_at DESC);

ALTER TABLE public.subscription_payment_requests
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_merchant_request_id text,
  ADD COLUMN IF NOT EXISTS provider_checkout_request_id text,
  ADD COLUMN IF NOT EXISTS provider_result_code integer,
  ADD COLUMN IF NOT EXISTS provider_result_description text,
  ADD COLUMN IF NOT EXISTS raw_provider_payload jsonb,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_subscription_payment_requests_checkout
  ON public.subscription_payment_requests (provider_checkout_request_id);

DROP TRIGGER IF EXISTS touch_platform_users_updated_at ON public.platform_users;
CREATE TRIGGER touch_platform_users_updated_at
BEFORE UPDATE ON public.platform_users
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.platform_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.platform_record_daraja_payment_result(
  p_checkout_request_id text,
  p_merchant_request_id text,
  p_result_code integer,
  p_result_description text,
  p_raw_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.subscription_payment_requests%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_new_period_start timestamptz;
  v_new_period_end timestamptz;
BEGIN
  SELECT *
    INTO v_payment
    FROM public.subscription_payment_requests
   WHERE provider_checkout_request_id = p_checkout_request_id
   ORDER BY submitted_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.platform_audit_logs (
      entity_type,
      action,
      old_value,
      new_value
    )
    VALUES (
      'subscription_payment_request',
      'daraja_callback_unmatched',
      NULL,
      jsonb_build_object(
        'checkout_request_id', p_checkout_request_id,
        'merchant_request_id', p_merchant_request_id,
        'result_code', p_result_code,
        'result_description', p_result_description
      )
    );
    RETURN;
  END IF;

  UPDATE public.subscription_payment_requests
     SET provider_merchant_request_id = COALESCE(p_merchant_request_id, provider_merchant_request_id),
         provider_result_code = p_result_code,
         provider_result_description = p_result_description,
         raw_provider_payload = p_raw_payload,
         status = CASE WHEN p_result_code = 0 THEN 'verified' ELSE 'rejected' END,
         paid_at = CASE WHEN p_result_code = 0 THEN now() ELSE paid_at END,
         reviewed_at = now(),
         review_note = p_result_description
   WHERE id = v_payment.id;

  IF p_result_code = 0 THEN
    SELECT *
      INTO v_subscription
      FROM public.subscriptions
     WHERE id = v_payment.subscription_id
     FOR UPDATE;

    IF FOUND THEN
      v_new_period_start := GREATEST(COALESCE(v_subscription.current_period_end, now()), now());
      v_new_period_end := v_new_period_start + interval '1 month';

      UPDATE public.subscriptions
         SET status = 'active',
             plan = COALESCE(NULLIF(plan, ''), 'starter'),
             monthly_amount = CASE WHEN COALESCE(monthly_amount, 0) <= 0 THEN v_payment.amount ELSE monthly_amount END,
             currency = COALESCE(NULLIF(currency, ''), v_payment.currency),
             payment_provider = 'daraja',
             current_period_start = v_new_period_start,
             current_period_end = v_new_period_end
       WHERE id = v_subscription.id;

      UPDATE public.businesses
         SET subscription_plan = COALESCE(NULLIF(v_subscription.plan, ''), 'starter'),
             subscription_status = 'active'
       WHERE id = v_payment.business_id;
    END IF;
  END IF;

  INSERT INTO public.platform_audit_logs (
    entity_type,
    entity_id,
    action,
    old_value,
    new_value
  )
  VALUES (
    'subscription_payment_request',
    v_payment.id,
    CASE WHEN p_result_code = 0 THEN 'daraja_payment_verified' ELSE 'daraja_payment_failed' END,
    jsonb_build_object('status', v_payment.status),
    jsonb_build_object(
      'checkout_request_id', p_checkout_request_id,
      'merchant_request_id', p_merchant_request_id,
      'result_code', p_result_code,
      'result_description', p_result_description
    )
  );
END;
$$;
