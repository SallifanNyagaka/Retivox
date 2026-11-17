-- Index foreign-key columns on the newer setup and price-notice ledgers. These
-- tables are service-only, but indexed references keep joins and parent deletes
-- predictable as payment and audit history grows.
CREATE INDEX IF NOT EXISTS idx_platform_business_setup_fee_overrides_updated_by
  ON public.platform_business_setup_fee_overrides (updated_by)
  WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_integration_setup_promotion_redemptions_promotion
  ON public.integration_setup_promotion_redemptions (promotion_id);

CREATE INDEX IF NOT EXISTS idx_integration_setup_fee_credits_promotion
  ON public.integration_setup_fee_credits (promotion_id);

CREATE INDEX IF NOT EXISTS idx_platform_subscription_price_notice_log_business
  ON public.platform_subscription_price_notice_log (business_id);

CREATE INDEX IF NOT EXISTS idx_platform_subscription_price_notice_log_recipient
  ON public.platform_subscription_price_notice_log (recipient_id);

CREATE INDEX IF NOT EXISTS idx_platform_subscription_price_notice_log_notification
  ON public.platform_subscription_price_notice_log (notification_id)
  WHERE notification_id IS NOT NULL;
