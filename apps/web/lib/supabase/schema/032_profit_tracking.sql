/*
 * Profit tracking for Retivox.
 *
 * Supplier delivery costs are entered per received UOM, converted into a
 * weighted average base-unit cost per branch/product, then stamped onto sale
 * line items so owner-only finance views can report revenue, cost and profit.
 */

ALTER TABLE public.branch_stock
  ADD COLUMN IF NOT EXISTS average_base_unit_cost numeric(12,4) NOT NULL DEFAULT 0;

ALTER TABLE public.supplier_delivery_items
  ADD COLUMN IF NOT EXISTS base_unit_cost numeric(12,4),
  ADD COLUMN IF NOT EXISTS total_cost numeric(12,2);

ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS unit_cost_at_sale numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_cost numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_line_total numeric(12,2),
  ADD COLUMN IF NOT EXISTS gross_profit numeric(12,2);

UPDATE public.supplier_delivery_items
   SET base_unit_cost = CASE
         WHEN unit_cost IS NOT NULL
          AND unit_cost > 0
          AND quantity_in_uom IS NOT NULL
          AND quantity_in_uom > 0
          AND COALESCE(NULLIF(base_quantity_received, 0), base_quantity_expected, quantity_received, quantity_expected, 0) > 0
         THEN round(unit_cost / (COALESCE(NULLIF(base_quantity_received, 0), base_quantity_expected, quantity_received, quantity_expected, 0) / quantity_in_uom), 4)
         ELSE base_unit_cost
       END,
       total_cost = CASE
         WHEN unit_cost IS NOT NULL
          AND unit_cost > 0
          AND quantity_in_uom IS NOT NULL
          AND quantity_in_uom > 0
          AND COALESCE(NULLIF(base_quantity_received, 0), base_quantity_expected, quantity_received, quantity_expected, 0) > 0
         THEN round(
           COALESCE(NULLIF(base_quantity_received, 0), base_quantity_expected, quantity_received, quantity_expected, 0)
           * (unit_cost / (COALESCE(NULLIF(base_quantity_received, 0), base_quantity_expected, quantity_received, quantity_expected, 0) / quantity_in_uom)),
           2
         )
         ELSE total_cost
       END
 WHERE unit_cost IS NOT NULL
   AND unit_cost > 0;

WITH delivery_costs AS (
  SELECT
    supplier_deliveries.business_id,
    supplier_deliveries.to_branch_id AS branch_id,
    supplier_delivery_items.product_id,
    SUM(COALESCE(supplier_delivery_items.total_cost, 0)) AS total_cost,
    SUM(COALESCE(NULLIF(supplier_delivery_items.base_quantity_received, 0), supplier_delivery_items.base_quantity_expected, supplier_delivery_items.quantity_received, supplier_delivery_items.quantity_expected, 0)) AS base_quantity
  FROM public.supplier_delivery_items
  JOIN public.supplier_deliveries
    ON supplier_deliveries.id = supplier_delivery_items.delivery_id
   AND supplier_deliveries.business_id = supplier_delivery_items.business_id
  WHERE supplier_delivery_items.unit_cost IS NOT NULL
    AND supplier_delivery_items.unit_cost > 0
    AND supplier_deliveries.status = 'received'
  GROUP BY supplier_deliveries.business_id, supplier_deliveries.to_branch_id, supplier_delivery_items.product_id
)
UPDATE public.branch_stock
   SET average_base_unit_cost = round(delivery_costs.total_cost / NULLIF(delivery_costs.base_quantity, 0), 4)
  FROM delivery_costs
 WHERE branch_stock.business_id = delivery_costs.business_id
   AND branch_stock.branch_id = delivery_costs.branch_id
   AND branch_stock.product_id = delivery_costs.product_id
   AND delivery_costs.base_quantity > 0
   AND delivery_costs.total_cost > 0;

UPDATE public.transaction_items
   SET net_line_total = COALESCE(net_line_total, line_total),
       gross_profit = COALESCE(gross_profit, line_total - line_cost)
 WHERE net_line_total IS NULL
    OR gross_profit IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'branch_stock_average_base_unit_cost_nonnegative'
       AND conrelid = 'public.branch_stock'::regclass
  ) THEN
    ALTER TABLE public.branch_stock
      ADD CONSTRAINT branch_stock_average_base_unit_cost_nonnegative CHECK (average_base_unit_cost >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supplier_delivery_items_costs_nonnegative'
       AND conrelid = 'public.supplier_delivery_items'::regclass
  ) THEN
    ALTER TABLE public.supplier_delivery_items
      ADD CONSTRAINT supplier_delivery_items_costs_nonnegative CHECK (
        (base_unit_cost IS NULL OR base_unit_cost >= 0)
        AND (total_cost IS NULL OR total_cost >= 0)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'transaction_items_profit_costs_nonnegative'
       AND conrelid = 'public.transaction_items'::regclass
  ) THEN
    ALTER TABLE public.transaction_items
      ADD CONSTRAINT transaction_items_profit_costs_nonnegative CHECK (
        unit_cost_at_sale >= 0
        AND line_cost >= 0
        AND line_discount_amount >= 0
        AND (net_line_total IS NULL OR net_line_total >= 0)
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_supplier_delivery_stock(p_delivery_id uuid, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery public.supplier_deliveries%ROWTYPE;
  v_item record;
  v_base_quantity numeric(12,4);
  v_legacy_quantity integer;
  v_base_unit_cost numeric(12,4);
  v_total_cost numeric(12,2);
BEGIN
  SELECT *
    INTO v_delivery
    FROM public.supplier_deliveries
   WHERE id = p_delivery_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery not found';
  END IF;

  FOR v_item IN
    SELECT
      supplier_delivery_items.product_id,
      supplier_delivery_items.id AS item_id,
      supplier_delivery_items.quantity_in_uom,
      supplier_delivery_items.unit_cost,
      COALESCE(NULLIF(supplier_delivery_items.base_quantity_expected, 0), supplier_delivery_items.quantity_expected, supplier_delivery_items.quantity_received, 0)::numeric AS base_quantity
    FROM public.supplier_delivery_items
    WHERE supplier_delivery_items.delivery_id = p_delivery_id
      AND supplier_delivery_items.business_id = v_delivery.business_id
  LOOP
    v_base_quantity := round(v_item.base_quantity, 4);

    IF v_base_quantity <= 0 OR v_base_quantity <> floor(v_base_quantity) THEN
      RAISE EXCEPTION 'Delivery item quantity must convert to a whole base unit';
    END IF;

    v_legacy_quantity := floor(v_base_quantity)::integer;
    v_base_unit_cost := CASE
      WHEN COALESCE(v_item.unit_cost, 0) > 0
       AND COALESCE(v_item.quantity_in_uom, 0) > 0
      THEN round(v_item.unit_cost / (v_base_quantity / v_item.quantity_in_uom), 4)
      ELSE 0
    END;
    v_total_cost := round(v_base_quantity * v_base_unit_cost, 2);

    PERFORM public.ensure_approved_branch_price(
      v_delivery.business_id,
      v_delivery.to_branch_id,
      v_item.product_id,
      COALESCE(v_delivery.approved_by, p_actor_id)
    );

    INSERT INTO public.branch_stock (
      branch_id,
      product_id,
      business_id,
      quantity_on_hand,
      quantity_reserved,
      low_stock_threshold,
      base_quantity_on_hand,
      base_quantity_reserved,
      average_base_unit_cost
    )
    VALUES (
      v_delivery.to_branch_id,
      v_item.product_id,
      v_delivery.business_id,
      v_legacy_quantity,
      0,
      10,
      v_base_quantity,
      0,
      v_base_unit_cost
    )
    ON CONFLICT (branch_id, product_id)
    DO UPDATE
       SET average_base_unit_cost = CASE
             WHEN EXCLUDED.average_base_unit_cost > 0 THEN round(
               (
                 public.branch_stock.base_quantity_on_hand * public.branch_stock.average_base_unit_cost
                 + EXCLUDED.base_quantity_on_hand * EXCLUDED.average_base_unit_cost
               ) / NULLIF(public.branch_stock.base_quantity_on_hand + EXCLUDED.base_quantity_on_hand, 0),
               4
             )
             ELSE public.branch_stock.average_base_unit_cost
           END,
           base_quantity_on_hand = public.branch_stock.base_quantity_on_hand + EXCLUDED.base_quantity_on_hand,
           quantity_on_hand = floor(public.branch_stock.base_quantity_on_hand + EXCLUDED.base_quantity_on_hand)::integer,
           last_updated_at = now();

    UPDATE public.supplier_delivery_items
       SET quantity_received = v_legacy_quantity,
           quantity_discrepancy = 0,
           base_quantity_received = v_base_quantity,
           base_unit_cost = CASE WHEN v_base_unit_cost > 0 THEN v_base_unit_cost ELSE base_unit_cost END,
           total_cost = CASE WHEN v_base_unit_cost > 0 THEN v_total_cost ELSE total_cost END
     WHERE id = v_item.item_id
       AND business_id = v_delivery.business_id;
  END LOOP;
END;
$$;

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
  v_global_role text;
  v_delivery_id uuid;
  v_delivery_status text;
  v_item record;
  v_uom_id uuid;
  v_uom public.units_of_measure%ROWTYPE;
  v_base_quantity numeric(12,4);
  v_legacy_quantity integer;
  v_base_unit_cost numeric(12,4);
  v_total_cost numeric(12,2);
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();
  v_global_role := public.get_my_global_role();

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
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  v_delivery_status := CASE WHEN v_global_role = 'owner' THEN 'received' ELSE 'pending_approval' END;

  INSERT INTO public.supplier_deliveries (
    business_id,
    to_branch_id,
    received_by,
    requested_by,
    approved_by,
    approved_at,
    acknowledged_by,
    acknowledged_at,
    supplier_name,
    reference_code,
    status,
    delivered_at
  )
  VALUES (
    v_business_id,
    p_branch_id,
    v_actor_id,
    v_actor_id,
    CASE WHEN v_delivery_status = 'received' THEN v_actor_id ELSE NULL END,
    CASE WHEN v_delivery_status = 'received' THEN now() ELSE NULL END,
    CASE WHEN v_delivery_status = 'received' THEN v_actor_id ELSE NULL END,
    CASE WHEN v_delivery_status = 'received' THEN now() ELSE NULL END,
    trim(p_supplier_name),
    NULLIF(trim(p_reference_code), ''),
    v_delivery_status,
    CASE WHEN v_delivery_status = 'received' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_delivery_id;

  FOR v_item IN
    SELECT
      (item_value->>'productId')::uuid AS product_id,
      COALESCE(NULLIF(item_value->>'uomId', '')::uuid, public.get_product_default_purchase_uom_id(v_business_id, (item_value->>'productId')::uuid)) AS uom_id,
      SUM((item_value->>'quantity')::numeric) AS quantity_in_uom,
      MAX(NULLIF(item_value->>'unitCost', '')::numeric) AS unit_cost,
      MAX(NULLIF(item_value->>'notes', '')) AS notes
    FROM jsonb_array_elements(p_items) AS item_value
    GROUP BY (item_value->>'productId')::uuid, COALESCE(NULLIF(item_value->>'uomId', '')::uuid, public.get_product_default_purchase_uom_id(v_business_id, (item_value->>'productId')::uuid))
  LOOP
    IF v_item.product_id IS NULL OR v_item.uom_id IS NULL OR v_item.quantity_in_uom IS NULL OR v_item.quantity_in_uom <= 0 THEN
      RAISE EXCEPTION 'Quantity must be greater than zero';
    END IF;

    IF COALESCE(v_item.unit_cost, 0) < 0 THEN
      RAISE EXCEPTION 'Cost cannot be negative';
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM public.products
       WHERE id = v_item.product_id
         AND business_id = v_business_id
         AND is_active = true
         AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'One or more products are invalid';
    END IF;

    v_uom := public.assert_product_uom_link(v_business_id, v_item.product_id, v_item.uom_id);

    IF NOT EXISTS (
      SELECT 1
        FROM public.product_uom_links
       WHERE business_id = v_business_id
         AND product_id = v_item.product_id
         AND uom_id = v_item.uom_id
         AND is_purchase_uom = true
    ) THEN
      RAISE EXCEPTION 'Selected unit is not available for stock receiving';
    END IF;

    v_uom_id := v_uom.id;
    v_base_quantity := round(v_item.quantity_in_uom * v_uom.conversion_factor, 4);

    IF v_base_quantity <= 0 OR v_base_quantity <> floor(v_base_quantity) THEN
      RAISE EXCEPTION 'Delivery quantity must convert to a whole base unit';
    END IF;

    v_legacy_quantity := floor(v_base_quantity)::integer;
    v_base_unit_cost := CASE
      WHEN COALESCE(v_item.unit_cost, 0) > 0
      THEN round(v_item.unit_cost / v_uom.conversion_factor, 4)
      ELSE NULL
    END;
    v_total_cost := CASE
      WHEN v_base_unit_cost IS NOT NULL
      THEN round(v_base_quantity * v_base_unit_cost, 2)
      ELSE NULL
    END;

    INSERT INTO public.supplier_delivery_items (
      delivery_id,
      product_id,
      business_id,
      quantity_expected,
      quantity_received,
      quantity_discrepancy,
      unit_cost,
      notes,
      uom_id,
      quantity_in_uom,
      base_quantity_expected,
      base_quantity_received,
      base_unit_cost,
      total_cost
    )
    VALUES (
      v_delivery_id,
      v_item.product_id,
      v_business_id,
      v_legacy_quantity,
      CASE WHEN v_delivery_status = 'received' THEN v_legacy_quantity ELSE 0 END,
      CASE WHEN v_delivery_status = 'received' THEN 0 ELSE v_legacy_quantity END,
      v_item.unit_cost,
      v_item.notes,
      v_uom_id,
      v_item.quantity_in_uom,
      v_base_quantity,
      CASE WHEN v_delivery_status = 'received' THEN v_base_quantity ELSE 0 END,
      v_base_unit_cost,
      v_total_cost
    );
  END LOOP;

  IF v_delivery_status = 'received' THEN
    PERFORM public.apply_supplier_delivery_stock(v_delivery_id, v_actor_id);
  END IF;

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
    CASE WHEN v_delivery_status = 'received' THEN 'received' ELSE 'requested' END,
    NULL,
    jsonb_build_object(
      'branch_id', p_branch_id,
      'effective_role', v_effective_role,
      'status', v_delivery_status,
      'supplier_name', trim(p_supplier_name),
      'reference_code', NULLIF(trim(p_reference_code), ''),
      'item_count', jsonb_array_length(p_items),
      'quantity_mode', 'uom_to_base',
      'cost_mode', 'optional_unit_cost'
    )
  );

  RETURN v_delivery_id;
END;
$$;

DROP FUNCTION IF EXISTS public.employee_record_transaction(jsonb, text, numeric, text, text, text, text);

CREATE OR REPLACE FUNCTION public.employee_record_transaction(
  p_items jsonb,
  p_payment_method text,
  p_discount_amount numeric DEFAULT 0,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_mpesa_ref_code text DEFAULT NULL,
  p_cash_deposit_code text DEFAULT NULL
)
RETURNS TABLE(
  transaction_id uuid,
  status text,
  recorded_at timestamptz,
  total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_branch_id uuid;
  v_branch public.branches%ROWTYPE;
  v_customer_id uuid;
  v_transaction_id uuid;
  v_item record;
  v_stock public.branch_stock%ROWTYPE;
  v_resolved_price record;
  v_line_total numeric(10,2);
  v_unit_price numeric(10,2);
  v_unit_cost_at_sale numeric(12,4);
  v_line_cost numeric(12,2);
  v_subtotal numeric(10,2) := 0;
  v_discount_amount numeric(10,2) := COALESCE(p_discount_amount, 0);
  v_max_discount_amount numeric(10,2) := 0;
  v_line_max_discount_amount numeric(10,2) := 0;
  v_total_amount numeric(10,2);
  v_available_base_quantity numeric(12,4);
  v_base_quantity numeric(12,4);
  v_legacy_quantity integer;
  v_uom public.units_of_measure%ROWTYPE;
  v_payment_status text := 'pending_verify';
  v_recorded_at timestamptz := now();
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();
  v_branch_id := public.get_employee_branch_id(v_actor_id);

  IF v_actor_id IS NULL OR v_business_id IS NULL OR v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_employee_at_branch(v_actor_id, v_branch_id);

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one product';
  END IF;

  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'Record up to 50 line items at a time';
  END IF;

  IF p_payment_method NOT IN ('mpesa_manual', 'cash') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  IF p_payment_method = 'mpesa_manual' AND length(trim(COALESCE(p_mpesa_ref_code, ''))) < 5 THEN
    RAISE EXCEPTION 'Enter a valid M-Pesa reference code';
  END IF;

  IF p_payment_method = 'cash' AND length(trim(COALESCE(p_cash_deposit_code, ''))) < 3 THEN
    RAISE EXCEPTION 'Enter a valid cash deposit/reference code';
  END IF;

  SELECT *
    INTO v_branch
    FROM public.branches
   WHERE id = v_branch_id
     AND business_id = v_business_id
     AND is_active = true
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  IF NULLIF(trim(COALESCE(p_customer_phone, '')), '') IS NOT NULL THEN
    SELECT customers.id
      INTO v_customer_id
      FROM public.customers
     WHERE customers.business_id = v_business_id
       AND customers.phone = trim(p_customer_phone)
     LIMIT 1;

    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers (
        business_id,
        name,
        phone,
        first_purchase_at,
        last_purchase_at
      )
      VALUES (
        v_business_id,
        COALESCE(NULLIF(trim(COALESCE(p_customer_name, '')), ''), 'Walk-in customer'),
        trim(p_customer_phone),
        v_recorded_at,
        v_recorded_at
      )
      RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  INSERT INTO public.transactions (
    business_id,
    branch_id,
    employee_id,
    customer_id,
    status,
    subtotal,
    discount_amount,
    total_amount,
    origin,
    recorded_at,
    synced_at,
    sync_status
  )
  VALUES (
    v_business_id,
    v_branch_id,
    v_actor_id,
    v_customer_id,
    'pending_verify',
    0,
    0,
    0,
    'online',
    v_recorded_at,
    v_recorded_at,
    'synced'
  )
  RETURNING id INTO v_transaction_id;

  FOR v_item IN
    SELECT
      (item_value->>'productId')::uuid AS product_id,
      COALESCE(NULLIF(item_value->>'uomId', '')::uuid, public.get_product_default_sale_uom_id(v_business_id, (item_value->>'productId')::uuid)) AS uom_id,
      SUM((item_value->>'quantity')::numeric) AS quantity_in_uom
    FROM jsonb_array_elements(p_items) AS item_value
    GROUP BY (item_value->>'productId')::uuid, COALESCE(NULLIF(item_value->>'uomId', '')::uuid, public.get_product_default_sale_uom_id(v_business_id, (item_value->>'productId')::uuid))
  LOOP
    IF v_item.product_id IS NULL OR v_item.uom_id IS NULL OR v_item.quantity_in_uom IS NULL OR v_item.quantity_in_uom <= 0 THEN
      RAISE EXCEPTION 'Each product quantity must be greater than zero';
    END IF;

    v_uom := public.assert_product_uom_link(v_business_id, v_item.product_id, v_item.uom_id);

    IF NOT EXISTS (
      SELECT 1
        FROM public.product_uom_links
       WHERE business_id = v_business_id
         AND product_id = v_item.product_id
         AND uom_id = v_item.uom_id
         AND is_sale_uom = true
    ) THEN
      RAISE EXCEPTION 'Selected unit is not available for sales';
    END IF;

    v_base_quantity := round(v_item.quantity_in_uom * v_uom.conversion_factor, 4);

    IF v_base_quantity <= 0 OR v_base_quantity <> floor(v_base_quantity) THEN
      RAISE EXCEPTION 'Sale quantity must convert to a whole base unit';
    END IF;

    v_legacy_quantity := floor(v_base_quantity)::integer;

    SELECT branch_stock.*
      INTO v_stock
      FROM public.branch_stock
      JOIN public.products
        ON products.id = branch_stock.product_id
       AND products.business_id = branch_stock.business_id
     WHERE branch_stock.business_id = v_business_id
       AND branch_stock.branch_id = v_branch_id
       AND branch_stock.product_id = v_item.product_id
       AND products.is_active = true
       AND products.deleted_at IS NULL
     FOR UPDATE OF branch_stock;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'One or more products are not available at your branch';
    END IF;

    v_available_base_quantity := v_stock.base_quantity_on_hand - v_stock.base_quantity_reserved;

    IF v_available_base_quantity < v_base_quantity THEN
      RAISE EXCEPTION 'Insufficient stock. Available base quantity: %', GREATEST(v_available_base_quantity, 0);
    END IF;

    SELECT *
      INTO v_resolved_price
      FROM public.resolve_product_sale_price(v_business_id, v_branch_id, v_item.product_id, v_legacy_quantity, v_item.uom_id)
      LIMIT 1;

    IF v_resolved_price.line_total IS NULL OR v_resolved_price.line_total <= 0 THEN
      RAISE EXCEPTION 'Unable to resolve an approved price for one or more products';
    END IF;

    v_line_max_discount_amount := public.resolve_product_sale_discount(
      v_business_id,
      v_branch_id,
      v_item.product_id,
      v_legacy_quantity,
      v_item.uom_id
    );

    v_line_total := round(v_resolved_price.line_total, 2);
    v_unit_price := round(v_resolved_price.unit_price, 2);
    v_unit_cost_at_sale := COALESCE(v_stock.average_base_unit_cost, 0);
    v_line_cost := round(v_base_quantity * v_unit_cost_at_sale, 2);
    v_subtotal := round(v_subtotal + v_line_total, 2);
    v_max_discount_amount := round(v_max_discount_amount + COALESCE(v_line_max_discount_amount, 0), 2);

    INSERT INTO public.transaction_items (
      transaction_id,
      product_id,
      business_id,
      quantity,
      unit_price_at_sale,
      line_total,
      stock_status,
      uom_id,
      quantity_in_uom,
      base_quantity,
      unit_cost_at_sale,
      line_cost,
      net_line_total,
      gross_profit
    )
    VALUES (
      v_transaction_id,
      v_item.product_id,
      v_business_id,
      v_legacy_quantity,
      v_unit_price,
      v_line_total,
      'deducted',
      v_item.uom_id,
      v_item.quantity_in_uom,
      v_base_quantity,
      v_unit_cost_at_sale,
      v_line_cost,
      v_line_total,
      round(v_line_total - v_line_cost, 2)
    );

    UPDATE public.branch_stock
       SET base_quantity_on_hand = base_quantity_on_hand - v_base_quantity,
           quantity_on_hand = floor(base_quantity_on_hand - v_base_quantity)::integer,
           last_updated_at = now()
     WHERE id = v_stock.id;
  END LOOP;

  IF v_subtotal <= 0 THEN
    RAISE EXCEPTION 'Transaction total must be greater than zero';
  END IF;

  IF v_discount_amount < 0 THEN
    RAISE EXCEPTION 'Discount cannot be negative';
  END IF;

  IF v_discount_amount > v_max_discount_amount THEN
    RAISE EXCEPTION 'Discount exceeds the maximum allowed for these items. Maximum allowed: %', v_max_discount_amount;
  END IF;

  v_total_amount := round(v_subtotal - v_discount_amount, 2);

  UPDATE public.transaction_items
     SET line_discount_amount = CASE
           WHEN v_subtotal > 0 THEN round(line_total / v_subtotal * v_discount_amount, 2)
           ELSE 0
         END,
         net_line_total = CASE
           WHEN v_subtotal > 0 THEN round(line_total - (line_total / v_subtotal * v_discount_amount), 2)
           ELSE line_total
         END,
         gross_profit = CASE
           WHEN v_subtotal > 0 THEN round(line_total - (line_total / v_subtotal * v_discount_amount) - line_cost, 2)
           ELSE round(line_total - line_cost, 2)
         END
   WHERE transaction_id = v_transaction_id
     AND business_id = v_business_id;

  UPDATE public.transactions
     SET subtotal = v_subtotal,
         discount_amount = v_discount_amount,
         total_amount = v_total_amount
   WHERE id = v_transaction_id;

  INSERT INTO public.payments (
    transaction_id,
    business_id,
    payment_method,
    amount,
    status,
    mpesa_ref_code,
    cash_deposit_code,
    payment_at
  )
  VALUES (
    v_transaction_id,
    v_business_id,
    p_payment_method,
    v_total_amount,
    v_payment_status,
    CASE WHEN p_payment_method = 'mpesa_manual' THEN trim(p_mpesa_ref_code) ELSE NULL END,
    CASE WHEN p_payment_method = 'cash' THEN trim(p_cash_deposit_code) ELSE NULL END,
    v_recorded_at
  );

  IF v_customer_id IS NOT NULL THEN
    UPDATE public.customers
       SET total_visits = total_visits + 1,
           total_spent = total_spent + v_total_amount,
           last_purchase_at = v_recorded_at
     WHERE id = v_customer_id
       AND business_id = v_business_id;
  END IF;

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
    'transaction',
    v_transaction_id,
    'created',
    NULL,
    jsonb_build_object(
      'effective_role', 'employee',
      'branch_id', v_branch_id,
      'subtotal', v_subtotal,
      'discount_amount', v_discount_amount,
      'max_discount_amount', v_max_discount_amount,
      'total_amount', v_total_amount,
      'payment_method', p_payment_method,
      'payment_status', v_payment_status,
      'pricing_source', 'uom_specific_product_pricing',
      'quantity_mode', 'uom_to_base',
      'profit_mode', 'weighted_average_base_cost'
    )
  );

  RETURN QUERY
  SELECT
    v_transaction_id AS transaction_id,
    'pending_verify'::text AS status,
    v_recorded_at AS recorded_at,
    v_total_amount AS total_amount;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_transaction_items_business_profit
  ON public.transaction_items (business_id, product_id, gross_profit);

CREATE INDEX IF NOT EXISTS idx_branch_stock_business_average_cost
  ON public.branch_stock (business_id, branch_id, product_id, average_base_unit_cost);
