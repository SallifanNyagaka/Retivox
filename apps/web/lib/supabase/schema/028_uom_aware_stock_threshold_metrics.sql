/*
 * UOM-aware stock threshold metrics for Retivox.
 *
 * Low-stock thresholds are entered in the product's default receiving UOM.
 * For example, threshold 10 for a Tray of 30 means 300 base units.
 */

CREATE OR REPLACE FUNCTION public.get_product_default_purchase_conversion_factor(
  p_business_id uuid,
  p_product_id uuid
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT units_of_measure.conversion_factor
        FROM public.product_uom_links
        JOIN public.units_of_measure
          ON units_of_measure.id = product_uom_links.uom_id
         AND units_of_measure.business_id = product_uom_links.business_id
       WHERE product_uom_links.business_id = p_business_id
         AND product_uom_links.product_id = p_product_id
         AND product_uom_links.is_purchase_uom = true
         AND units_of_measure.is_active = true
       ORDER BY
         product_uom_links.is_default_purchase_uom DESC,
         units_of_measure.conversion_factor DESC,
         product_uom_links.is_base_uom DESC
       LIMIT 1
    ),
    (
      SELECT units_of_measure.conversion_factor
        FROM public.product_uom_links
        JOIN public.units_of_measure
          ON units_of_measure.id = product_uom_links.uom_id
         AND units_of_measure.business_id = product_uom_links.business_id
       WHERE product_uom_links.business_id = p_business_id
         AND product_uom_links.product_id = p_product_id
         AND units_of_measure.is_active = true
       ORDER BY
         product_uom_links.is_base_uom DESC,
         units_of_measure.conversion_factor ASC
       LIMIT 1
    ),
    1
  );
$$;

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
  WITH scoped_stock AS (
    SELECT
      branch_stock.branch_id,
      COALESCE(branch_stock.base_quantity_on_hand, branch_stock.quantity_on_hand)::numeric AS base_quantity_on_hand,
      branch_stock.low_stock_threshold * public.get_product_default_purchase_conversion_factor(
        branch_stock.business_id,
        branch_stock.product_id
      ) AS base_low_stock_threshold
    FROM public.branch_stock
    WHERE branch_stock.branch_id = ANY(p_branch_ids)
      AND branch_stock.business_id = public.get_my_business_id()
  )
  SELECT
    COUNT(*)::integer AS total_skus,
    COUNT(*) FILTER (
      WHERE scoped_stock.base_quantity_on_hand > 0
        AND scoped_stock.base_quantity_on_hand <= scoped_stock.base_low_stock_threshold
    )::integer AS low_stock_count,
    COUNT(*) FILTER (WHERE scoped_stock.base_quantity_on_hand = 0)::integer AS out_of_stock_count,
    COUNT(DISTINCT scoped_stock.branch_id) FILTER (
      WHERE scoped_stock.base_quantity_on_hand <= scoped_stock.base_low_stock_threshold
    )::integer AS branches_with_alerts
  FROM scoped_stock;
$$;

