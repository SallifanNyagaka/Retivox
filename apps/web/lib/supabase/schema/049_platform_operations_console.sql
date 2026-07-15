/*
 * Platform operations console for Retivox.
 *
 * Adds developer-managed subscription packages, Lipa na M-Pesa receiving
 * settings, and business dormancy lifecycle tracking.
 */

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS platform_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS dormancy_warning_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS dormant_delete_after timestamptz,
  ADD COLUMN IF NOT EXISTS platform_status_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'businesses_platform_status_valid'
       AND conrelid = 'public.businesses'::regclass
  ) THEN
    ALTER TABLE public.businesses
      ADD CONSTRAINT businesses_platform_status_valid CHECK (platform_status IN ('active', 'dormant_warned', 'deactivated', 'deletion_scheduled'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_businesses_platform_status
  ON public.businesses (platform_status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  monthly_amount numeric(10,2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'KES',
  branch_limit integer,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_subscription_plans_key_valid CHECK (plan_key IN ('trial', 'starter', 'growth', 'enterprise')),
  CONSTRAINT platform_subscription_plans_amount_nonnegative CHECK (monthly_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_platform_subscription_plans_active_order
  ON public.platform_subscription_plans (is_active, sort_order);

DROP TRIGGER IF EXISTS touch_platform_subscription_plans_updated_at ON public.platform_subscription_plans;
CREATE TRIGGER touch_platform_subscription_plans_updated_at
BEFORE UPDATE ON public.platform_subscription_plans
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.platform_subscription_plans (
  plan_key,
  name,
  description,
  monthly_amount,
  currency,
  branch_limit,
  is_active,
  sort_order
)
VALUES
  ('trial', 'Trial', 'Free starter workspace for first-time tenants.', 0, 'KES', 1, true, 10),
  ('starter', 'Starter', 'MVP rental plan for small stores.', 200, 'KES', 1, true, 20),
  ('growth', 'Growth', 'Multi-branch retail operations.', 5000, 'KES', 10, true, 30),
  ('enterprise', 'Enterprise', 'Unlimited branches and hands-on support.', 12000, 'KES', NULL, true, 40)
ON CONFLICT (plan_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.platform_payment_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'daraja',
  environment text NOT NULL DEFAULT 'sandbox',
  business_shortcode text NOT NULL,
  account_reference text NOT NULL DEFAULT 'RETIVOX',
  transaction_type text NOT NULL DEFAULT 'CustomerPayBillOnline',
  callback_url text NOT NULL,
  consumer_key text,
  consumer_secret text,
  passkey text,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_payment_settings_provider_valid CHECK (provider IN ('daraja')),
  CONSTRAINT platform_payment_settings_environment_valid CHECK (environment IN ('sandbox', 'production')),
  CONSTRAINT platform_payment_settings_shortcode_present CHECK (NULLIF(trim(business_shortcode), '') IS NOT NULL),
  CONSTRAINT platform_payment_settings_callback_present CHECK (NULLIF(trim(callback_url), '') IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_payment_settings_one_active
  ON public.platform_payment_settings (provider)
  WHERE is_active = true;

DROP TRIGGER IF EXISTS touch_platform_payment_settings_updated_at ON public.platform_payment_settings;
CREATE TRIGGER touch_platform_payment_settings_updated_at
BEFORE UPDATE ON public.platform_payment_settings
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.platform_business_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  platform_user_id uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  owner_email text,
  note text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_business_lifecycle_events_type_valid CHECK (event_type IN ('dormancy_warning_queued', 'dormancy_warning_sent', 'deactivated', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_platform_business_lifecycle_business_created
  ON public.platform_business_lifecycle_events (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  provider text,
  provider_message_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT platform_email_outbox_status_valid CHECK (status IN ('queued', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_platform_email_outbox_status_created
  ON public.platform_email_outbox (status, created_at DESC);

ALTER TABLE public.platform_subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_business_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_email_outbox ENABLE ROW LEVEL SECURITY;
