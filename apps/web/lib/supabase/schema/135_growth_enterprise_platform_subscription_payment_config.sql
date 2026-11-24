-- Allow subscription M-Pesa prompts on Growth and Enterprise, and provide
-- platform-managed manual payment directions/support contacts.

UPDATE public.platform_subscription_plans
SET features = jsonb_set(
  COALESCE(features, '{}'::jsonb),
  '{payment_methods}',
  (
    SELECT COALESCE(jsonb_agg(to_jsonb(method) ORDER BY method), '[]'::jsonb)
    FROM (
      SELECT DISTINCT value AS method
      FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(COALESCE(features, '{}'::jsonb)->'payment_methods') = 'array'
          THEN COALESCE(features, '{}'::jsonb)->'payment_methods'
          ELSE '[]'::jsonb
        END
      ) AS existing(value)
      UNION SELECT 'daraja_stk'
    ) AS payment_methods
  ),
  true
), updated_at = now()
WHERE plan_key IN ('growth', 'enterprise');

CREATE TABLE IF NOT EXISTS public.platform_subscription_payment_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  manual_payment_options jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(manual_payment_options) = 'array'),
  support_phone text,
  support_email text,
  support_whatsapp text,
  support_website text,
  support_message text NOT NULL DEFAULT 'Need help with your subscription payment? Call or message us.',
  updated_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_subscription_payment_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_subscription_payment_config FROM PUBLIC, anon, authenticated;
INSERT INTO public.platform_subscription_payment_config (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.subscription_payment_requests
  ADD COLUMN IF NOT EXISTS platform_payment_option_id uuid,
  ADD COLUMN IF NOT EXISTS platform_payment_option_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(platform_payment_option_snapshot) = 'object');

COMMENT ON TABLE public.platform_subscription_payment_config IS
  'Service-role-only platform manual subscription payment destinations and support contact details.';
COMMENT ON COLUMN public.subscription_payment_requests.platform_payment_option_snapshot IS
  'Immutable-at-submission copy of platform payment destination details shown for this manual payment request.';
