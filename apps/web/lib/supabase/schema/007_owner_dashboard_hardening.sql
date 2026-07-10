-- SmartRetail Database Schema Group 7: Owner Dashboard Hardening
--
-- Transactional RPC functions for high-risk owner dashboard writes.
-- These functions intentionally re-check business ownership/role inside the
-- database and keep the core write plus audit log in the same transaction.

CREATE OR REPLACE FUNCTION public.owner_adjust_stock(
  p_stock_id uuid,
  p_quantity integer,
  p_operation text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_stock branch_stock%ROWTYPE;
  v_next_quantity integer;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_operation NOT IN ('add', 'remove') THEN
    RAISE EXCEPTION 'Invalid stock operation';
  END IF;

  SELECT *
    INTO v_stock
    FROM branch_stock
   WHERE id = p_stock_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock record not found';
  END IF;

  IF p_operation = 'add' THEN
    v_next_quantity := v_stock.quantity_on_hand + p_quantity;
  ELSE
    v_next_quantity := GREATEST(0, v_stock.quantity_on_hand - p_quantity);
  END IF;

  UPDATE branch_stock
     SET quantity_on_hand = v_next_quantity,
         last_updated_at = now()
   WHERE id = v_stock.id;

  INSERT INTO audit_logs (
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
    'branch_stock',
    v_stock.id,
    'adjusted',
    jsonb_build_object('quantity_on_hand', v_stock.quantity_on_hand),
    jsonb_build_object(
      'quantity_on_hand',
      v_next_quantity,
      'operation',
      p_operation,
      'quantity',
      p_quantity
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_create_product(
  p_name text,
  p_sku text,
  p_category text,
  p_unit text,
  p_description text,
  p_base_price numeric,
  p_min_price numeric,
  p_max_price numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_product_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO products (
    business_id,
    name,
    sku,
    category,
    unit,
    description
  )
  VALUES (
    v_business_id,
    p_name,
    p_sku,
    p_category,
    p_unit,
    NULLIF(p_description, '')
  )
  RETURNING id INTO v_product_id;

  INSERT INTO product_pricing (
    business_id,
    product_id,
    base_price,
    min_price,
    max_price,
    set_by
  )
  VALUES (
    v_business_id,
    v_product_id,
    p_base_price,
    p_min_price,
    p_max_price,
    v_actor_id
  );

  INSERT INTO audit_logs (
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
    'product',
    v_product_id,
    'created',
    NULL,
    jsonb_build_object(
      'name',
      p_name,
      'sku',
      p_sku,
      'category',
      p_category,
      'unit',
      p_unit,
      'description',
      NULLIF(p_description, ''),
      'base_price',
      p_base_price,
      'min_price',
      p_min_price,
      'max_price',
      p_max_price
    )
  );

  RETURN v_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_update_product(
  p_product_id uuid,
  p_name text,
  p_sku text,
  p_category text,
  p_unit text,
  p_description text,
  p_base_price numeric,
  p_min_price numeric,
  p_max_price numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_product products%ROWTYPE;
  v_pricing product_pricing%ROWTYPE;
  v_old_value jsonb;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
    INTO v_product
    FROM products
   WHERE id = p_product_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  SELECT *
    INTO v_pricing
    FROM product_pricing
   WHERE product_id = p_product_id
     AND business_id = v_business_id
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  v_old_value := jsonb_build_object(
    'id',
    v_product.id,
    'name',
    v_product.name,
    'sku',
    v_product.sku,
    'category',
    v_product.category,
    'unit',
    v_product.unit,
    'description',
    v_product.description,
    'is_active',
    v_product.is_active,
    'pricing',
    CASE
      WHEN v_pricing.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'base_price',
        v_pricing.base_price,
        'min_price',
        v_pricing.min_price,
        'max_price',
        v_pricing.max_price
      )
    END
  );

  UPDATE products
     SET name = p_name,
         sku = p_sku,
         category = p_category,
         unit = p_unit,
         description = NULLIF(p_description, '')
   WHERE id = p_product_id;

  IF v_pricing.id IS NULL THEN
    INSERT INTO product_pricing (
      product_id,
      business_id,
      base_price,
      min_price,
      max_price,
      set_by
    )
    VALUES (
      p_product_id,
      v_business_id,
      p_base_price,
      p_min_price,
      p_max_price,
      v_actor_id
    );
  ELSE
    UPDATE product_pricing
       SET base_price = p_base_price,
           min_price = p_min_price,
           max_price = p_max_price
     WHERE id = v_pricing.id;
  END IF;

  INSERT INTO audit_logs (
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
    'product',
    p_product_id,
    'updated',
    v_old_value,
    jsonb_build_object(
      'name',
      p_name,
      'sku',
      p_sku,
      'category',
      p_category,
      'unit',
      p_unit,
      'description',
      NULLIF(p_description, ''),
      'base_price',
      p_base_price,
      'min_price',
      p_min_price,
      'max_price',
      p_max_price
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_toggle_product_status(
  p_product_id uuid,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_product products%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
    INTO v_product
    FROM products
   WHERE id = p_product_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  UPDATE products
     SET is_active = p_is_active
   WHERE id = p_product_id;

  INSERT INTO audit_logs (
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
    'product',
    p_product_id,
    CASE WHEN p_is_active THEN 'activated' ELSE 'deactivated' END,
    jsonb_build_object('is_active', v_product.is_active),
    jsonb_build_object('is_active', p_is_active)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_verify_payment(
  p_payment_id uuid,
  p_action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_payment payments%ROWTYPE;
  v_transaction transactions%ROWTYPE;
  v_next_status text;
  v_verified_at timestamptz;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid payment action';
  END IF;

  SELECT *
    INTO v_payment
    FROM payments
   WHERE id = p_payment_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.status <> 'pending_verify' THEN
    RAISE EXCEPTION 'Only pending verification payments can be updated';
  END IF;

  SELECT *
    INTO v_transaction
    FROM transactions
   WHERE id = v_payment.transaction_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  v_next_status := CASE WHEN p_action = 'approve' THEN 'verified' ELSE 'rejected' END;
  v_verified_at := now();

  UPDATE payments
     SET status = v_next_status,
         verified_by = v_actor_id,
         verified_at = v_verified_at
   WHERE id = v_payment.id;

  UPDATE transactions
     SET status = v_next_status
   WHERE id = v_transaction.id;

  IF v_transaction.employee_id IS NOT NULL THEN
    INSERT INTO notifications (
      business_id,
      recipient_id,
      type,
      title,
      body,
      metadata,
      is_read
    )
    VALUES (
      v_business_id,
      v_transaction.employee_id,
      CASE WHEN p_action = 'approve' THEN 'payment_verified' ELSE 'payment_rejected' END,
      CASE WHEN p_action = 'approve' THEN 'Payment approved' ELSE 'Payment rejected' END,
      CASE
        WHEN p_action = 'approve' THEN 'A payment you submitted has been approved.'
        ELSE 'A payment you submitted has been rejected.'
      END,
      jsonb_build_object(
        'payment_id',
        v_payment.id,
        'transaction_id',
        v_transaction.id,
        'status',
        v_next_status
      ),
      false
    );
  END IF;

  INSERT INTO audit_logs (
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
    'payment',
    v_payment.id,
    CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
    jsonb_build_object(
      'payment_status',
      v_payment.status,
      'transaction_status',
      v_transaction.status
    ),
    jsonb_build_object(
      'payment_status',
      v_next_status,
      'transaction_status',
      v_next_status,
      'verified_by',
      v_actor_id,
      'verified_at',
      v_verified_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_void_transaction(
  p_transaction_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_transaction transactions%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
    INTO v_transaction
    FROM transactions
   WHERE id = p_transaction_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_transaction.status = 'voided' THEN
    RAISE EXCEPTION 'Transaction is already voided';
  END IF;

  UPDATE transactions
     SET status = 'voided'
   WHERE id = v_transaction.id;

  INSERT INTO audit_logs (
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
    v_transaction.id,
    'voided',
    jsonb_build_object('status', v_transaction.status),
    jsonb_build_object('status', 'voided')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_approve_employee_transfer(
  p_transfer_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_transfer employee_transfers%ROWTYPE;
  v_approved_at timestamptz;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
    INTO v_transfer
    FROM employee_transfers
   WHERE id = p_transfer_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;

  IF v_transfer.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending transfers can be approved';
  END IF;

  PERFORM 1
    FROM user_branch_roles
   WHERE business_id = v_business_id
     AND user_id = v_transfer.user_id
     AND role = 'employee'
   FOR UPDATE;

  DELETE FROM user_branch_roles
   WHERE business_id = v_business_id
     AND user_id = v_transfer.user_id
     AND role = 'employee';

  INSERT INTO user_branch_roles (
    user_id,
    branch_id,
    business_id,
    role,
    assigned_by
  )
  VALUES (
    v_transfer.user_id,
    v_transfer.to_branch_id,
    v_business_id,
    'employee',
    v_actor_id
  );

  v_approved_at := now();

  UPDATE employee_transfers
     SET approved_by = v_actor_id,
         status = 'approved',
         approved_at = v_approved_at
   WHERE id = v_transfer.id;

  INSERT INTO audit_logs (
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
    'employee_transfer',
    v_transfer.id,
    'approved',
    jsonb_build_object('status', v_transfer.status, 'branch_id', v_transfer.from_branch_id),
    jsonb_build_object('status', 'approved', 'branch_id', v_transfer.to_branch_id, 'approved_at', v_approved_at)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_approve_stock_transfer(
  p_transfer_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_transfer stock_transfers%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
    INTO v_transfer
    FROM stock_transfers
   WHERE id = p_transfer_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;

  IF v_transfer.status <> 'initiated' THEN
    RAISE EXCEPTION 'Only initiated transfers can be approved';
  END IF;

  UPDATE stock_transfers
     SET status = 'in_transit'
   WHERE id = v_transfer.id;

  INSERT INTO audit_logs (
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
    'stock_transfer',
    v_transfer.id,
    'approved',
    jsonb_build_object('status', 'initiated'),
    jsonb_build_object('status', 'in_transit')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_initiate_stock_transfer(
  p_from_branch_id uuid,
  p_to_branch_id uuid,
  p_items jsonb,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_transfer_id uuid;
  v_item record;
  v_stock branch_stock%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_from_branch_id = p_to_branch_id THEN
    RAISE EXCEPTION 'Source and destination branches must be different';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one product';
  END IF;

  PERFORM 1
    FROM branches
   WHERE id IN (p_from_branch_id, p_to_branch_id)
     AND business_id = v_business_id;

  IF (SELECT count(*) FROM branches WHERE id IN (p_from_branch_id, p_to_branch_id) AND business_id = v_business_id) <> 2 THEN
    RAISE EXCEPTION 'One or more branches are invalid';
  END IF;

  INSERT INTO stock_transfers (
    business_id,
    from_branch_id,
    to_branch_id,
    initiated_by,
    status,
    notes
  )
  VALUES (
    v_business_id,
    p_from_branch_id,
    p_to_branch_id,
    v_actor_id,
    'initiated',
    NULLIF(p_notes, '')
  )
  RETURNING id INTO v_transfer_id;

  FOR v_item IN
    SELECT
      (item_value->>'productId')::uuid AS product_id,
      SUM((item_value->>'quantity')::integer)::integer AS quantity
    FROM jsonb_array_elements(p_items) AS item_value
    GROUP BY (item_value->>'productId')::uuid
  LOOP
    IF v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Quantity must be greater than zero';
    END IF;

    SELECT *
      INTO v_stock
      FROM branch_stock
     WHERE business_id = v_business_id
       AND branch_id = p_from_branch_id
       AND product_id = v_item.product_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'One or more products are not stocked at the source branch';
    END IF;

    IF (v_stock.quantity_on_hand - v_stock.quantity_reserved) < v_item.quantity THEN
      RAISE EXCEPTION 'Insufficient available stock for one or more products';
    END IF;

    INSERT INTO stock_transfer_items (
      transfer_id,
      business_id,
      product_id,
      quantity_sent
    )
    VALUES (
      v_transfer_id,
      v_business_id,
      v_item.product_id,
      v_item.quantity
    );

    UPDATE branch_stock
       SET quantity_reserved = quantity_reserved + v_item.quantity,
           last_updated_at = now()
     WHERE id = v_stock.id;
  END LOOP;

  INSERT INTO audit_logs (
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
    'stock_transfer',
    v_transfer_id,
    'initiated',
    NULL,
    jsonb_build_object(
      'from_branch_id',
      p_from_branch_id,
      'to_branch_id',
      p_to_branch_id,
      'item_count',
      jsonb_array_length(p_items),
      'notes',
      NULLIF(p_notes, '')
    )
  );

  RETURN v_transfer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_mark_stock_transfer_received(
  p_transfer_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_transfer stock_transfers%ROWTYPE;
  v_item stock_transfer_items%ROWTYPE;
  v_source branch_stock%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
    INTO v_transfer
    FROM stock_transfers
   WHERE id = p_transfer_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;

  IF v_transfer.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Only in-transit transfers can be received';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM stock_transfer_items
     WHERE transfer_id = p_transfer_id
       AND business_id = v_business_id
  ) THEN
    RAISE EXCEPTION 'Transfer has no items';
  END IF;

  FOR v_item IN
    SELECT *
      FROM stock_transfer_items
     WHERE transfer_id = p_transfer_id
       AND business_id = v_business_id
     FOR UPDATE
  LOOP
    SELECT *
      INTO v_source
      FROM branch_stock
     WHERE business_id = v_business_id
       AND branch_id = v_transfer.from_branch_id
       AND product_id = v_item.product_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Missing source stock for one or more products';
    END IF;

    IF v_source.quantity_reserved < v_item.quantity_sent THEN
      RAISE EXCEPTION 'Reserved stock is lower than the transfer quantity';
    END IF;

    UPDATE branch_stock
       SET quantity_reserved = quantity_reserved - v_item.quantity_sent,
           last_updated_at = now()
     WHERE id = v_source.id;

    INSERT INTO branch_stock (
      branch_id,
      product_id,
      business_id,
      quantity_on_hand,
      quantity_reserved,
      low_stock_threshold
    )
    VALUES (
      v_transfer.to_branch_id,
      v_item.product_id,
      v_business_id,
      v_item.quantity_sent,
      0,
      v_source.low_stock_threshold
    )
    ON CONFLICT (branch_id, product_id)
    DO UPDATE
       SET quantity_on_hand = branch_stock.quantity_on_hand + EXCLUDED.quantity_on_hand,
           last_updated_at = now();

    UPDATE stock_transfer_items
       SET quantity_received = v_item.quantity_sent,
           quantity_discrepancy = 0
     WHERE id = v_item.id;
  END LOOP;

  UPDATE stock_transfers
     SET status = 'received',
         received_by = v_actor_id,
         received_at = now()
   WHERE id = v_transfer.id;

  INSERT INTO audit_logs (
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
    'stock_transfer',
    v_transfer.id,
    'received',
    jsonb_build_object('status', 'in_transit'),
    jsonb_build_object(
      'status',
      'received',
      'from_branch_id',
      v_transfer.from_branch_id,
      'to_branch_id',
      v_transfer.to_branch_id
    )
  );
END;
$$;

CREATE INDEX IF NOT EXISTS idx_payments_business_status_payment_at
  ON payments (business_id, status, payment_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_business_recorded_at
  ON transactions (business_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_business_status_recorded_at
  ON transactions (business_id, status, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_business_action_created_at
  ON audit_logs (business_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_business_entity_created_at
  ON audit_logs (business_id, entity_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_business_actor_created_at
  ON audit_logs (business_id, actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.owner_analytics_summary(
  p_range_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_range_days integer;
  v_start_date date;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_range_days := LEAST(GREATEST(COALESCE(p_range_days, 30), 1), 365);
  v_start_date := CURRENT_DATE - (v_range_days - 1);

  RETURN jsonb_build_object(
    'revenueByDay',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'date',
            to_char(day_value::date, 'YYYY-MM-DD'),
            'total',
            total_amount
          )
          ORDER BY day_value DESC
        )
        FROM (
          SELECT
            day_value,
            COALESCE(SUM(payments.amount), 0) AS total_amount
          FROM generate_series(v_start_date, CURRENT_DATE, interval '1 day') AS days(day_value)
          LEFT JOIN payments
            ON payments.business_id = v_business_id
           AND payments.status = 'verified'
           AND payments.payment_at >= day_value
           AND payments.payment_at < day_value + interval '1 day'
          GROUP BY day_value
        ) AS daily_revenue
      ),
      '[]'::jsonb
    ),
    'revenueByBranch',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'branchName',
            branch_name,
            'total',
            total_amount
          )
          ORDER BY total_amount DESC
        )
        FROM (
          SELECT
            branches.name AS branch_name,
            SUM(payments.amount) AS total_amount
          FROM payments
          JOIN transactions ON transactions.id = payments.transaction_id
          JOIN branches ON branches.id = transactions.branch_id
          WHERE payments.business_id = v_business_id
            AND payments.status = 'verified'
          GROUP BY branches.name
        ) AS branch_revenue
      ),
      '[]'::jsonb
    ),
    'topProducts',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'productName',
            product_name,
            'totalQty',
            total_qty,
            'totalRevenue',
            total_revenue
          )
          ORDER BY total_qty DESC
        )
        FROM (
          SELECT
            products.name AS product_name,
            SUM(transaction_items.quantity)::integer AS total_qty,
            SUM(transaction_items.line_total) AS total_revenue
          FROM transaction_items
          JOIN products ON products.id = transaction_items.product_id
          WHERE transaction_items.business_id = v_business_id
          GROUP BY products.name
          ORDER BY total_qty DESC
          LIMIT 5
        ) AS product_sales
      ),
      '[]'::jsonb
    ),
    'paymentMethods',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'method',
            method,
            'count',
            payment_count,
            'total',
            total_amount
          )
          ORDER BY total_amount DESC
        )
        FROM (
          SELECT
            COALESCE(payments.payment_method, 'Unknown') AS method,
            COUNT(*)::integer AS payment_count,
            SUM(payments.amount) AS total_amount
          FROM payments
          WHERE payments.business_id = v_business_id
          GROUP BY payments.payment_method
        ) AS payment_method_totals
      ),
      '[]'::jsonb
    ),
    'transactionCount',
    (
      SELECT COUNT(*)::integer
      FROM transactions
      WHERE transactions.business_id = v_business_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_audit_filter_options()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'actions',
    COALESCE(
      (
        SELECT jsonb_agg(action ORDER BY action)
        FROM (
          SELECT DISTINCT action
          FROM audit_logs
          WHERE business_id = v_business_id
        ) AS action_options
      ),
      '[]'::jsonb
    ),
    'entityTypes',
    COALESCE(
      (
        SELECT jsonb_agg(entity_type ORDER BY entity_type)
        FROM (
          SELECT DISTINCT entity_type
          FROM audit_logs
          WHERE business_id = v_business_id
        ) AS entity_options
      ),
      '[]'::jsonb
    ),
    'actorCount',
    (
      SELECT COUNT(DISTINCT actor_id)::integer
      FROM audit_logs
      WHERE business_id = v_business_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_transaction_metrics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_today_start timestamptz;
  v_week_start timestamptz;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_today_start := date_trunc('day', now());
  v_week_start := date_trunc('week', now());

  RETURN jsonb_build_object(
    'totalToday',
    COALESCE(
      (
        SELECT SUM(total_amount)
        FROM transactions
        WHERE business_id = v_business_id
          AND recorded_at >= v_today_start
      ),
      0
    ),
    'totalThisWeek',
    COALESCE(
      (
        SELECT SUM(total_amount)
        FROM transactions
        WHERE business_id = v_business_id
          AND recorded_at >= v_week_start
      ),
      0
    ),
    'pendingVerifications',
    (
      SELECT COUNT(*)::integer
      FROM payments
      WHERE business_id = v_business_id
        AND status = 'pending_verify'
    ),
    'rejectedCount',
    (
      SELECT COUNT(*)::integer
      FROM transactions
      WHERE business_id = v_business_id
        AND status = 'rejected'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_branch_transaction_counts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'branchId',
          branch_id,
          'count',
          transaction_count
        )
      )
      FROM (
        SELECT branch_id, COUNT(*)::integer AS transaction_count
        FROM transactions
        WHERE business_id = v_business_id
          AND branch_id IS NOT NULL
        GROUP BY branch_id
      ) AS branch_counts
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_employee_transaction_counts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'employeeId',
          employee_id,
          'count',
          transaction_count
        )
      )
      FROM (
        SELECT employee_id, COUNT(*)::integer AS transaction_count
        FROM transactions
        WHERE business_id = v_business_id
          AND employee_id IS NOT NULL
        GROUP BY employee_id
      ) AS employee_counts
    ),
    '[]'::jsonb
  );
END;
$$;
