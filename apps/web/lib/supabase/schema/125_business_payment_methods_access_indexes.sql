-- Keep payment destination rows available to service-role APIs only, with an
-- explicit client deny policy and an index for the updated_by foreign key.
CREATE INDEX IF NOT EXISTS idx_business_payment_methods_updated_by
  ON public.business_payment_methods (updated_by)
  WHERE updated_by IS NOT NULL;

DROP POLICY IF EXISTS business_payment_methods_deny_client_access
  ON public.business_payment_methods;
CREATE POLICY business_payment_methods_deny_client_access
  ON public.business_payment_methods
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);
