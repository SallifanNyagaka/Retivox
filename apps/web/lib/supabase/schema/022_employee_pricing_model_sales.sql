/*
 * Employee pricing-model sales for Retivox.
 *
 * Upgrades employee product availability and transaction recording so sales use
 * owner-approved product_pricing_models/product_price_points. Prices are
 * resolved server-side per product and branch, with legacy product_pricing as a
 * fallback for fixed-price products.
 */

CREATE OR REPLACE FUNCTION public.apply_product_pricing_rounding(
  p_value numeric,
  p_rounding_rule text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_rounding_rule = 'none' THEN
    RETURN round(p_value, 2);
  END IF;

  IF p_rounding_rule = 'up_5' THEN
    RETURN ceil(p_value / 5) * 5;
  END IF;

  IF p_rounding_rule = 'down_5' THEN
    RETURN floor(p_value / 5) * 5;
  END IF;

  IF p_rounding_rule = 'nearest_10' THEN
    RETURN round(p_value / 10) * 10;
  END IF;

  RETURN round(p_value / 5) * 5;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_product_sale_price(
  p_business_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_quantity integer
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
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT *
    INTO v_model
    FROM public.product_pricing_models
   WHERE business_id = p_business_id
     AND product_id = p_product_id
     AND status = 'approved'
     AND (branch_id = p_branch_id OR branch_id IS NULL)
   ORDER BY
     CASE WHEN branch_id = p_branch_id THEN 0 ELSE 1 END,
     approved_at DESC NULLS LAST,
     created_at DESC
   LIMIT 1;

  IF FOUND AND v_model.pricing_method IN ('assisted_pack', 'manual_quantity') THEN
    IF v_model.pricing_method = 'manual_quantity' THEN
      SELECT *
        INTO v_point
        FROM public.product_price_points
       WHERE pricing_model_id = v_model.id
         AND business_id = p_business_id
         AND product_id = p_product_id
         AND base_quantity = p_quantity
       LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'This quantity does not have an approved manual price';
      END IF;

      RETURN QUERY
      SELECT
        v_model.id,
        v_model.pricing_method,
        round(v_point.price / p_quantity, 2),
        round(v_point.price, 2);
      RETURN;
    END IF;

    SELECT *
      INTO v_point
      FROM public.product_price_points
     WHERE pricing_model_id = v_model.id
       AND business_id = p_business_id
       AND product_id = p_product_id
       AND base_quantity <= p_quantity
     ORDER BY base_quantity DESC
     LIMIT 1;

    IF NOT FOUND THEN
      SELECT *
        INTO v_point
        FROM public.product_price_points
       WHERE pricing_model_id = v_model.id
         AND business_id = p_business_id
         AND product_id = p_product_id
       ORDER BY base_quantity ASC
       LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'This product does not have approved pack prices';
    END IF;

    RETURN QUERY
    SELECT
      v_model.id,
      v_model.pricing_method,
      round((public.apply_product_pricing_rounding(p_quantity * (v_point.price / v_point.base_quantity), v_model.rounding_rule)) / p_quantity, 2),
      public.apply_product_pricing_rounding(p_quantity * (v_point.price / v_point.base_quantity), v_model.rounding_rule);
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
    CASE WHEN FOUND THEN v_model.id ELSE NULL END,
    COALESCE(v_model.pricing_method, 'fixed_price'),
    round(v_legacy_base_price, 2),
    round(v_legacy_base_price * p_quantity, 2);
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
  quantity_on_hand integer,
  quantity_reserved integer
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
      branch_stock.quantity_reserved
    FROM public.branch_stock
    JOIN public.products
      ON products.id = branch_stock.product_id
     AND products.business_id = branch_stock.business_id
    WHERE branch_stock.business_id = public.get_my_business_id()
      AND branch_stock.branch_id = p_branch_id
      AND products.is_active = true
      AND products.deleted_at IS NULL
      AND (branch_stock.quantity_on_hand - branch_stock.quantity_reserved) > 0
  ),
  resolved_models AS (
    SELECT
      scoped_products.*,
      product_pricing_models.id AS pricing_model_id,
      product_pricing_models.pricing_method,
      product_pricing_models.rounding_rule,
      product_pricing_models.branch_id
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
            'price', product_price_points.price
          )
          ORDER BY product_price_points.base_quantity ASC
        )
          FROM public.product_price_points
         WHERE product_price_points.pricing_model_id = resolved_models.pricing_model_id
           AND product_price_points.business_id = public.get_my_business_id()
      ),
      '[]'::jsonb
    ) AS pricing_options,
    resolved_models.quantity_on_hand,
    resolved_models.quantity_reserved
  FROM resolved_models
  WHERE (
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
  ORDER BY resolved_models.name ASC;
$$;

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
  v_subtotal numeric(10,2) := 0;
  v_discount_amount numeric(10,2) := COALESCE(p_discount_amount, 0);
  v_max_discount_amount numeric(10,2);
  v_total_amount numeric(10,2);
  v_available_quantity integer;
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
      SUM((item_value->>'quantity')::integer)::integer AS quantity
    FROM jsonb_array_elements(p_items) AS item_value
    GROUP BY (item_value->>'productId')::uuid
  LOOP
    IF v_item.product_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Each product quantity must be greater than zero';
    END IF;

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

    v_available_quantity := v_stock.quantity_on_hand - v_stock.quantity_reserved;

    IF v_available_quantity < v_item.quantity THEN
      RAISE EXCEPTION 'Insufficient stock. Available quantity: %', GREATEST(v_available_quantity, 0);
    END IF;

    SELECT *
      INTO v_resolved_price
      FROM public.resolve_product_sale_price(v_business_id, v_branch_id, v_item.product_id, v_item.quantity)
      LIMIT 1;

    IF v_resolved_price.line_total IS NULL OR v_resolved_price.line_total <= 0 THEN
      RAISE EXCEPTION 'Unable to resolve an approved price for one or more products';
    END IF;

    v_line_total := round(v_resolved_price.line_total, 2);
    v_unit_price := round(v_resolved_price.unit_price, 2);
    v_subtotal := round(v_subtotal + v_line_total, 2);

    INSERT INTO public.transaction_items (
      transaction_id,
      product_id,
      business_id,
      quantity,
      unit_price_at_sale,
      line_total,
      stock_status
    )
    VALUES (
      v_transaction_id,
      v_item.product_id,
      v_business_id,
      v_item.quantity,
      v_unit_price,
      v_line_total,
      'deducted'
    );

    UPDATE public.branch_stock
       SET quantity_on_hand = quantity_on_hand - v_item.quantity,
           last_updated_at = now()
     WHERE id = v_stock.id;
  END LOOP;

  IF v_subtotal <= 0 THEN
    RAISE EXCEPTION 'Transaction total must be greater than zero';
  END IF;

  IF v_discount_amount < 0 THEN
    RAISE EXCEPTION 'Discount cannot be negative';
  END IF;

  v_max_discount_amount := round(v_subtotal * (COALESCE(v_branch.max_discount_percentage, 0) / 100), 2);

  IF v_discount_amount > v_max_discount_amount THEN
    RAISE EXCEPTION 'Discount exceeds the maximum allowed for this branch';
  END IF;

  v_total_amount := round(v_subtotal - v_discount_amount, 2);

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
      'total_amount', v_total_amount,
      'payment_method', p_payment_method,
      'payment_status', v_payment_status,
      'pricing_source', 'product_pricing_models'
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

CREATE INDEX IF NOT EXISTS idx_product_pricing_models_product_branch_status
  ON public.product_pricing_models (business_id, product_id, branch_id, status, approved_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_price_points_model_base_quantity
  ON public.product_price_points (pricing_model_id, business_id, product_id, base_quantity);
