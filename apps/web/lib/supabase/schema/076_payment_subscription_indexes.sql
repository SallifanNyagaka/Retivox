-- Cover foreign keys introduced for credential ownership and lifecycle alerts.
CREATE INDEX IF NOT EXISTS idx_business_payment_provider_settings_updated_by
  ON public.business_payment_provider_settings (updated_by)
  WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscription_lifecycle_notice_recipient
  ON public.subscription_lifecycle_notice_log (recipient_id, created_at DESC);
