-- Complete assisted integration setup pricing: business-specific fee overrides,
-- owner-entered setup promotions, and platform-managed payment reconciliation.

CREATE TABLE IF NOT EXISTS public.platform_business_setup_fee_overrides (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  fee numeric(10,2) NOT NULL CHECK (fee >= 0),
  currency char(3) NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  updated_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_business_setup_fee_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_business_setup_fee_overrides FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_business_setup_fee_overrides TO service_role;

CREATE TABLE IF NOT EXISTS public.integration_setup_promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES public.subscription_promotions(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  setup_request_id uuid NOT NULL UNIQUE REFERENCES public.integration_setup_requests(id) ON DELETE CASCADE,
  original_amount numeric(10,2) NOT NULL CHECK (original_amount >= 0),
  discount_amount numeric(10,2) NOT NULL CHECK (discount_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integration_setup_promotion_redemptions_business
  ON public.integration_setup_promotion_redemptions (business_id, created_at DESC);
ALTER TABLE public.integration_setup_promotion_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integration_setup_promotion_redemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.integration_setup_promotion_redemptions TO service_role;

CREATE TABLE IF NOT EXISTS public.integration_setup_fee_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  subscription_payment_request_id uuid NOT NULL UNIQUE REFERENCES public.subscription_payment_requests(id) ON DELETE RESTRICT,
  promotion_id uuid NOT NULL REFERENCES public.subscription_promotions(id) ON DELETE RESTRICT,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  expires_at timestamptz,
  redeemed_by_setup_request_id uuid UNIQUE REFERENCES public.integration_setup_requests(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integration_setup_fee_credits_available
  ON public.integration_setup_fee_credits (business_id, created_at)
  WHERE redeemed_by_setup_request_id IS NULL;
ALTER TABLE public.integration_setup_fee_credits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integration_setup_fee_credits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.integration_setup_fee_credits TO service_role;

CREATE OR REPLACE FUNCTION public.issue_integration_setup_fee_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_promotion public.subscription_promotions%ROWTYPE;
BEGIN
  IF NEW.status <> 'verified' OR OLD.status = 'verified' OR NEW.promotion_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_promotion
    FROM public.subscription_promotions
   WHERE id = NEW.promotion_id;
  IF NOT FOUND OR v_promotion.setup_fee_discount <= 0
     OR (cardinality(v_promotion.eligible_plan_keys) > 0 AND NOT (NEW.plan_key = ANY(v_promotion.eligible_plan_keys)))
     OR (cardinality(v_promotion.eligible_intervals) > 0 AND NOT (NEW.billing_interval = ANY(v_promotion.eligible_intervals))) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.integration_setup_fee_credits (
    business_id, subscription_payment_request_id, promotion_id, amount, currency, expires_at
  ) VALUES (
    NEW.business_id, NEW.id, v_promotion.id, v_promotion.setup_fee_discount,
    upper(NEW.currency), v_promotion.expires_at
  ) ON CONFLICT (subscription_payment_request_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_integration_setup_fee_credit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS issue_integration_setup_fee_credit ON public.subscription_payment_requests;
CREATE TRIGGER issue_integration_setup_fee_credit
AFTER UPDATE OF status ON public.subscription_payment_requests
FOR EACH ROW EXECUTE FUNCTION public.issue_integration_setup_fee_credit();

-- The old direct INSERT grant allowed owners to choose a fake quote or mark an
-- arbitrary promotion on their own request. Requests must now use this checked RPC.
REVOKE INSERT ON TABLE public.integration_setup_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.owner_request_integration_setup(
  p_provider text,
  p_request_notes text DEFAULT '',
  p_promotion_code text DEFAULT NULL
)
RETURNS TABLE(request_id uuid, quoted_fee numeric, currency text, setup_payment_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_business uuid := public.get_my_business_id();
  v_fee numeric(10,2);
  v_original_fee numeric(10,2);
  v_currency text;
  v_override_fee numeric(10,2);
  v_override_currency text;
  v_promotion public.subscription_promotions%ROWTYPE;
  v_discount numeric(10,2) := 0;
  v_promotion_id uuid;
  v_request_id uuid;
  v_payment_status text;
  v_credit public.integration_setup_fee_credits%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_business IS NULL OR public.get_my_global_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_provider IS NULL OR p_provider NOT IN ('daraja','pesapal','card_gateway','bank_transfer') THEN
    RAISE EXCEPTION 'Select a supported integration provider';
  END IF;
  IF length(COALESCE(p_request_notes,'')) > 2000 THEN
    RAISE EXCEPTION 'Setup request notes are too long';
  END IF;

  SELECT config.default_setup_fee, upper(config.currency)
    INTO v_fee, v_currency
    FROM public.platform_integration_setup_config config
   WHERE config.id = true;
  IF NOT FOUND THEN
    v_fee := 0;
    v_currency := 'KES';
  END IF;
  SELECT override.fee, upper(override.currency)
    INTO v_override_fee, v_override_currency
    FROM public.platform_business_setup_fee_overrides override
   WHERE override.business_id = v_business;
  IF FOUND THEN
    v_fee := v_override_fee;
    v_currency := v_override_currency;
  END IF;
  v_original_fee := v_fee;

  IF NULLIF(trim(COALESCE(p_promotion_code,'')), '') IS NULL THEN
    SELECT * INTO v_credit
      FROM public.integration_setup_fee_credits credit
     WHERE credit.business_id = v_business
       AND credit.redeemed_by_setup_request_id IS NULL
       AND (credit.expires_at IS NULL OR credit.expires_at > now())
       AND upper(credit.currency) = upper(v_currency)
     ORDER BY credit.created_at, credit.id
     LIMIT 1
     FOR UPDATE;
    IF FOUND THEN
      v_discount := least(v_fee, v_credit.amount);
      v_fee := greatest(0, v_fee - v_discount);
      v_promotion_id := v_credit.promotion_id;
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.integration_setup_fee_credits credit
       WHERE credit.business_id = v_business
         AND credit.redeemed_by_setup_request_id IS NULL
         AND (credit.expires_at IS NULL OR credit.expires_at > now())
         AND upper(credit.currency) = upper(v_currency)
    ) THEN
      RAISE EXCEPTION 'A setup discount from your eligible subscription purchase will be applied automatically. Remove the promotion code to use it.';
    END IF;
    SELECT promotion.* INTO v_promotion
      FROM public.subscription_promotions promotion
     WHERE upper(trim(promotion.code)) = upper(trim(p_promotion_code))
     FOR UPDATE;
    IF NOT FOUND OR NOT v_promotion.is_active
       OR v_promotion.starts_at > now()
       OR (v_promotion.expires_at IS NOT NULL AND v_promotion.expires_at <= now())
       OR (v_promotion.usage_limit IS NOT NULL AND v_promotion.usage_count >= v_promotion.usage_limit)
       OR (v_promotion.business_id IS NOT NULL AND v_promotion.business_id <> v_business)
       OR cardinality(v_promotion.eligible_plan_keys) > 0
       OR cardinality(v_promotion.eligible_intervals) > 0
       OR v_promotion.setup_fee_discount <= 0 THEN
      RAISE EXCEPTION 'This promotion is invalid or not eligible for assisted setup';
    END IF;
    v_discount := least(v_fee, v_promotion.setup_fee_discount);
    v_fee := greatest(0, v_fee - v_discount);
    v_promotion_id := v_promotion.id;
  END IF;

  v_payment_status := CASE WHEN v_fee = 0 THEN 'waived' ELSE 'unpaid' END;
  INSERT INTO public.integration_setup_requests (
    business_id, requested_by, provider, status, quoted_fee, currency,
    promotion_id, request_notes, setup_payment_status
  ) VALUES (
    v_business, v_actor, p_provider, 'requested', v_fee, v_currency,
    v_promotion_id, trim(COALESCE(p_request_notes,'')), v_payment_status
  ) RETURNING id INTO v_request_id;

  IF v_credit.id IS NOT NULL THEN
    UPDATE public.integration_setup_fee_credits
       SET redeemed_by_setup_request_id = v_request_id
     WHERE id = v_credit.id;
  ELSIF v_promotion_id IS NOT NULL THEN
    INSERT INTO public.integration_setup_promotion_redemptions (
      promotion_id, business_id, setup_request_id, original_amount, discount_amount
    ) VALUES (v_promotion_id, v_business, v_request_id, v_original_fee, v_discount);
    UPDATE public.subscription_promotions
       SET usage_count = usage_count + 1, updated_at = now()
     WHERE id = v_promotion_id;
  END IF;

  INSERT INTO public.audit_logs (
    business_id, actor_id, entity_type, entity_id, action, old_value, new_value
  ) VALUES (
    v_business, v_actor, 'integration_setup_request', v_request_id, 'requested', NULL,
    jsonb_build_object('provider',p_provider,'quoted_fee',v_fee,'currency',v_currency,
      'promotion_id',v_promotion_id,'discount_amount',v_discount)
  );
  RETURN QUERY SELECT v_request_id, v_fee, v_currency, v_payment_status;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_request_integration_setup(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_request_integration_setup(text,text,text) TO authenticated;
