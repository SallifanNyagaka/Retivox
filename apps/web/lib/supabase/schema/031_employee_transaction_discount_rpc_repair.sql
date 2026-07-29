/*
 * Employee transaction discount RPC repair for Retivox.
 *
 * Replaces employee_record_transaction so employee sales definitely use
 * resolve_product_sale_discount instead of the older branch percentage rule.
 * The rejection message includes the computed max discount for easier testing.
 */

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

  IF v_discount_amount > v_max_discount_amount THEN
    RAISE EXCEPTION 'Discount exceeds the maximum allowed for these items. Maximum allowed: %', v_max_discount_amount;
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
    NULL,
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
