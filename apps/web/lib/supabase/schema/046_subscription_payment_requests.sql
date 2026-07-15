/*
 * Manual subscription payment requests for Retivox.
 *
 * MVP billing starts with one simple rental plan: KES 200/month. Owners submit
 * a payment reference from settings, and the Retivox operator can verify it
 * from the database/admin tooling while we add automated providers later.
 */

ALTER TABLE public.subscriptions
  ALTER COLUMN plan SET DEFAULT 'starter',
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN monthly_amount SET DEFAULT 200,
  ALTER COLUMN currency SET DEFAULT 'KES';

UPDATE public.subscriptions
   SET plan = 'starter',
       monthly_amount = 200,
       currency = COALESCE(NULLIF(currency, ''), 'KES')
 WHERE plan = 'trial'
   AND COALESCE(monthly_amount, 0) = 0;

CREATE TABLE IF NOT EXISTS public.subscription_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL DEFAULT 200,
  currency char(3) NOT NULL DEFAULT 'KES',
  payment_method text NOT NULL DEFAULT 'mpesa_manual',
  reference_code text NOT NULL,
  payer_phone text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_payment_requests_amount_positive CHECK (amount > 0),
  CONSTRAINT subscription_payment_requests_reference_present CHECK (NULLIF(trim(reference_code), '') IS NOT NULL),
  CONSTRAINT subscription_payment_requests_method_valid CHECK (payment_method IN ('mpesa_manual', 'bank_transfer', 'cash_deposit', 'other')),
  CONSTRAINT subscription_payment_requests_status_valid CHECK (status IN ('pending', 'verified', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_subscription_payment_requests_business_status
  ON public.subscription_payment_requests (business_id, status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_payment_requests_subscription
  ON public.subscription_payment_requests (subscription_id, submitted_at DESC);

DROP TRIGGER IF EXISTS touch_subscription_payment_requests_updated_at ON public.subscription_payment_requests;
CREATE TRIGGER touch_subscription_payment_requests_updated_at
BEFORE UPDATE ON public.subscription_payment_requests
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.subscription_payment_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'subscription_payment_requests'
       AND policyname = 'subscription_payment_requests_owner_select'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "subscription_payment_requests_owner_select" ON public.subscription_payment_requests
      FOR SELECT
      USING (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() = 'owner'
      )
    $policy$;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_submit_subscription_payment(
  p_reference_code text,
  p_payment_method text DEFAULT 'mpesa_manual',
  p_payer_phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_subscription public.subscriptions%ROWTYPE;
  v_payment_request_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_payment_method NOT IN ('mpesa_manual', 'bank_transfer', 'cash_deposit', 'other') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  IF length(NULLIF(trim(COALESCE(p_reference_code, '')), '')) < 3 THEN
    RAISE EXCEPTION 'Enter a valid payment reference';
  END IF;

  INSERT INTO public.subscriptions (
    business_id,
    plan,
    status,
    branch_count,
    monthly_amount,
    currency,
    payment_provider,
    current_period_start,
    current_period_end
  )
  VALUES (
    v_business_id,
    'starter',
    'active',
    1,
    200,
    'KES',
    'manual',
    now(),
    now() + interval '1 month'
  )
  ON CONFLICT (business_id) DO UPDATE
     SET plan = COALESCE(NULLIF(public.subscriptions.plan, ''), 'starter'),
         monthly_amount = CASE WHEN COALESCE(public.subscriptions.monthly_amount, 0) <= 0 THEN 200 ELSE public.subscriptions.monthly_amount END,
         currency = COALESCE(NULLIF(public.subscriptions.currency, ''), 'KES'),
         payment_provider = COALESCE(public.subscriptions.payment_provider, 'manual')
  RETURNING * INTO v_subscription;

  INSERT INTO public.subscription_payment_requests (
    business_id,
    subscription_id,
    submitted_by,
    amount,
    currency,
    payment_method,
    reference_code,
    payer_phone,
    status
  )
  VALUES (
    v_business_id,
    v_subscription.id,
    v_actor_id,
    GREATEST(COALESCE(v_subscription.monthly_amount, 200), 1),
    COALESCE(NULLIF(v_subscription.currency, ''), 'KES'),
    p_payment_method,
    trim(p_reference_code),
    NULLIF(trim(COALESCE(p_payer_phone, '')), ''),
    'pending'
  )
  RETURNING id INTO v_payment_request_id;

  INSERT INTO public.audit_logs (
    business_id,
    actor_id,
    entity_type,
    entity_id,
    action,
    old_value,
    new_value
  )
  VALUES (
    v_business_id,
    v_actor_id,
    'subscription_payment_request',
    v_payment_request_id,
    'submitted',
    NULL,
    jsonb_build_object(
      'subscription_id', v_subscription.id,
      'amount', GREATEST(COALESCE(v_subscription.monthly_amount, 200), 1),
      'currency', COALESCE(NULLIF(v_subscription.currency, ''), 'KES'),
      'payment_method', p_payment_method,
      'reference_code', trim(p_reference_code)
    )
  );

  RETURN v_payment_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_my_subscription_payment_requests(p_limit integer DEFAULT 10)
RETURNS TABLE(
  id uuid,
  amount numeric,
  currency char(3),
  payment_method text,
  reference_code text,
  payer_phone text,
  status text,
  review_note text,
  submitted_at timestamptz,
  reviewed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    payment_requests.id,
    payment_requests.amount,
    payment_requests.currency,
    payment_requests.payment_method,
    payment_requests.reference_code,
    payment_requests.payer_phone,
    payment_requests.status,
    payment_requests.review_note,
    payment_requests.submitted_at,
    payment_requests.reviewed_at
  FROM public.subscription_payment_requests AS payment_requests
  WHERE payment_requests.business_id = public.get_my_business_id()
    AND public.get_my_global_role() = 'owner'
  ORDER BY payment_requests.submitted_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;
