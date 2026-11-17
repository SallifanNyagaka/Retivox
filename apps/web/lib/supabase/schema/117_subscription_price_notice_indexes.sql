-- Keep the owner notification fan-out selective as the tenant catalog grows.
CREATE INDEX IF NOT EXISTS idx_subscriptions_price_notice_eligible
  ON public.subscriptions (plan, billing_interval)
  WHERE license_type = 'subscription' AND status IN ('active', 'past_due');

CREATE INDEX IF NOT EXISTS idx_users_active_business_owners
  ON public.users (business_id)
  WHERE global_role = 'owner' AND is_active = true AND deleted_at IS NULL;
