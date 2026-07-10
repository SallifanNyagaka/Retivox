/*
 * Repair UOM stock quantities for Retivox.
 *
 * Some stock rows may have been received while the UI selected a purchase UOM
 * such as "Tray of 30", but the database stored the selected quantity as base
 * units. This migration safely repairs those historical received deliveries by
 * adding only the missing base-unit delta to current branch stock.
 *
 * It is idempotent: repaired delivery items are marked in notes and skipped on
 * later runs.
 */

WITH repairable_items AS (
  SELECT
    supplier_delivery_items.id AS item_id,
    supplier_delivery_items.delivery_id,
    supplier_delivery_items.product_id,
    supplier_delivery_items.business_id,
    supplier_deliveries.to_branch_id AS branch_id,
    supplier_delivery_items.quantity_in_uom,
    supplier_delivery_items.base_quantity_expected,
    supplier_delivery_items.base_quantity_received,
    supplier_delivery_items.quantity_expected,
    supplier_delivery_items.quantity_received,
    units_of_measure.conversion_factor,
    round(supplier_delivery_items.quantity_in_uom * units_of_measure.conversion_factor, 4) AS corrected_base_quantity,
    COALESCE(
      NULLIF(supplier_delivery_items.base_quantity_received, 0),
      NULLIF(supplier_delivery_items.base_quantity_expected, 0),
      supplier_delivery_items.quantity_received,
      supplier_delivery_items.quantity_expected,
      0
    )::numeric AS applied_base_quantity
  FROM public.supplier_delivery_items
  JOIN public.supplier_deliveries
    ON supplier_deliveries.id = supplier_delivery_items.delivery_id
   AND supplier_deliveries.business_id = supplier_delivery_items.business_id
  JOIN public.units_of_measure
    ON units_of_measure.id = supplier_delivery_items.uom_id
   AND units_of_measure.business_id = supplier_delivery_items.business_id
  WHERE supplier_deliveries.status = 'received'
    AND supplier_delivery_items.uom_id IS NOT NULL
    AND supplier_delivery_items.quantity_in_uom IS NOT NULL
    AND supplier_delivery_items.quantity_in_uom > 0
    AND units_of_measure.conversion_factor > 1
    AND supplier_delivery_items.notes NOT ILIKE '%UOM stock quantity repaired%'
),
items_to_repair AS (
  SELECT
    *,
    round(corrected_base_quantity - applied_base_quantity, 4) AS missing_base_quantity
  FROM repairable_items
  WHERE corrected_base_quantity > applied_base_quantity
),
updated_stock AS (
  UPDATE public.branch_stock
     SET base_quantity_on_hand = branch_stock.base_quantity_on_hand + items_to_repair.missing_base_quantity,
         quantity_on_hand = floor(branch_stock.base_quantity_on_hand + items_to_repair.missing_base_quantity)::integer,
         last_updated_at = now()
    FROM items_to_repair
   WHERE branch_stock.business_id = items_to_repair.business_id
     AND branch_stock.branch_id = items_to_repair.branch_id
     AND branch_stock.product_id = items_to_repair.product_id
  RETURNING items_to_repair.item_id
)
UPDATE public.supplier_delivery_items
   SET base_quantity_expected = items_to_repair.corrected_base_quantity,
       base_quantity_received = items_to_repair.corrected_base_quantity,
       quantity_expected = floor(items_to_repair.corrected_base_quantity)::integer,
       quantity_received = floor(items_to_repair.corrected_base_quantity)::integer,
       quantity_discrepancy = 0,
       notes = CASE
         WHEN NULLIF(supplier_delivery_items.notes, '') IS NULL THEN 'UOM stock quantity repaired'
         ELSE supplier_delivery_items.notes || '; UOM stock quantity repaired'
       END
  FROM items_to_repair
  JOIN updated_stock
    ON updated_stock.item_id = items_to_repair.item_id
 WHERE supplier_delivery_items.id = items_to_repair.item_id;
