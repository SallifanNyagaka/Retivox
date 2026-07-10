/*
 * Stock loss recovery base-unit pricing for Retivox.
 *
 * The owner enters the recovery selling price per individual/base unit.
 * Net loss is calculated as:
 *   damaged base units * stock cost per base unit
 *   - damaged base units * recovery selling price per base unit.
 */

CREATE OR REPLACE FUNCTION public.record_inventory_loss_event(
  p_branch_id uuid,
  p_product_id uuid,
  p_uom_id uuid,
  p_quantity_in_uom numeric,
  p_loss_type text,
  p_reason text,
  p_recoverable_amount numeric DEFAULT 0,
  p_recovery_sale_price_per_uom numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_uom public.units_of_measure%ROWTYPE;
  v_stock public.branch_stock%ROWTYPE;
  v_base_quantity numeric(12,4);
  v_unit_cost_at_loss numeric(12,4);
  v_gross_cost numeric(12,2);
  v_recoverable_amount numeric(12,2);
  v_net_loss numeric(12,2);
  v_recovery_sale_price_per_selected_uom numeric(12,2);
  v_loss_id uuid;
  v_recovery_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_quantity_in_uom IS NULL OR p_quantity_in_uom <= 0 THEN
    RAISE EXCEPTION 'Loss quantity must be greater than zero';
  END IF;

  IF p_loss_type NOT IN ('breakage', 'spoilage', 'theft', 'markdown_damage', 'other') THEN
    RAISE EXCEPTION 'Invalid loss type';
  END IF;

  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Loss reason is required';
  END IF;

  v_uom := public.assert_product_uom_link(v_business_id, p_product_id, p_uom_id);
  v_base_quantity := round(p_quantity_in_uom * v_uom.conversion_factor, 4);

  IF v_base_quantity <= 0 OR v_base_quantity <> floor(v_base_quantity) THEN
    RAISE EXCEPTION 'Loss quantity must convert to a whole base unit';
  END IF;

  SELECT *
    INTO v_stock
    FROM public.branch_stock
   WHERE business_id = v_business_id
     AND branch_id = p_branch_id
     AND product_id = p_product_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock record not found';
  END IF;

  IF (v_stock.base_quantity_on_hand - COALESCE(v_stock.base_quantity_reserved, 0)) < v_base_quantity THEN
    RAISE EXCEPTION 'Insufficient available stock for this loss';
  END IF;

  SELECT round(resolved_delivery_cost.total_cost / resolved_delivery_cost.base_quantity, 4)
    INTO v_unit_cost_at_loss
    FROM (
      SELECT
        supplier_delivery_items.id,
        COALESCE(
          NULLIF(supplier_delivery_items.base_quantity_received, 0),
          NULLIF(supplier_delivery_items.base_quantity_expected, 0),
          NULLIF(supplier_delivery_items.quantity_received, 0),
          NULLIF(supplier_delivery_items.quantity_expected, 0)
        )::numeric AS base_quantity,
        COALESCE(
          NULLIF(SUM(COALESCE(supplier_delivery_item_costs.amount, 0)), 0),
          NULLIF(supplier_delivery_items.total_cost, 0),
          NULLIF(supplier_delivery_items.base_unit_cost, 0) * COALESCE(
            NULLIF(supplier_delivery_items.base_quantity_received, 0),
            NULLIF(supplier_delivery_items.base_quantity_expected, 0),
            NULLIF(supplier_delivery_items.quantity_received, 0),
            NULLIF(supplier_delivery_items.quantity_expected, 0)
          )
        )::numeric AS total_cost,
        COALESCE(supplier_deliveries.delivered_at, supplier_deliveries.approved_at, supplier_deliveries.recorded_at) AS cost_recorded_at
      FROM public.supplier_delivery_items
      JOIN public.supplier_deliveries
        ON supplier_deliveries.id = supplier_delivery_items.delivery_id
       AND supplier_deliveries.business_id = supplier_delivery_items.business_id
      LEFT JOIN public.supplier_delivery_item_costs
        ON supplier_delivery_item_costs.delivery_item_id = supplier_delivery_items.id
       AND supplier_delivery_item_costs.business_id = supplier_delivery_items.business_id
      WHERE supplier_delivery_items.business_id = v_business_id
        AND supplier_delivery_items.product_id = p_product_id
        AND supplier_deliveries.to_branch_id = p_branch_id
        AND supplier_deliveries.status = 'received'
      GROUP BY
        supplier_delivery_items.id,
        supplier_delivery_items.base_quantity_received,
        supplier_delivery_items.base_quantity_expected,
        supplier_delivery_items.quantity_received,
        supplier_delivery_items.quantity_expected,
        supplier_delivery_items.total_cost,
        supplier_delivery_items.base_unit_cost,
        supplier_deliveries.delivered_at,
        supplier_deliveries.approved_at,
        supplier_deliveries.recorded_at
    ) AS resolved_delivery_cost
   WHERE resolved_delivery_cost.base_quantity > 0
     AND resolved_delivery_cost.total_cost > 0
   ORDER BY resolved_delivery_cost.cost_recorded_at DESC
   LIMIT 1;

  v_unit_cost_at_loss := COALESCE(v_unit_cost_at_loss, COALESCE(v_stock.average_base_unit_cost, 0));
  v_gross_cost := round(v_base_quantity * v_unit_cost_at_loss, 2);
  v_recoverable_amount := CASE
    WHEN COALESCE(p_recovery_sale_price_per_uom, 0) > 0 THEN round(v_base_quantity * p_recovery_sale_price_per_uom, 2)
    ELSE round(GREATEST(COALESCE(p_recoverable_amount, 0), 0), 2)
  END;
  v_recovery_sale_price_per_selected_uom := CASE
    WHEN COALESCE(p_recovery_sale_price_per_uom, 0) > 0 THEN round(p_recovery_sale_price_per_uom * v_uom.conversion_factor, 2)
    ELSE NULL
  END;
  v_net_loss := round(GREATEST(v_gross_cost - v_recoverable_amount, 0), 2);

  UPDATE public.branch_stock
     SET base_quantity_on_hand = round(base_quantity_on_hand - v_base_quantity, 4),
         quantity_on_hand = floor(base_quantity_on_hand - v_base_quantity)::integer,
         last_updated_at = now()
   WHERE id = v_stock.id;

  INSERT INTO public.inventory_loss_events (
    business_id,
    branch_id,
    product_id,
    uom_id,
    loss_type,
    reason,
    quantity_in_uom,
    base_quantity,
    unit_cost_at_loss,
    gross_cost,
    recoverable_amount,
    net_loss,
    created_by
  )
  VALUES (
    v_business_id,
    p_branch_id,
    p_product_id,
    p_uom_id,
    p_loss_type,
    trim(p_reason),
    p_quantity_in_uom,
    v_base_quantity,
    v_unit_cost_at_loss,
    v_gross_cost,
    v_recoverable_amount,
    v_net_loss,
    v_actor_id
  )
  RETURNING id INTO v_loss_id;

  IF v_recovery_sale_price_per_selected_uom IS NOT NULL THEN
    INSERT INTO public.inventory_recovery_items (
      loss_event_id,
      business_id,
      branch_id,
      product_id,
      uom_id,
      label,
      quantity_in_uom,
      base_quantity,
      remaining_base_quantity,
      sale_price_per_uom,
      expected_recoverable_amount,
      created_by
    )
    VALUES (
      v_loss_id,
      v_business_id,
      p_branch_id,
      p_product_id,
      p_uom_id,
      trim(p_reason),
      p_quantity_in_uom,
      v_base_quantity,
      v_base_quantity,
      v_recovery_sale_price_per_selected_uom,
      v_recoverable_amount,
      v_actor_id
    )
    RETURNING id INTO v_recovery_id;
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
    'inventory_loss',
    v_loss_id,
    'recorded',
    jsonb_build_object(
      'stock_id', v_stock.id,
      'old_base_quantity_on_hand', v_stock.base_quantity_on_hand
    ),
    jsonb_build_object(
      'branch_id', p_branch_id,
      'product_id', p_product_id,
      'uom_id', p_uom_id,
      'loss_type', p_loss_type,
      'quantity_in_uom', p_quantity_in_uom,
      'base_quantity', v_base_quantity,
      'gross_cost', v_gross_cost,
      'recoverable_amount', v_recoverable_amount,
      'recovery_sale_price_per_base_unit', p_recovery_sale_price_per_uom,
      'recovery_sale_price_per_selected_uom', v_recovery_sale_price_per_selected_uom,
      'recovery_item_id', v_recovery_id,
      'net_loss', v_net_loss,
      'new_base_quantity_on_hand', round(v_stock.base_quantity_on_hand - v_base_quantity, 4)
    )
  );

  RETURN v_loss_id;
END;
$$;

WITH recalculated_losses AS (
  SELECT
    inventory_loss_events.id,
    COALESCE(latest_delivery_cost.unit_cost_at_loss, inventory_loss_events.unit_cost_at_loss, 0) AS unit_cost_at_loss,
    round(inventory_loss_events.base_quantity * COALESCE(latest_delivery_cost.unit_cost_at_loss, inventory_loss_events.unit_cost_at_loss, 0), 2) AS gross_cost,
    round(
      GREATEST(
        inventory_loss_events.base_quantity * COALESCE(latest_delivery_cost.unit_cost_at_loss, inventory_loss_events.unit_cost_at_loss, 0)
        - COALESCE(inventory_loss_events.recoverable_amount, 0),
        0
      ),
      2
    ) AS net_loss
  FROM public.inventory_loss_events
  LEFT JOIN LATERAL (
    SELECT round(resolved_delivery_cost.total_cost / resolved_delivery_cost.base_quantity, 4) AS unit_cost_at_loss
      FROM (
        SELECT
          supplier_delivery_items.id,
          COALESCE(
            NULLIF(supplier_delivery_items.base_quantity_received, 0),
            NULLIF(supplier_delivery_items.base_quantity_expected, 0),
            NULLIF(supplier_delivery_items.quantity_received, 0),
            NULLIF(supplier_delivery_items.quantity_expected, 0)
          )::numeric AS base_quantity,
          COALESCE(
            NULLIF(SUM(COALESCE(supplier_delivery_item_costs.amount, 0)), 0),
            NULLIF(supplier_delivery_items.total_cost, 0),
            NULLIF(supplier_delivery_items.base_unit_cost, 0) * COALESCE(
              NULLIF(supplier_delivery_items.base_quantity_received, 0),
              NULLIF(supplier_delivery_items.base_quantity_expected, 0),
              NULLIF(supplier_delivery_items.quantity_received, 0),
              NULLIF(supplier_delivery_items.quantity_expected, 0)
            )
          )::numeric AS total_cost,
          COALESCE(supplier_deliveries.delivered_at, supplier_deliveries.approved_at, supplier_deliveries.recorded_at) AS cost_recorded_at
        FROM public.supplier_delivery_items
        JOIN public.supplier_deliveries
          ON supplier_deliveries.id = supplier_delivery_items.delivery_id
         AND supplier_deliveries.business_id = supplier_delivery_items.business_id
        LEFT JOIN public.supplier_delivery_item_costs
          ON supplier_delivery_item_costs.delivery_item_id = supplier_delivery_items.id
         AND supplier_delivery_item_costs.business_id = supplier_delivery_items.business_id
        WHERE supplier_delivery_items.business_id = inventory_loss_events.business_id
          AND supplier_delivery_items.product_id = inventory_loss_events.product_id
          AND supplier_deliveries.to_branch_id = inventory_loss_events.branch_id
          AND supplier_deliveries.status = 'received'
        GROUP BY
          supplier_delivery_items.id,
          supplier_delivery_items.base_quantity_received,
          supplier_delivery_items.base_quantity_expected,
          supplier_delivery_items.quantity_received,
          supplier_delivery_items.quantity_expected,
          supplier_delivery_items.total_cost,
          supplier_delivery_items.base_unit_cost,
          supplier_deliveries.delivered_at,
          supplier_deliveries.approved_at,
          supplier_deliveries.recorded_at
      ) AS resolved_delivery_cost
     WHERE resolved_delivery_cost.base_quantity > 0
       AND resolved_delivery_cost.total_cost > 0
     ORDER BY resolved_delivery_cost.cost_recorded_at DESC
     LIMIT 1
  ) AS latest_delivery_cost ON true
)
UPDATE public.inventory_loss_events
   SET unit_cost_at_loss = recalculated_losses.unit_cost_at_loss,
       gross_cost = recalculated_losses.gross_cost,
       net_loss = recalculated_losses.net_loss
  FROM recalculated_losses
 WHERE inventory_loss_events.id = recalculated_losses.id
   AND recalculated_losses.unit_cost_at_loss > 0;
