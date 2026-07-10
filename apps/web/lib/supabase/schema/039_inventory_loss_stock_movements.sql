/*
 * Inventory loss stock movements for Retivox.
 *
 * Damaged/lost stock is removed from normal branch stock by
 * record_inventory_loss_event. This migration makes that removal visible in
 * the stock movement history and separates later recovery sales from normal
 * stock sale deductions.
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
      inventory_loss_events.id AS movement_id,
      inventory_loss_events.branch_id,
      inventory_loss_events.product_id,
      products.name AS product_name,
      branches.name AS branch_name,
      'inventory_loss'::text AS movement_type,
      -floor(inventory_loss_events.base_quantity)::integer AS quantity,
      users.name AS actor_name,
      concat(initcap(replace(inventory_loss_events.loss_type, '_', ' ')), ': ', inventory_loss_events.reason) AS reference_label,
      inventory_loss_events.created_at
    FROM public.inventory_loss_events
    JOIN public.products
      ON products.id = inventory_loss_events.product_id
    JOIN public.branches
      ON branches.id = inventory_loss_events.branch_id
    LEFT JOIN public.users
      ON users.id = inventory_loss_events.created_by
    WHERE inventory_loss_events.business_id = public.get_my_business_id()
      AND inventory_loss_events.branch_id IN (SELECT authorized_branches.branch_id FROM authorized_branches)

    UNION ALL

    SELECT
      transaction_items.id AS movement_id,
      transactions.branch_id AS branch_id,
      transaction_items.product_id,
      products.name AS product_name,
      branches.name AS branch_name,
      CASE
        WHEN transaction_items.recovery_item_id IS NOT NULL THEN 'recovery_sale'
        ELSE 'sale_deduction'
      END AS movement_type,
      -transaction_items.quantity AS quantity,
      users.name AS actor_name,
      COALESCE(inventory_recovery_items.label, transactions.id::text) AS reference_label,
      transactions.recorded_at AS created_at
    FROM public.transaction_items
    JOIN public.transactions
      ON transactions.id = transaction_items.transaction_id
    JOIN public.products
      ON products.id = transaction_items.product_id
    JOIN public.branches
      ON branches.id = transactions.branch_id
    LEFT JOIN public.inventory_recovery_items
      ON inventory_recovery_items.id = transaction_items.recovery_item_id
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
