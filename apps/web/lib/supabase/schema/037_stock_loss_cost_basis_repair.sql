/*
 * Stock loss cost-basis repair for Retivox.
 *
 * Normalizes delivery cost storage so profit/loss calculations always use:
 * total delivered cost / delivered base units = average base-unit cost.
 */

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
      supplier_delivery_items.base_unit_cost,
      supplier_delivery_items.total_cost,
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
      WHEN COALESCE(v_item.total_cost, 0) > 0 THEN round(v_item.total_cost / v_base_quantity, 4)
      WHEN COALESCE(v_item.base_unit_cost, 0) > 0 THEN round(v_item.base_unit_cost, 4)
      WHEN COALESCE(v_item.unit_cost, 0) > 0
       AND COALESCE(v_item.quantity_in_uom, 0) > 0 THEN round(v_item.unit_cost / (v_base_quantity / v_item.quantity_in_uom), 4)
      ELSE 0
    END;
    v_total_cost := CASE
      WHEN COALESCE(v_item.total_cost, 0) > 0 THEN round(v_item.total_cost, 2)
      WHEN v_base_unit_cost > 0 THEN round(v_base_quantity * v_base_unit_cost, 2)
      ELSE 0
    END;

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
           total_cost = CASE WHEN v_total_cost > 0 THEN v_total_cost ELSE total_cost END
     WHERE id = v_item.item_id
       AND business_id = v_delivery.business_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_branch_stock_average_cost(
  p_business_id uuid,
  p_branch_id uuid,
  p_product_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH delivery_costs AS (
    SELECT
      SUM(
        COALESCE(
          supplier_delivery_items.total_cost,
          supplier_delivery_items.base_unit_cost * COALESCE(NULLIF(supplier_delivery_items.base_quantity_received, 0), supplier_delivery_items.base_quantity_expected, 0),
          0
        )
      ) AS total_cost,
      SUM(COALESCE(NULLIF(supplier_delivery_items.base_quantity_received, 0), supplier_delivery_items.base_quantity_expected, 0)) AS base_quantity
    FROM public.supplier_deliveries
    JOIN public.supplier_delivery_items
      ON supplier_delivery_items.delivery_id = supplier_deliveries.id
     AND supplier_delivery_items.business_id = supplier_deliveries.business_id
    WHERE supplier_deliveries.business_id = p_business_id
      AND supplier_deliveries.to_branch_id = p_branch_id
      AND supplier_deliveries.status = 'received'
      AND supplier_delivery_items.product_id = p_product_id
  )
  UPDATE public.branch_stock
     SET average_base_unit_cost = CASE
           WHEN delivery_costs.base_quantity > 0
            AND delivery_costs.total_cost > 0 THEN round(delivery_costs.total_cost / delivery_costs.base_quantity, 4)
           ELSE average_base_unit_cost
         END,
         last_updated_at = now()
    FROM delivery_costs
   WHERE branch_stock.business_id = p_business_id
     AND branch_stock.branch_id = p_branch_id
     AND branch_stock.product_id = p_product_id;
$$;

WITH normalized_delivery_items AS (
  SELECT
    supplier_delivery_items.id,
    COALESCE(NULLIF(supplier_delivery_items.base_quantity_received, 0), supplier_delivery_items.base_quantity_expected, supplier_delivery_items.quantity_received, supplier_delivery_items.quantity_expected, 0)::numeric AS base_quantity,
    supplier_delivery_items.quantity_in_uom,
    supplier_delivery_items.unit_cost,
    supplier_delivery_items.base_unit_cost,
    supplier_delivery_items.total_cost,
    COALESCE(SUM(supplier_delivery_item_costs.amount), 0)::numeric AS cost_breakdown_total
  FROM public.supplier_delivery_items
  LEFT JOIN public.supplier_delivery_item_costs
    ON supplier_delivery_item_costs.delivery_item_id = supplier_delivery_items.id
   AND supplier_delivery_item_costs.business_id = supplier_delivery_items.business_id
  GROUP BY
    supplier_delivery_items.id,
    supplier_delivery_items.base_quantity_received,
    supplier_delivery_items.base_quantity_expected,
    supplier_delivery_items.quantity_received,
    supplier_delivery_items.quantity_expected,
    supplier_delivery_items.quantity_in_uom,
    supplier_delivery_items.unit_cost,
    supplier_delivery_items.base_unit_cost,
    supplier_delivery_items.total_cost
),
repair_values AS (
  SELECT
    id,
    base_quantity,
    CASE
      WHEN cost_breakdown_total > 0 THEN round(cost_breakdown_total, 2)
      WHEN COALESCE(total_cost, 0) > 0 THEN round(total_cost, 2)
      WHEN COALESCE(base_unit_cost, 0) > 0 AND base_quantity > 0 THEN round(base_quantity * base_unit_cost, 2)
      WHEN COALESCE(unit_cost, 0) > 0 AND COALESCE(quantity_in_uom, 0) > 0 THEN round(unit_cost * quantity_in_uom, 2)
      ELSE NULL
    END AS repaired_total_cost
  FROM normalized_delivery_items
  WHERE base_quantity > 0
)
UPDATE public.supplier_delivery_items
   SET total_cost = repair_values.repaired_total_cost,
       base_unit_cost = round(repair_values.repaired_total_cost / repair_values.base_quantity, 4)
  FROM repair_values
 WHERE supplier_delivery_items.id = repair_values.id
   AND repair_values.repaired_total_cost IS NOT NULL
   AND repair_values.repaired_total_cost > 0;

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
  WHERE supplier_deliveries.status = 'received'
  GROUP BY supplier_deliveries.business_id, supplier_deliveries.to_branch_id, supplier_delivery_items.product_id
)
UPDATE public.branch_stock
   SET average_base_unit_cost = round(delivery_costs.total_cost / NULLIF(delivery_costs.base_quantity, 0), 4),
       last_updated_at = now()
  FROM delivery_costs
 WHERE branch_stock.business_id = delivery_costs.business_id
   AND branch_stock.branch_id = delivery_costs.branch_id
   AND branch_stock.product_id = delivery_costs.product_id
   AND delivery_costs.base_quantity > 0
   AND delivery_costs.total_cost > 0;
