/*
 * Employee sale UOM price fallback fix for Retivox.
 *
 * Aligns server-side sale price/discount resolution with the employee sale
 * form. Selected-UOM price points are preferred, but product-level price points
 * with NULL uom_id are valid fallbacks.
 */

CREATE OR REPLACE FUNCTION public.resolve_product_sale_price(
  p_business_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_base_quantity integer,
  p_uom_id uuid DEFAULT NULL
)
RETURNS TABLE(
  pricing_model_id uuid,
  pricing_method text,
  unit_price numeric,
  line_total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model public.product_pricing_models%ROWTYPE;
  v_point public.product_price_points%ROWTYPE;
  v_legacy_base_price numeric(12,2);
BEGIN
  IF p_base_quantity IS NULL OR p_base_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT *
    INTO v_model
    FROM public.product_pricing_models
   WHERE product_pricing_models.business_id = p_business_id
     AND product_pricing_models.product_id = p_product_id
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
   LIMIT 1;

  IF FOUND AND v_model.pricing_method IN ('assisted_pack', 'manual_quantity') THEN
    IF v_model.pricing_method = 'manual_quantity' THEN
      SELECT *
        INTO v_point
        FROM public.product_price_points
       WHERE product_price_points.pricing_model_id = v_model.id
         AND product_price_points.business_id = p_business_id
         AND product_price_points.product_id = p_product_id
         AND product_price_points.base_quantity = p_base_quantity
         AND (
           (p_uom_id IS NOT NULL AND (
             product_price_points.uom_id = p_uom_id
             OR product_price_points.uom_id IS NULL
           ))
           OR (p_uom_id IS NULL AND product_price_points.uom_id IS NULL)
         )
       ORDER BY
         CASE
           WHEN product_price_points.uom_id = p_uom_id THEN 0
           WHEN product_price_points.uom_id IS NULL THEN 1
           ELSE 2
         END
       LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'This quantity does not have an approved manual price for the selected unit';
      END IF;

      RETURN QUERY
      SELECT
        v_model.id,
        v_model.pricing_method,
        round(v_point.price / p_base_quantity, 2),
        round(v_point.price, 2);
      RETURN;
    END IF;

    SELECT *
      INTO v_point
      FROM public.product_price_points
     WHERE product_price_points.pricing_model_id = v_model.id
       AND product_price_points.business_id = p_business_id
       AND product_price_points.product_id = p_product_id
       AND product_price_points.base_quantity <= p_base_quantity
       AND (
         (p_uom_id IS NOT NULL AND (
           product_price_points.uom_id = p_uom_id
           OR product_price_points.uom_id IS NULL
         ))
         OR (p_uom_id IS NULL AND product_price_points.uom_id IS NULL)
       )
     ORDER BY
       CASE
         WHEN product_price_points.uom_id = p_uom_id THEN 0
         WHEN product_price_points.uom_id IS NULL THEN 1
         ELSE 2
       END,
       product_price_points.base_quantity DESC
     LIMIT 1;

    IF NOT FOUND THEN
      SELECT *
        INTO v_point
        FROM public.product_price_points
       WHERE product_price_points.pricing_model_id = v_model.id
         AND product_price_points.business_id = p_business_id
         AND product_price_points.product_id = p_product_id
         AND (
           (p_uom_id IS NOT NULL AND (
             product_price_points.uom_id = p_uom_id
             OR product_price_points.uom_id IS NULL
           ))
           OR (p_uom_id IS NULL AND product_price_points.uom_id IS NULL)
         )
       ORDER BY
         CASE
           WHEN product_price_points.uom_id = p_uom_id THEN 0
           WHEN product_price_points.uom_id IS NULL THEN 1
           ELSE 2
         END,
         product_price_points.base_quantity ASC
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'This product does not have approved prices for the selected unit';
    END IF;

    RETURN QUERY
    SELECT
      v_model.id,
      v_model.pricing_method,
      round((public.apply_product_pricing_rounding(p_base_quantity * (v_point.price / v_point.base_quantity), v_model.rounding_rule)) / p_base_quantity, 2),
      public.apply_product_pricing_rounding(p_base_quantity * (v_point.price / v_point.base_quantity), v_model.rounding_rule);
    RETURN;
  END IF;

  SELECT product_pricing.base_price
    INTO v_legacy_base_price
    FROM public.product_pricing
   WHERE product_pricing.business_id = p_business_id
     AND product_pricing.product_id = p_product_id
   ORDER BY product_pricing.effective_from DESC
   LIMIT 1;

  IF v_legacy_base_price IS NULL THEN
    RAISE EXCEPTION 'This product does not have an approved price';
  END IF;

  RETURN QUERY
  SELECT
    v_model.id,
    COALESCE(v_model.pricing_method, 'fixed_price'),
    round(v_legacy_base_price, 2),
    round(v_legacy_base_price * p_base_quantity, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_product_sale_discount(
  p_business_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_base_quantity integer,
  p_uom_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model public.product_pricing_models%ROWTYPE;
  v_point public.product_price_points%ROWTYPE;
BEGIN
  IF p_base_quantity IS NULL OR p_base_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT *
    INTO v_model
    FROM public.product_pricing_models
   WHERE product_pricing_models.business_id = p_business_id
     AND product_pricing_models.product_id = p_product_id
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
   LIMIT 1;

  IF NOT FOUND OR v_model.pricing_method NOT IN ('assisted_pack', 'manual_quantity') THEN
    RETURN 0;
  END IF;

  IF v_model.pricing_method = 'manual_quantity' THEN
    SELECT *
      INTO v_point
      FROM public.product_price_points
     WHERE product_price_points.pricing_model_id = v_model.id
       AND product_price_points.business_id = p_business_id
       AND product_price_points.product_id = p_product_id
       AND product_price_points.base_quantity = p_base_quantity
       AND (
         (p_uom_id IS NOT NULL AND (
           product_price_points.uom_id = p_uom_id
           OR product_price_points.uom_id IS NULL
         ))
         OR (p_uom_id IS NULL AND product_price_points.uom_id IS NULL)
       )
     ORDER BY
       CASE
         WHEN product_price_points.uom_id = p_uom_id THEN 0
         WHEN product_price_points.uom_id IS NULL THEN 1
         ELSE 2
       END
     LIMIT 1;

    IF NOT FOUND THEN
      RETURN 0;
    END IF;

    RETURN round(COALESCE(v_point.max_discount_amount, 0), 2);
  END IF;

  SELECT *
    INTO v_point
    FROM public.product_price_points
   WHERE product_price_points.pricing_model_id = v_model.id
     AND product_price_points.business_id = p_business_id
     AND product_price_points.product_id = p_product_id
     AND product_price_points.base_quantity <= p_base_quantity
     AND (
       (p_uom_id IS NOT NULL AND (
         product_price_points.uom_id = p_uom_id
         OR product_price_points.uom_id IS NULL
       ))
       OR (p_uom_id IS NULL AND product_price_points.uom_id IS NULL)
     )
   ORDER BY
     CASE
       WHEN product_price_points.uom_id = p_uom_id THEN 0
       WHEN product_price_points.uom_id IS NULL THEN 1
       ELSE 2
     END,
     product_price_points.base_quantity DESC
   LIMIT 1;

  IF NOT FOUND THEN
    SELECT *
      INTO v_point
      FROM public.product_price_points
     WHERE product_price_points.pricing_model_id = v_model.id
       AND product_price_points.business_id = p_business_id
       AND product_price_points.product_id = p_product_id
       AND (
         (p_uom_id IS NOT NULL AND (
           product_price_points.uom_id = p_uom_id
           OR product_price_points.uom_id IS NULL
         ))
         OR (p_uom_id IS NULL AND product_price_points.uom_id IS NULL)
       )
     ORDER BY
       CASE
         WHEN product_price_points.uom_id = p_uom_id THEN 0
         WHEN product_price_points.uom_id IS NULL THEN 1
         ELSE 2
       END,
       product_price_points.base_quantity ASC
     LIMIT 1;
  END IF;

  IF NOT FOUND OR COALESCE(v_point.max_discount_amount, 0) <= 0 THEN
    RETURN 0;
  END IF;

  RETURN round(COALESCE(v_point.max_discount_amount, 0) * (p_base_quantity::numeric / v_point.base_quantity), 2);
END;
$$;
