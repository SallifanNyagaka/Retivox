-- Keep version history available to trusted server-side operations while
-- leaving it inaccessible to browser and mobile clients.
CREATE INDEX IF NOT EXISTS idx_business_payment_method_versions_business
  ON public.business_payment_method_versions (business_id, business_payment_method_id);

DROP POLICY IF EXISTS business_payment_method_versions_service_role
  ON public.business_payment_method_versions;
CREATE POLICY business_payment_method_versions_service_role
  ON public.business_payment_method_versions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
