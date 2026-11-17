-- Resolve the remaining targeted security advisor findings without changing
-- function behavior or broadening access.
ALTER FUNCTION public.branch_role_rank(text) SET search_path = pg_catalog, public;
ALTER FUNCTION public.slugify_supplier_name(text) SET search_path = pg_catalog, public;
ALTER VIEW public.branch_lot_stock_reconciliation SET (security_invoker = true);
