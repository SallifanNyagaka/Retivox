/*
 * Stock section admin capabilities for Retivox.
 *
 * Additive migration for the branch-scoped stock specification:
 * - supplier deliveries are recorded atomically
 * - low-stock thresholds are updated with audit logs
 * - movement history is exposed through a paginated RPC
 *
 * Required indexes for stock dashboard data access:
 * - idx_branch_stock_business_branch_product
 * - idx_supplier_deliveries_branch_recorded_at
 * - idx_stock_transfers_from_branch_status
 * - idx_stock_transfers_to_branch_status
 * - idx_transactions_branch_recorded_at
 * - idx_transaction_items_business_product_transaction
 */

CREATE OR REPLACE FUNCTION public.dashboard_record_supplier_delivery(
  p_branch_id uuid,
  p_supplier_name text,
  p_reference_code text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_effective_role text;
  v_delivery_id uuid;
  v_item record;
  v_stock public.branch_stock%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_effective_role := public.get_effective_branch_role(v_actor_id, p_branch_id);

  IF public.branch_role_rank(v_effective_role) < public.branch_role_rank('admin') THEN
    PERFORM public.log_branch_access_denial(
      v_actor_id,
      p_branch_id,
      'admin',
      v_effective_role,
      'dashboard_record_supplier_delivery'
    );
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NULLIF(trim(p_supplier_name), '') IS NULL THEN
    RAISE EXCEPTION 'Supplier name is required';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one delivered product';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.branches
     WHERE id = p_branch_id
       AND business_id = v_business_id
  ) THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  INSERT INTO public.supplier_deliveries (
    business_id,
    to_branch_id,
    received_by,
    supplier_name,
    reference_code,
    status,
    delivered_at
  )
  VALUES (
    v_business_id,
    p_branch_id,
    v_actor_id,
    trim(p_supplier_name),
    NULLIF(trim(p_reference_code), ''),
    'received',
    now()
  )
  RETURNING id INTO v_delivery_id;

  FOR v_item IN
    SELECT
      (item_value->>'productId')::uuid AS product_id,
      SUM((item_value->>'quantity')::integer)::integer AS quantity,
      MAX(NULLIF(item_value->>'unitCost', '')::numeric) AS unit_cost,
      MAX(NULLIF(item_value->>'notes', '')) AS notes
    FROM jsonb_array_elements(p_items) AS item_value
    GROUP BY (item_value->>'productId')::uuid
  LOOP
    IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Quantity must be greater than zero';
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM public.products
       WHERE id = v_item.product_id
         AND business_id = v_business_id
    ) THEN
      RAISE EXCEPTION 'One or more products are invalid';
    END IF;

    SELECT *
      INTO v_stock
      FROM public.branch_stock
     WHERE business_id = v_business_id
       AND branch_id = p_branch_id
       AND product_id = v_item.product_id
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.branch_stock
         SET quantity_on_hand = quantity_on_hand + v_item.quantity,
             last_updated_at = now()
       WHERE id = v_stock.id;
    ELSE
      INSERT INTO public.branch_stock (
        branch_id,
        product_id,
        business_id,
        quantity_on_hand,
        quantity_reserved,
        low_stock_threshold
      )
      VALUES (
        p_branch_id,
        v_item.product_id,
        v_business_id,
        v_item.quantity,
        0,
        10
      )
      RETURNING * INTO v_stock;
    END IF;

    INSERT INTO public.supplier_delivery_items (
      delivery_id,
      product_id,
      business_id,
      quantity_expected,
      quantity_received,
      quantity_discrepancy,
      unit_cost,
      notes
    )
    VALUES (
      v_delivery_id,
      v_item.product_id,
      v_business_id,
      v_item.quantity,
      v_item.quantity,
      0,
      v_item.unit_cost,
      v_item.notes
    );
  END LOOP;

  INSERT INTO public.audit_logs (
    business_id,
    actor_id,
    entity_type,
    entity_id,
    action,
    old_value,
    new_value
  )
  VALUES (
    v_business_id,
    v_actor_id,
    'supplier_delivery',
    v_delivery_id,
    'received',
    NULL,
    jsonb_build_object(
      'branch_id', p_branch_id,
      'effective_role', v_effective_role,
      'supplier_name', trim(p_supplier_name),
      'reference_code', NULLIF(trim(p_reference_code), ''),
      'item_count', jsonb_array_length(p_items)
    )
  );

  RETURN v_delivery_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_update_low_stock_threshold(
  p_stock_id uuid,
  p_branch_id uuid,
  p_threshold integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_effective_role text;
  v_stock public.branch_stock%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_effective_role := public.get_effective_branch_role(v_actor_id, p_branch_id);

  IF public.branch_role_rank(v_effective_role) < public.branch_role_rank('admin') THEN
    PERFORM public.log_branch_access_denial(
      v_actor_id,
      p_branch_id,
      'admin',
      v_effective_role,
      'dashboard_update_low_stock_threshold'
    );
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_threshold IS NULL OR p_threshold < 0 THEN
    RAISE EXCEPTION 'Threshold must be zero or greater';
  END IF;

  SELECT *
    INTO v_stock
    FROM public.branch_stock
   WHERE id = p_stock_id
     AND branch_id = p_branch_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock record not found';
  END IF;

  UPDATE public.branch_stock
     SET low_stock_threshold = p_threshold,
         last_updated_at = now()
   WHERE id = v_stock.id;

  INSERT INTO public.audit_logs (
    business_id,
    actor_id,
    entity_type,
    entity_id,
    action,
    old_value,
    new_value
  )
  VALUES (
    v_business_id,
    v_actor_id,
    'branch_stock',
    v_stock.id,
    'threshold_updated',
    jsonb_build_object(
      'branch_id', p_branch_id,
      'low_stock_threshold', v_stock.low_stock_threshold
    ),
    jsonb_build_object(
      'branch_id', p_branch_id,
      'effective_role', v_effective_role,
      'low_stock_threshold', p_threshold
    )
  );
END;
$$;

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
  WITH movements AS (
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
      AND supplier_deliveries.to_branch_id = ANY(p_branch_ids)

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
      AND stock_transfers.from_branch_id = ANY(p_branch_ids)

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
      AND stock_transfers.to_branch_id = ANY(p_branch_ids)
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
      AND transactions.branch_id = ANY(p_branch_ids)
      AND transaction_items.stock_status = 'deducted'
  )
  SELECT *
    FROM movements
   ORDER BY created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 25)
  OFFSET GREATEST(p_offset, 0);
$$;

CREATE INDEX IF NOT EXISTS idx_supplier_deliveries_branch_recorded_at
  ON public.supplier_deliveries (to_branch_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_branch_status
  ON public.stock_transfers (from_branch_id, status);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_branch_status
  ON public.stock_transfers (to_branch_id, status);

CREATE INDEX IF NOT EXISTS idx_transactions_branch_recorded_at
  ON public.transactions (branch_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_branch_employee_recorded_at
  ON public.transactions (branch_id, employee_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaction_items_business_product_transaction
  ON public.transaction_items (business_id, product_id, transaction_id);
