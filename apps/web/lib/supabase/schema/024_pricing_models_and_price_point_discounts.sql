/*
 * Product pricing model refinements for Retivox.
 *
 * Allows one product to keep multiple active pricing styles for the same scope
 * (for example fixed/base plus assisted pack pricing), and stores a maximum
 * discount allowance per approved quantity/pack price point.
 */

DROP INDEX IF EXISTS public.idx_product_pricing_models_one_active_scope;

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_pricing_models_one_active_method_scope
  ON public.product_pricing_models (
    product_id,
    pricing_method,
    (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  WHERE status IN ('approved', 'pending_approval', 'draft');

ALTER TABLE public.product_price_points
  ADD COLUMN IF NOT EXISTS max_discount_amount numeric(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'product_price_points_max_discount_nonnegative'
       AND conrelid = 'public.product_price_points'::regclass
  ) THEN
    ALTER TABLE public.product_price_points
      ADD CONSTRAINT product_price_points_max_discount_nonnegative CHECK (max_discount_amount >= 0);
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.employee_available_products(uuid);

CREATE OR REPLACE FUNCTION public.employee_available_products(p_branch_id uuid)
RETURNS TABLE(
  product_id uuid,
  name text,
  sku text,
  category text,
  unit text,
  selling_price numeric,
  pricing_method text,
  rounding_rule text,
  pricing_options jsonb,
  uom_options jsonb,
  quantity_on_hand integer,
  quantity_reserved integer,
  base_quantity_on_hand numeric,
  base_quantity_reserved numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped_products AS (
    SELECT
      products.id AS product_id,
      products.name,
      products.sku,
      products.category,
      products.unit,
      branch_stock.quantity_on_hand,
      branch_stock.quantity_reserved,
      branch_stock.base_quantity_on_hand,
      branch_stock.base_quantity_reserved
    FROM public.branch_stock
    JOIN public.products
      ON products.id = branch_stock.product_id
     AND products.business_id = branch_stock.business_id
    WHERE branch_stock.business_id = public.get_my_business_id()
      AND branch_stock.branch_id = p_branch_id
      AND products.is_active = true
      AND products.deleted_at IS NULL
      AND (branch_stock.base_quantity_on_hand - branch_stock.base_quantity_reserved) > 0
  ),
  resolved_models AS (
    SELECT
      scoped_products.*,
      product_pricing_models.id AS pricing_model_id,
      product_pricing_models.pricing_method,
      product_pricing_models.rounding_rule
    FROM scoped_products
    LEFT JOIN LATERAL (
      SELECT *
        FROM public.product_pricing_models
       WHERE product_pricing_models.business_id = public.get_my_business_id()
         AND product_pricing_models.product_id = scoped_products.product_id
         AND product_pricing_models.status = 'approved'
         AND (product_pricing_models.branch_id = p_branch_id OR product_pricing_models.branch_id IS NULL)
       ORDER BY
         CASE WHEN product_pricing_models.branch_id = p_branch_id THEN 0 ELSE 1 END,
         CASE product_pricing_models.pricing_method
           WHEN 'assisted_pack' THEN 0
           WHEN 'manual_quantity' THEN 1
           ELSE 2
         END,
         product_pricing_models.approved_at DESC NULLS LAST,
         product_pricing_models.created_at DESC
       LIMIT 1
    ) AS product_pricing_models ON true
  )
  SELECT
    resolved_models.product_id,
    resolved_models.name,
    resolved_models.sku,
    resolved_models.category,
    resolved_models.unit,
    COALESCE(
      (
        SELECT product_price_points.price
          FROM public.product_price_points
         WHERE product_price_points.pricing_model_id = resolved_models.pricing_model_id
           AND product_price_points.business_id = public.get_my_business_id()
         ORDER BY product_price_points.base_quantity ASC
         LIMIT 1
      ),
      (
        SELECT product_pricing.base_price
          FROM public.product_pricing
         WHERE product_pricing.business_id = public.get_my_business_id()
           AND product_pricing.product_id = resolved_models.product_id
         ORDER BY product_pricing.effective_from DESC
         LIMIT 1
      ),
      0
    ) AS selling_price,
    COALESCE(resolved_models.pricing_method, 'fixed_price') AS pricing_method,
    COALESCE(resolved_models.rounding_rule, 'nearest_5') AS rounding_rule,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'quantity', product_price_points.quantity_in_uom,
            'baseQuantity', product_price_points.base_quantity,
            'price', product_price_points.price,
            'maxDiscountAmount', product_price_points.max_discount_amount,
            'uomId', product_price_points.uom_id
          )
          ORDER BY product_price_points.base_quantity ASC
        )
          FROM public.product_price_points
         WHERE product_price_points.pricing_model_id = resolved_models.pricing_model_id
           AND product_price_points.business_id = public.get_my_business_id()
      ),
      '[]'::jsonb
    ) AS pricing_options,
    public.get_product_uom_options_json(public.get_my_business_id(), resolved_models.product_id) AS uom_options,
    resolved_models.quantity_on_hand,
    resolved_models.quantity_reserved,
    resolved_models.base_quantity_on_hand,
    resolved_models.base_quantity_reserved
  FROM resolved_models
  WHERE jsonb_array_length(public.get_product_uom_options_json(public.get_my_business_id(), resolved_models.product_id)) > 0
    AND (
      (
        resolved_models.pricing_method IN ('assisted_pack', 'manual_quantity')
        AND EXISTS (
          SELECT 1
            FROM public.product_price_points
           WHERE product_price_points.pricing_model_id = resolved_models.pricing_model_id
             AND product_price_points.business_id = public.get_my_business_id()
        )
      )
      OR (
        COALESCE(resolved_models.pricing_method, 'fixed_price') = 'fixed_price'
        AND EXISTS (
          SELECT 1
            FROM public.product_pricing
           WHERE product_pricing.business_id = public.get_my_business_id()
             AND product_pricing.product_id = resolved_models.product_id
        )
      )
    )
  ORDER BY resolved_models.name ASC;
$$;
