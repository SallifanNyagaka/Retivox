/**
 * Safe RLS hardening patch for owner/admin-controlled stock and pricing writes.
 * This migration is intentionally narrow and idempotent so it can be run after
 * the original RLS setup without recreating every policy in 006_rls.sql.
 */

BEGIN;

/**
 * Product pricing creation should be limited to owner/admin users.
 */
DROP POLICY IF EXISTS "product_pricing_insert" ON public.product_pricing;

CREATE POLICY "product_pricing_insert" ON public.product_pricing
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id()
    AND get_my_global_role() IN ('owner', 'admin')
  );

/**
 * Branch stock records should only be created by owner/admin users.
 */
DROP POLICY IF EXISTS "branch_stock_insert" ON public.branch_stock;

CREATE POLICY "branch_stock_insert" ON public.branch_stock
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id()
    AND get_my_global_role() IN ('owner', 'admin')
  );

/**
 * Stock transfer headers should only be created by owner/admin users.
 */
DROP POLICY IF EXISTS "stock_transfers_insert" ON public.stock_transfers;

CREATE POLICY "stock_transfers_insert" ON public.stock_transfers
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id()
    AND get_my_global_role() IN ('owner', 'admin')
  );

/**
 * Stock transfer items should only be created by owner/admin users.
 */
DROP POLICY IF EXISTS "stock_transfer_items_insert" ON public.stock_transfer_items;

CREATE POLICY "stock_transfer_items_insert" ON public.stock_transfer_items
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id()
    AND get_my_global_role() IN ('owner', 'admin')
  );

COMMIT;
