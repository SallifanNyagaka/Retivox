/*
 * UOM-aware stock intake and sales for Retivox.
 *
 * This additive migration finalizes the product model where one product can be
 * stocked and sold in multiple linked units, for example eggs as singles or
 * trays of 30. Inventory remains stored in base units so a sale of 3 eggs from
 * 20 trays correctly leaves 19 trays and 27 eggs.
 */

ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS uom_id uuid REFERENCES public.units_of_measure(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS quantity_in_uom numeric(12,4),
  ADD COLUMN IF NOT EXISTS base_quantity numeric(12,4) NOT NULL DEFAULT 0;

ALTER TABLE public.product_uom_links
  ADD COLUMN IF NOT EXISTS is_purchase_uom boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_sale_uom boolean NOT NULL DEFAULT true;

UPDATE public.transaction_items
   SET base_quantity = quantity
 WHERE base_quantity = 0
   AND quantity > 0;

UPDATE public.transaction_items
   SET quantity_in_uom = quantity
 WHERE quantity_in_uom IS NULL
   AND quantity > 0;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'transaction_items_base_quantity_positive'
       AND conrelid = 'public.transaction_items'::regclass
  ) THEN
    ALTER TABLE public.transaction_items
      ADD CONSTRAINT transaction_items_base_quantity_positive CHECK (base_quantity > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'transaction_items_quantity_in_uom_positive'
       AND conrelid = 'public.transaction_items'::regclass
  ) THEN
    ALTER TABLE public.transaction_items
      ADD CONSTRAINT transaction_items_quantity_in_uom_positive CHECK (quantity_in_uom IS NULL OR quantity_in_uom > 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_product_uom_link(
  p_business_id uuid,
  p_product_id uuid,
  p_uom_id uuid
)
RETURNS public.units_of_measure
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uom public.units_of_measure%ROWTYPE;
BEGIN
  SELECT units_of_measure.*
    INTO v_uom
    FROM public.product_uom_links
    JOIN public.units_of_measure
      ON units_of_measure.id = product_uom_links.uom_id
     AND units_of_measure.business_id = product_uom_links.business_id
   WHERE product_uom_links.business_id = p_business_id
     AND product_uom_links.product_id = p_product_id
     AND product_uom_links.uom_id = p_uom_id
     AND units_of_measure.is_active = true
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected unit is not linked to this product';
  END IF;

  RETURN v_uom;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_product_default_sale_uom_id(
  p_business_id uuid,
  p_product_id uuid
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT product_uom_links.uom_id
    FROM public.product_uom_links
    JOIN public.units_of_measure
      ON units_of_measure.id = product_uom_links.uom_id
     AND units_of_measure.business_id = product_uom_links.business_id
   WHERE product_uom_links.business_id = p_business_id
     AND product_uom_links.product_id = p_product_id
     AND product_uom_links.is_sale_uom = true
     AND units_of_measure.is_active = true
   ORDER BY
     product_uom_links.is_default_sale_uom DESC,
     product_uom_links.is_base_uom DESC,
     units_of_measure.conversion_factor ASC
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_product_default_purchase_uom_id(
  p_business_id uuid,
  p_product_id uuid
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT product_uom_links.uom_id
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
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_product_uom_options_json(
  p_business_id uuid,
  p_product_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', units_of_measure.id,
        'name', units_of_measure.name,
        'abbreviation', units_of_measure.abbreviation,
        'conversionFactor', units_of_measure.conversion_factor,
        'isBaseUnit', units_of_measure.is_base_unit,
        'isBaseUom', product_uom_links.is_base_uom,
        'isPurchaseUom', product_uom_links.is_purchase_uom,
        'isSaleUom', product_uom_links.is_sale_uom,
        'isDefaultSaleUom', product_uom_links.is_default_sale_uom,
        'isDefaultPurchaseUom', product_uom_links.is_default_purchase_uom
      )
      ORDER BY product_uom_links.is_default_sale_uom DESC, product_uom_links.is_base_uom DESC, units_of_measure.conversion_factor ASC
    ),
    '[]'::jsonb
  )
  FROM public.product_uom_links
  JOIN public.units_of_measure
    ON units_of_measure.id = product_uom_links.uom_id
   AND units_of_measure.business_id = product_uom_links.business_id
  WHERE product_uom_links.business_id = p_business_id
    AND product_uom_links.product_id = p_product_id
    AND product_uom_links.is_sale_uom = true
    AND units_of_measure.is_active = true;
$$;

DROP FUNCTION IF EXISTS public.employee_record_transaction(jsonb, text, numeric, text, text, text, text);
DROP FUNCTION IF EXISTS public.resolve_product_sale_price(uuid, uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.resolve_product_sale_price(
  p_business_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_base_quantity integer
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
         AND base_quantity = p_base_quantity
       LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'This quantity does not have an approved manual price';
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
     WHERE pricing_model_id = v_model.id
       AND business_id = p_business_id
       AND product_id = p_product_id
       AND base_quantity <= p_base_quantity
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
  v_available_base_quantity numeric(12,4);
  v_base_quantity numeric(12,4);
  v_legacy_quantity integer;
  v_uom_id uuid;
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
      FROM public.resolve_product_sale_price(v_business_id, v_branch_id, v_item.product_id, v_legacy_quantity)
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
      stock_status,
      uom_id,
      quantity_in_uom,
      base_quantity
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
      v_base_quantity
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
      'pricing_source', 'product_pricing_models',
      'quantity_mode', 'uom_to_base'
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
      base_quantity_reserved
    )
    VALUES (
      v_delivery.to_branch_id,
      v_item.product_id,
      v_delivery.business_id,
      v_legacy_quantity,
      0,
      10,
      v_base_quantity,
      0
    )
    ON CONFLICT (branch_id, product_id)
    DO UPDATE
       SET base_quantity_on_hand = public.branch_stock.base_quantity_on_hand + EXCLUDED.base_quantity_on_hand,
           quantity_on_hand = floor(public.branch_stock.base_quantity_on_hand + EXCLUDED.base_quantity_on_hand)::integer,
           last_updated_at = now();

    UPDATE public.supplier_delivery_items
       SET quantity_received = v_legacy_quantity,
           quantity_discrepancy = 0,
           base_quantity_received = v_base_quantity
     WHERE delivery_id = p_delivery_id
       AND product_id = v_item.product_id
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
      base_quantity_received
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
      CASE WHEN v_delivery_status = 'received' THEN v_base_quantity ELSE 0 END
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
      'quantity_mode', 'uom_to_base'
    )
  );

  RETURN v_delivery_id;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_transaction_items_business_product_uom
  ON public.transaction_items (business_id, product_id, uom_id);

CREATE INDEX IF NOT EXISTS idx_supplier_delivery_items_business_product_uom
  ON public.supplier_delivery_items (business_id, product_id, uom_id);
