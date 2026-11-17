-- Platform operations tables are accessed through server-side service-role
-- code. Remove their unused direct Data API grants.
REVOKE ALL ON TABLE public.platform_audit_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_business_lifecycle_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_email_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_login_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_payment_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_users FROM PUBLIC, anon, authenticated;

-- Active plan names, features, and prices are public catalog data. The owner
-- subscription API uses the authenticated Data API client to list these.
DROP POLICY IF EXISTS platform_subscription_plans_active_read ON public.platform_subscription_plans;
CREATE POLICY platform_subscription_plans_active_read ON public.platform_subscription_plans
  FOR SELECT TO anon, authenticated USING (is_active=true);
REVOKE ALL ON TABLE public.platform_subscription_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_subscription_plans TO anon, authenticated;
