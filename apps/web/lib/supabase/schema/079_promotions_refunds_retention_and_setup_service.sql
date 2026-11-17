-- Operational records for promotions, integration setup, refunds and exports.
-- Sensitive merchant credentials remain in Vault, never in these request tables.

CREATE TABLE IF NOT EXISTS public.subscription_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  discount_type text NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value numeric(10,2) NOT NULL CHECK (discount_value > 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  usage_limit integer CHECK (usage_limit IS NULL OR usage_limit > 0),
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  eligible_plan_keys text[] NOT NULL DEFAULT '{}',
  eligible_intervals text[] NOT NULL DEFAULT '{}',
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  setup_fee_discount numeric(10,2) NOT NULL DEFAULT 0 CHECK (setup_fee_discount >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR expires_at > starts_at),
  CHECK (cardinality(eligible_intervals) = 0 OR eligible_intervals <@ ARRAY['monthly','yearly','lifetime']::text[]),
  CHECK (discount_type <> 'percentage' OR discount_value <= 100)
);
CREATE INDEX IF NOT EXISTS idx_subscription_promotions_active_window
  ON public.subscription_promotions (is_active, starts_at, expires_at);
ALTER TABLE public.subscription_promotions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_promotions FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.subscription_promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES public.subscription_promotions(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  payment_request_id uuid NOT NULL UNIQUE REFERENCES public.subscription_payment_requests(id) ON DELETE RESTRICT,
  original_amount numeric(10,2) NOT NULL CHECK (original_amount >= 0),
  discount_amount numeric(10,2) NOT NULL CHECK (discount_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscription_promotion_redemptions_business
  ON public.subscription_promotion_redemptions (business_id, created_at DESC);
ALTER TABLE public.subscription_promotion_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_promotion_redemptions FROM PUBLIC, anon, authenticated;

ALTER TABLE public.subscription_payment_requests
  ADD COLUMN IF NOT EXISTS promotion_id uuid REFERENCES public.subscription_promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);

CREATE OR REPLACE FUNCTION public.owner_apply_subscription_promotion(
  p_payment_request_id uuid,
  p_code text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_business_id uuid := public.get_my_business_id();
  v_actor uuid := auth.uid();
  v_request public.subscription_payment_requests%ROWTYPE;
  v_promotion public.subscription_promotions%ROWTYPE;
  v_discount numeric(10,2);
  v_count integer;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_request FROM public.subscription_payment_requests
   WHERE id = p_payment_request_id AND business_id = v_business_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' OR v_request.plan_key IS NULL THEN
    RAISE EXCEPTION 'This subscription request cannot accept a promotion';
  END IF;
  IF v_request.promotion_id IS NOT NULL THEN RAISE EXCEPTION 'A promotion is already applied'; END IF;

  SELECT * INTO v_promotion FROM public.subscription_promotions
   WHERE upper(code) = upper(trim(p_code)) AND is_active
     AND starts_at <= now() AND (expires_at IS NULL OR expires_at > now())
     AND (business_id IS NULL OR business_id = v_business_id)
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Promotion code is invalid or expired'; END IF;
  IF v_promotion.usage_limit IS NOT NULL AND v_promotion.usage_count >= v_promotion.usage_limit THEN
    RAISE EXCEPTION 'Promotion usage limit has been reached';
  END IF;
  IF cardinality(v_promotion.eligible_plan_keys) > 0 AND NOT (v_request.plan_key = ANY(v_promotion.eligible_plan_keys)) THEN
    RAISE EXCEPTION 'Promotion is not valid for this package';
  END IF;
  IF cardinality(v_promotion.eligible_intervals) > 0 AND NOT (v_request.billing_interval = ANY(v_promotion.eligible_intervals)) THEN
    RAISE EXCEPTION 'Promotion is not valid for this billing period';
  END IF;
  SELECT count(*) INTO v_count FROM public.subscription_promotion_redemptions
   WHERE promotion_id = v_promotion.id AND business_id = v_business_id;
  IF v_count > 0 THEN RAISE EXCEPTION 'This business has already used this promotion'; END IF;

  v_discount := least(v_request.amount, round(CASE v_promotion.discount_type
    WHEN 'percentage' THEN v_request.amount * v_promotion.discount_value / 100
    ELSE v_promotion.discount_value END, 2));
  UPDATE public.subscription_payment_requests
     SET amount = greatest(0, v_request.amount - v_discount),
         plan_price_amount = greatest(0, COALESCE(v_request.plan_price_amount, v_request.amount) - v_discount),
         discount_amount = v_discount,
         promotion_id = v_promotion.id,
         provider = CASE WHEN v_request.amount = v_discount THEN 'promotion' ELSE provider END,
         payment_method = CASE WHEN v_request.amount = v_discount THEN 'other' ELSE payment_method END,
         provider_result_description = CASE WHEN v_request.amount = v_discount
           THEN 'Promotion covered the full amount; license activation recorded without an external charge.'
           ELSE provider_result_description END,
         review_note = CASE WHEN v_request.amount = v_discount
           THEN 'Fully discounted by promotion ' || v_promotion.code ELSE review_note END,
         status = CASE WHEN v_request.amount = v_discount THEN 'verified' ELSE status END,
         reviewed_at = CASE WHEN v_request.amount = v_discount THEN now() ELSE reviewed_at END,
         paid_at = CASE WHEN v_request.amount = v_discount THEN now() ELSE paid_at END
   WHERE id = v_request.id;
  UPDATE public.subscription_promotions SET usage_count = usage_count + 1, updated_at = now()
   WHERE id = v_promotion.id;
  INSERT INTO public.subscription_promotion_redemptions (
    promotion_id, business_id, payment_request_id, original_amount, discount_amount
  ) VALUES (v_promotion.id, v_business_id, v_request.id, v_request.amount, v_discount);

  IF v_request.amount = v_discount THEN
    IF NOT public.platform_apply_subscription_payment(v_request.id) THEN
      RAISE EXCEPTION 'The fully discounted license could not be activated';
    END IF;
  END IF;
  RETURN v_discount;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_apply_subscription_promotion(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_apply_subscription_promotion(uuid,text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.platform_integration_setup_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_setup_fee numeric(10,2) NOT NULL DEFAULT 0 CHECK (default_setup_fee >= 0),
  currency char(3) NOT NULL DEFAULT 'KES',
  updated_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_integration_setup_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.platform_integration_setup_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_integration_setup_config FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.integration_setup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  provider text NOT NULL CHECK (provider IN ('daraja', 'pesapal', 'card_gateway', 'bank_transfer')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','quoted','awaiting_payment','in_progress','completed','cancelled')),
  quoted_fee numeric(10,2) NOT NULL DEFAULT 0 CHECK (quoted_fee >= 0),
  currency char(3) NOT NULL DEFAULT 'KES',
  promotion_id uuid REFERENCES public.subscription_promotions(id) ON DELETE SET NULL,
  request_notes text NOT NULL DEFAULT '',
  admin_notes text NOT NULL DEFAULT '',
  setup_payment_reference text,
  setup_payment_status text NOT NULL DEFAULT 'unpaid' CHECK (setup_payment_status IN ('unpaid','pending','paid','waived','refunded')),
  assigned_to uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integration_setup_requests_business
  ON public.integration_setup_requests (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_setup_requests_queue
  ON public.integration_setup_requests (status, created_at DESC);
ALTER TABLE public.integration_setup_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_setup_requests_owner_read ON public.integration_setup_requests
  FOR SELECT TO authenticated
  USING (business_id = public.get_my_business_id() AND public.get_my_global_role() = 'owner');
CREATE POLICY integration_setup_requests_owner_insert ON public.integration_setup_requests
  FOR INSERT TO authenticated
  WITH CHECK (business_id = public.get_my_business_id() AND requested_by = auth.uid() AND public.get_my_global_role() = 'owner');
GRANT SELECT, INSERT ON public.integration_setup_requests TO authenticated;

CREATE TABLE IF NOT EXISTS public.payment_refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','processing','refunded','failed')),
  provider_refund_id text,
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_refund_requests_business_status
  ON public.payment_refund_requests (business_id, status, created_at DESC);
ALTER TABLE public.payment_refund_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_refund_requests_owner_read ON public.payment_refund_requests
  FOR SELECT TO authenticated
  USING (business_id = public.get_my_business_id() AND public.get_my_global_role() IN ('owner','admin'));
GRANT SELECT ON public.payment_refund_requests TO authenticated;

CREATE TABLE IF NOT EXISTS public.platform_subscription_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_request_id uuid NOT NULL REFERENCES public.subscription_payment_requests(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','processing','refunded','failed')),
  provider_refund_id text,
  reason text NOT NULL,
  platform_user_id uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_subscription_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_subscription_refunds FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.platform_retention_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  retention_months integer NOT NULL DEFAULT 12 CHECK (retention_months BETWEEN 1 AND 120),
  updated_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_retention_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.platform_retention_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_retention_settings FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.business_export_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  export_type text NOT NULL CHECK (export_type IN ('csv','xlsx','pdf','json')),
  data_scope text NOT NULL,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_export_events_tenant_created
  ON public.business_export_events (business_id, created_at DESC);
ALTER TABLE public.business_export_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_export_events_owner_read ON public.business_export_events
  FOR SELECT TO authenticated
  USING (business_id = public.get_my_business_id() AND public.get_my_global_role() = 'owner');
CREATE POLICY business_export_events_owner_insert ON public.business_export_events
  FOR INSERT TO authenticated
  WITH CHECK (business_id = public.get_my_business_id() AND actor_user_id = auth.uid() AND public.get_my_global_role() = 'owner');
GRANT SELECT, INSERT ON public.business_export_events TO authenticated;

CREATE TABLE IF NOT EXISTS public.platform_license_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
  platform_user_id uuid NOT NULL REFERENCES public.platform_users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('suspend','reactivate','extend_period','complimentary','assign_lifetime','change_plan')),
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  old_values jsonb NOT NULL,
  new_values jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_license_adjustments_business
  ON public.platform_license_adjustments (business_id, created_at DESC);
ALTER TABLE public.platform_license_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_license_adjustments FROM PUBLIC, anon, authenticated;
