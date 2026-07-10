/*
 * Stock delivery approval workflow for Retivox.
 *
 * This migration aligns product availability with the intended workflow:
 * - admins request stock deliveries for branches they manage
 * - owners approve admin-requested deliveries
 * - admins acknowledge approved deliveries when stock physically arrives
 * - owners can record received stock directly without approval
 *
 * When stock becomes received, the branch stock level increases and an approved
 * branch selling price is created from the owner-set base price if one is
 * missing. This makes the product available to employees for transactions.
 */

ALTER TABLE public.supplier_deliveries
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

CREATE OR REPLACE FUNCTION public.ensure_approved_branch_price(
  p_business_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_price numeric(10,2);
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.branch_product_prices
     WHERE business_id = p_business_id
       AND branch_id = p_branch_id
       AND product_id = p_product_id
       AND status = 'approved'
  ) THEN
    RETURN;
  END IF;

  SELECT product_pricing.base_price
    INTO v_base_price
    FROM public.product_pricing
   WHERE product_pricing.business_id = p_business_id
     AND product_pricing.product_id = p_product_id
   ORDER BY product_pricing.effective_from DESC
   LIMIT 1;

  IF v_base_price IS NULL THEN
    RAISE EXCEPTION 'Product needs owner pricing before it can be stocked';
  END IF;

  INSERT INTO public.branch_product_prices (
    product_id,
    branch_id,
    business_id,
    selling_price,
    status,
    requested_by,
    approved_by,
    requested_at,
    approved_at
  )
  VALUES (
    p_product_id,
    p_branch_id,
    p_business_id,
    v_base_price,
    'approved',
    p_actor_id,
    p_actor_id,
    now(),
    now()
  )
  ON CONFLICT (product_id, branch_id)
  DO UPDATE
     SET selling_price = EXCLUDED.selling_price,
         status = 'approved',
         approved_by = EXCLUDED.approved_by,
         approved_at = EXCLUDED.approved_at
   WHERE public.branch_product_prices.status <> 'approved';
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
      COALESCE(supplier_delivery_items.quantity_expected, supplier_delivery_items.quantity_received, 0)::integer AS quantity
    FROM public.supplier_delivery_items
    WHERE supplier_delivery_items.delivery_id = p_delivery_id
      AND supplier_delivery_items.business_id = v_delivery.business_id
  LOOP
    IF v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Delivery item quantity must be greater than zero';
    END IF;

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
      low_stock_threshold
    )
    VALUES (
      v_delivery.to_branch_id,
      v_item.product_id,
      v_delivery.business_id,
      v_item.quantity,
      0,
      10
    )
    ON CONFLICT (branch_id, product_id)
    DO UPDATE
       SET quantity_on_hand = public.branch_stock.quantity_on_hand + EXCLUDED.quantity_on_hand,
           last_updated_at = now();

    UPDATE public.supplier_delivery_items
       SET quantity_received = v_item.quantity,
           quantity_discrepancy = 0
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
      SUM((item_value->>'quantity')::integer)::integer AS quantity,
      MAX(NULLIF(item_value->>'unitCost', '')::numeric) AS unit_cost,
      MAX(NULLIF(item_value->>'notes', '')) AS notes
    FROM jsonb_array_elements(p_items) AS item_value
    GROUP BY (item_value->>'productId')::uuid
  LOOP
    IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
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

    INSERT INTO public.supplier_delivery_items (
      delivery_id,
      product_id,
      business_id,
      quantity_expected,
      quantity_received,
      quantity_discrepancy,
      unit_cost,
      notes
    )
    VALUES (
      v_delivery_id,
      v_item.product_id,
      v_business_id,
      v_item.quantity,
      CASE WHEN v_delivery_status = 'received' THEN v_item.quantity ELSE 0 END,
      CASE WHEN v_delivery_status = 'received' THEN 0 ELSE v_item.quantity END,
      v_item.unit_cost,
      v_item.notes
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
      'item_count', jsonb_array_length(p_items)
    )
  );

  RETURN v_delivery_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_approve_supplier_delivery(p_delivery_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_delivery public.supplier_deliveries%ROWTYPE;
  v_item record;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
    INTO v_delivery
    FROM public.supplier_deliveries
   WHERE id = p_delivery_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery not found';
  END IF;

  IF v_delivery.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Only pending deliveries can be approved';
  END IF;

  FOR v_item IN
    SELECT supplier_delivery_items.product_id
      FROM public.supplier_delivery_items
     WHERE supplier_delivery_items.delivery_id = p_delivery_id
       AND supplier_delivery_items.business_id = v_business_id
  LOOP
    PERFORM public.ensure_approved_branch_price(
      v_business_id,
      v_delivery.to_branch_id,
      v_item.product_id,
      v_actor_id
    );
  END LOOP;

  UPDATE public.supplier_deliveries
     SET status = 'approved',
         approved_by = v_actor_id,
         approved_at = now()
   WHERE id = p_delivery_id;

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
    p_delivery_id,
    'approved',
    jsonb_build_object('status', v_delivery.status),
    jsonb_build_object('status', 'approved', 'branch_id', v_delivery.to_branch_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_acknowledge_supplier_delivery(p_delivery_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_effective_role text;
  v_delivery public.supplier_deliveries%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
    INTO v_delivery
    FROM public.supplier_deliveries
   WHERE id = p_delivery_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery not found';
  END IF;

  v_effective_role := public.get_effective_branch_role(v_actor_id, v_delivery.to_branch_id);

  IF public.branch_role_rank(v_effective_role) < public.branch_role_rank('admin') THEN
    PERFORM public.log_branch_access_denial(
      v_actor_id,
      v_delivery.to_branch_id,
      'admin',
      v_effective_role,
      'dashboard_acknowledge_supplier_delivery'
    );
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_delivery.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved deliveries can be acknowledged';
  END IF;

  PERFORM public.apply_supplier_delivery_stock(p_delivery_id, v_actor_id);

  UPDATE public.supplier_deliveries
     SET status = 'received',
         acknowledged_by = v_actor_id,
         acknowledged_at = now(),
         delivered_at = now()
   WHERE id = p_delivery_id;

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
    p_delivery_id,
    'received',
    jsonb_build_object('status', v_delivery.status),
    jsonb_build_object(
      'status', 'received',
      'branch_id', v_delivery.to_branch_id,
      'effective_role', v_effective_role
    )
  );
END;
$$;

/*
 * Backfill approved branch prices for existing stock rows that were created
 * before this workflow existed. This makes already-stocked products visible to
 * employees when the owner has defined a base product price, without changing
 * any branch price row that already exists.
 */
INSERT INTO public.branch_product_prices (
  product_id,
  branch_id,
  business_id,
  selling_price,
  status,
  requested_by,
  approved_by,
  requested_at,
  approved_at
)
SELECT
  branch_stock.product_id,
  branch_stock.branch_id,
  branch_stock.business_id,
  latest_price.base_price,
  'approved',
  latest_price.set_by,
  latest_price.set_by,
  now(),
  now()
FROM public.branch_stock
JOIN public.products
  ON products.id = branch_stock.product_id
 AND products.business_id = branch_stock.business_id
 AND products.is_active = true
 AND products.deleted_at IS NULL
JOIN LATERAL (
  SELECT product_pricing.base_price, product_pricing.set_by
    FROM public.product_pricing
   WHERE product_pricing.business_id = branch_stock.business_id
     AND product_pricing.product_id = branch_stock.product_id
   ORDER BY product_pricing.effective_from DESC
   LIMIT 1
) AS latest_price ON true
WHERE branch_stock.quantity_on_hand > 0
  AND NOT EXISTS (
    SELECT 1
      FROM public.branch_product_prices
     WHERE branch_product_prices.product_id = branch_stock.product_id
       AND branch_product_prices.branch_id = branch_stock.branch_id
  );

CREATE INDEX IF NOT EXISTS idx_supplier_deliveries_business_status_branch_recorded_at
  ON public.supplier_deliveries (business_id, status, to_branch_id, recorded_at DESC);
