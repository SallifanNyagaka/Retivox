/*
 * Stock admin branch-scope hardening for Retivox.
 *
 * This additive patch ensures stock visibility cannot be widened by direct
 * Supabase table reads or by calling stock dashboard RPCs with unassigned
 * branch IDs.
 *
 * Required indexes used by these policies/RPCs:
 * - idx_user_branch_roles_user_business_branch_role
 * - idx_branch_stock_business_branch_product
 * - idx_supplier_deliveries_branch_recorded_at
 * - idx_stock_transfers_from_branch_status
 * - idx_stock_transfers_to_branch_status
 * - idx_transactions_branch_recorded_at
 */

BEGIN;

/*
 * Current stock rows are branch-scoped:
 * - owners see every branch in their business
 * - admins/employees see only branches where they have an effective role
 */
DROP POLICY IF EXISTS "branch_stock_select" ON public.branch_stock;
CREATE POLICY "branch_stock_select" ON public.branch_stock
  FOR SELECT
  USING (
    business_id = public.get_my_business_id()
    AND public.branch_role_rank(public.get_effective_branch_role(auth.uid(), branch_id))
      >= public.branch_role_rank('employee')
  );

DROP POLICY IF EXISTS "branch_stock_insert" ON public.branch_stock;
CREATE POLICY "branch_stock_insert" ON public.branch_stock
  FOR INSERT
  WITH CHECK (
    business_id = public.get_my_business_id()
    AND public.branch_role_rank(public.get_effective_branch_role(auth.uid(), branch_id))
      >= public.branch_role_rank('admin')
  );

DROP POLICY IF EXISTS "branch_stock_update" ON public.branch_stock;
CREATE POLICY "branch_stock_update" ON public.branch_stock
  FOR UPDATE
  USING (
    business_id = public.get_my_business_id()
    AND public.branch_role_rank(public.get_effective_branch_role(auth.uid(), branch_id))
      >= public.branch_role_rank('admin')
  )
  WITH CHECK (
    business_id = public.get_my_business_id()
    AND public.branch_role_rank(public.get_effective_branch_role(auth.uid(), branch_id))
      >= public.branch_role_rank('admin')
  );

DROP POLICY IF EXISTS "branch_stock_delete" ON public.branch_stock;
CREATE POLICY "branch_stock_delete" ON public.branch_stock
  FOR DELETE
  USING (
    business_id = public.get_my_business_id()
    AND public.branch_role_rank(public.get_effective_branch_role(auth.uid(), branch_id))
      >= public.branch_role_rank('owner')
  );

/*
 * Supplier delivery headers and line items are stock history, so they follow
 * the delivery branch instead of broad business-wide visibility.
 */
DROP POLICY IF EXISTS "supplier_deliveries_select" ON public.supplier_deliveries;
CREATE POLICY "supplier_deliveries_select" ON public.supplier_deliveries
  FOR SELECT
  USING (
    business_id = public.get_my_business_id()
    AND public.branch_role_rank(public.get_effective_branch_role(auth.uid(), to_branch_id))
      >= public.branch_role_rank('employee')
  );

DROP POLICY IF EXISTS "supplier_delivery_items_select" ON public.supplier_delivery_items;
CREATE POLICY "supplier_delivery_items_select" ON public.supplier_delivery_items
  FOR SELECT
  USING (
    business_id = public.get_my_business_id()
    AND EXISTS (
      SELECT 1
        FROM public.supplier_deliveries
       WHERE supplier_deliveries.id = supplier_delivery_items.delivery_id
         AND supplier_deliveries.business_id = supplier_delivery_items.business_id
         AND public.branch_role_rank(public.get_effective_branch_role(auth.uid(), supplier_deliveries.to_branch_id))
           >= public.branch_role_rank('employee')
    )
  );

/*
 * Stock transfers are visible only when the caller has access to either side
 * of the transfer. Mutation semantics still belong to the transactional RPCs.
 */
DROP POLICY IF EXISTS "stock_transfers_select" ON public.stock_transfers;
CREATE POLICY "stock_transfers_select" ON public.stock_transfers
  FOR SELECT
  USING (
    business_id = public.get_my_business_id()
    AND (
      public.branch_role_rank(public.get_effective_branch_role(auth.uid(), from_branch_id))
        >= public.branch_role_rank('employee')
      OR public.branch_role_rank(public.get_effective_branch_role(auth.uid(), to_branch_id))
        >= public.branch_role_rank('employee')
    )
  );

DROP POLICY IF EXISTS "stock_transfer_items_select" ON public.stock_transfer_items;
CREATE POLICY "stock_transfer_items_select" ON public.stock_transfer_items
  FOR SELECT
  USING (
    business_id = public.get_my_business_id()
    AND EXISTS (
      SELECT 1
        FROM public.stock_transfers
       WHERE stock_transfers.id = stock_transfer_items.transfer_id
         AND stock_transfers.business_id = stock_transfer_items.business_id
         AND (
           public.branch_role_rank(public.get_effective_branch_role(auth.uid(), stock_transfers.from_branch_id))
             >= public.branch_role_rank('employee')
           OR public.branch_role_rank(public.get_effective_branch_role(auth.uid(), stock_transfers.to_branch_id))
             >= public.branch_role_rank('employee')
         )
    )
  );

/*
 * Stock metrics self-scope inside the RPC. The caller can pass fewer assigned
 * branches to filter down, but cannot pass extra branches to widen access.
 */
CREATE OR REPLACE FUNCTION public.dashboard_stock_metrics(p_branch_ids uuid[])
RETURNS TABLE(
  total_skus integer,
  low_stock_count integer,
  out_of_stock_count integer,
  branches_with_alerts integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH authorized_branches AS (
    SELECT accessible.branch_id
      FROM public.get_accessible_branch_ids(auth.uid(), 'admin') AS accessible
     WHERE accessible.branch_id = ANY(COALESCE(p_branch_ids, ARRAY[]::uuid[]))
  )
  SELECT
    COUNT(*)::integer AS total_skus,
    COUNT(*) FILTER (
      WHERE branch_stock.quantity_on_hand > 0
        AND branch_stock.quantity_on_hand <= branch_stock.low_stock_threshold
    )::integer AS low_stock_count,
    COUNT(*) FILTER (WHERE branch_stock.quantity_on_hand = 0)::integer AS out_of_stock_count,
    COUNT(DISTINCT branch_stock.branch_id) FILTER (
      WHERE branch_stock.quantity_on_hand <= branch_stock.low_stock_threshold
    )::integer AS branches_with_alerts
  FROM public.branch_stock
  WHERE branch_stock.business_id = public.get_my_business_id()
    AND branch_stock.branch_id IN (SELECT authorized_branches.branch_id FROM authorized_branches);
$$;

/*
 * Movement history self-scopes inside the RPC. This protects direct RPC calls
 * from viewing stock movement outside the caller's assigned branches.
 */
CREATE OR REPLACE FUNCTION public.dashboard_stock_movement_history(
  p_branch_ids uuid[],
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  movement_id uuid,
  branch_id uuid,
  product_id uuid,
  product_name text,
  branch_name text,
  movement_type text,
  quantity integer,
  actor_name text,
  reference_label text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH authorized_branches AS (
    SELECT accessible.branch_id
      FROM public.get_accessible_branch_ids(auth.uid(), 'admin') AS accessible
     WHERE accessible.branch_id = ANY(COALESCE(p_branch_ids, ARRAY[]::uuid[]))
  ),
  movements AS (
    SELECT
      supplier_delivery_items.id AS movement_id,
      supplier_deliveries.to_branch_id AS branch_id,
      supplier_delivery_items.product_id,
      products.name AS product_name,
      branches.name AS branch_name,
      'supplier_delivery'::text AS movement_type,
      supplier_delivery_items.quantity_received AS quantity,
      users.name AS actor_name,
      supplier_deliveries.reference_code AS reference_label,
      supplier_deliveries.recorded_at AS created_at
    FROM public.supplier_delivery_items
    JOIN public.supplier_deliveries
      ON supplier_deliveries.id = supplier_delivery_items.delivery_id
    JOIN public.products
      ON products.id = supplier_delivery_items.product_id
    JOIN public.branches
      ON branches.id = supplier_deliveries.to_branch_id
    LEFT JOIN public.users
      ON users.id = supplier_deliveries.received_by
    WHERE supplier_deliveries.business_id = public.get_my_business_id()
      AND supplier_deliveries.to_branch_id IN (SELECT authorized_branches.branch_id FROM authorized_branches)

    UNION ALL

    SELECT
      stock_transfer_items.id AS movement_id,
      stock_transfers.from_branch_id AS branch_id,
      stock_transfer_items.product_id,
      products.name AS product_name,
      branches.name AS branch_name,
      'transfer_out'::text AS movement_type,
      -stock_transfer_items.quantity_sent AS quantity,
      users.name AS actor_name,
      stock_transfers.id::text AS reference_label,
      stock_transfers.initiated_at AS created_at
    FROM public.stock_transfer_items
    JOIN public.stock_transfers
      ON stock_transfers.id = stock_transfer_items.transfer_id
    JOIN public.products
      ON products.id = stock_transfer_items.product_id
    JOIN public.branches
      ON branches.id = stock_transfers.from_branch_id
    LEFT JOIN public.users
      ON users.id = stock_transfers.initiated_by
    WHERE stock_transfers.business_id = public.get_my_business_id()
      AND stock_transfers.from_branch_id IN (SELECT authorized_branches.branch_id FROM authorized_branches)

    UNION ALL

    SELECT
      stock_transfer_items.id AS movement_id,
      stock_transfers.to_branch_id AS branch_id,
      stock_transfer_items.product_id,
      products.name AS product_name,
      branches.name AS branch_name,
      'transfer_in'::text AS movement_type,
      COALESCE(stock_transfer_items.quantity_received, stock_transfer_items.quantity_sent) AS quantity,
      users.name AS actor_name,
      stock_transfers.id::text AS reference_label,
      COALESCE(stock_transfers.received_at, stock_transfers.initiated_at) AS created_at
    FROM public.stock_transfer_items
    JOIN public.stock_transfers
      ON stock_transfers.id = stock_transfer_items.transfer_id
    JOIN public.products
      ON products.id = stock_transfer_items.product_id
    JOIN public.branches
      ON branches.id = stock_transfers.to_branch_id
    LEFT JOIN public.users
      ON users.id = COALESCE(stock_transfers.received_by, stock_transfers.initiated_by)
    WHERE stock_transfers.business_id = public.get_my_business_id()
      AND stock_transfers.to_branch_id IN (SELECT authorized_branches.branch_id FROM authorized_branches)
      AND stock_transfers.status IN ('received', 'disputed')

    UNION ALL

    SELECT
      transaction_items.id AS movement_id,
      transactions.branch_id AS branch_id,
      transaction_items.product_id,
      products.name AS product_name,
      branches.name AS branch_name,
      'sale_deduction'::text AS movement_type,
      -transaction_items.quantity AS quantity,
      users.name AS actor_name,
      transactions.id::text AS reference_label,
      transactions.recorded_at AS created_at
    FROM public.transaction_items
    JOIN public.transactions
      ON transactions.id = transaction_items.transaction_id
    JOIN public.products
      ON products.id = transaction_items.product_id
    JOIN public.branches
      ON branches.id = transactions.branch_id
    LEFT JOIN public.users
      ON users.id = transactions.employee_id
    WHERE transactions.business_id = public.get_my_business_id()
      AND transactions.branch_id IN (SELECT authorized_branches.branch_id FROM authorized_branches)
      AND transaction_items.stock_status = 'deducted'
  )
  SELECT *
    FROM movements
   ORDER BY created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 25)
  OFFSET GREATEST(p_offset, 0);
$$;

COMMIT;
