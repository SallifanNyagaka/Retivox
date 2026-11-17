-- Trigger functions execute through their attached triggers and are not RPCs.
-- Remove the unnecessary direct PostgREST execute grants for these functions.
REVOKE ALL ON FUNCTION public.validate_product_uom_link_business() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_uom_table_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_product_pricing_model_scope() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_product_price_point_scope() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_product_pricing_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_cash_deposit_stage() FROM PUBLIC, anon, authenticated;
