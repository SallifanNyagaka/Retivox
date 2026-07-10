/*
 * Supplier delivery edit workflow for Retivox.
 *
 * Stock is corrected by editing the supplier delivery that introduced it, not
 * by directly editing branch_stock. Owner edits apply immediately. Admin edits
 * create approval requests and only affect deliveries/stock after owner review.
 */

DROP FUNCTION IF EXISTS public.dashboard_review_stock_edit_request(uuid, text);
DROP FUNCTION IF EXISTS public.dashboard_request_stock_edit(uuid, numeric, numeric, integer, numeric, text);
DROP TABLE IF EXISTS public.stock_edit_requests;

CREATE TABLE IF NOT EXISTS public.supplier_delivery_edit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  delivery_id uuid NOT NULL REFERENCES public.supplier_deliveries(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  reviewed_by uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'pending_approval',
  old_value jsonb NOT NULL,
  new_value jsonb NOT NULL,
  reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT supplier_delivery_edit_requests_status_valid CHECK (status IN ('pending_approval', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_supplier_delivery_edit_requests_business_status
  ON public.supplier_delivery_edit_requests (business_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_delivery_edit_requests_delivery_status
  ON public.supplier_delivery_edit_requests (delivery_id, status);

ALTER TABLE public.supplier_delivery_edit_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'supplier_delivery_edit_requests'
       AND policyname = 'supplier_delivery_edit_requests_select'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "supplier_delivery_edit_requests_select" ON public.supplier_delivery_edit_requests
      FOR SELECT
      USING (business_id = public.get_my_business_id())
    $policy$;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_supplier_delivery(p_delivery_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'delivery', to_jsonb(supplier_deliveries),
    'items', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'item', to_jsonb(supplier_delivery_items),
            'costs', COALESCE(
              (
                SELECT jsonb_agg(to_jsonb(supplier_delivery_item_costs) ORDER BY supplier_delivery_item_costs.created_at)
                  FROM public.supplier_delivery_item_costs
                 WHERE supplier_delivery_item_costs.delivery_item_id = supplier_delivery_items.id
              ),
              '[]'::jsonb
            )
          )
          ORDER BY supplier_delivery_items.id
        )
        FROM public.supplier_delivery_items
        WHERE supplier_delivery_items.delivery_id = supplier_deliveries.id
      ),
      '[]'::jsonb
    )
  )
  FROM public.supplier_deliveries
  WHERE supplier_deliveries.id = p_delivery_id;
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
      SUM(COALESCE(supplier_delivery_items.total_cost, 0)) AS total_cost,
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

CREATE OR REPLACE FUNCTION public.apply_supplier_delivery_edit(
  p_delivery_id uuid,
  p_supplier_name text,
  p_reference_code text,
  p_items jsonb,
  p_actor_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery public.supplier_deliveries%ROWTYPE;
  v_item record;
  v_cost record;
  v_delivery_item public.supplier_delivery_items%ROWTYPE;
  v_uom public.units_of_measure%ROWTYPE;
  v_base_quantity numeric(12,4);
  v_old_received_base_quantity numeric(12,4);
  v_new_received_base_quantity numeric(12,4);
  v_delta numeric(12,4);
  v_legacy_quantity integer;
  v_costs_total numeric(12,2);
  v_unit_cost_total numeric(12,2);
  v_base_unit_cost numeric(12,4);
  v_total_cost numeric(12,2);
  v_stock public.branch_stock%ROWTYPE;
BEGIN
  IF NULLIF(trim(p_supplier_name), '') IS NULL THEN
    RAISE EXCEPTION 'Supplier name is required';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keep at least one delivery item';
  END IF;

  SELECT *
    INTO v_delivery
    FROM public.supplier_deliveries
   WHERE id = p_delivery_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery not found';
  END IF;

  UPDATE public.supplier_deliveries
     SET supplier_name = trim(p_supplier_name),
         reference_code = NULLIF(trim(COALESCE(p_reference_code, '')), '')
   WHERE id = v_delivery.id;

  FOR v_item IN
    SELECT
      item_value AS item_json,
      (item_value->>'deliveryItemId')::uuid AS delivery_item_id,
      (item_value->>'productId')::uuid AS product_id,
      COALESCE(NULLIF(item_value->>'uomId', '')::uuid, public.get_product_default_purchase_uom_id(v_delivery.business_id, (item_value->>'productId')::uuid)) AS uom_id,
      (item_value->>'quantity')::numeric AS quantity_in_uom,
      NULLIF(item_value->>'unitCost', '')::numeric AS unit_cost,
      NULLIF(item_value->>'notes', '') AS notes
    FROM jsonb_array_elements(p_items) AS item_value
  LOOP
    IF v_item.delivery_item_id IS NULL
       OR v_item.product_id IS NULL
       OR v_item.uom_id IS NULL
       OR v_item.quantity_in_uom IS NULL
       OR v_item.quantity_in_uom <= 0 THEN
      RAISE EXCEPTION 'Delivery item quantity must be greater than zero';
    END IF;

    SELECT *
      INTO v_delivery_item
      FROM public.supplier_delivery_items
     WHERE id = v_item.delivery_item_id
       AND delivery_id = v_delivery.id
       AND business_id = v_delivery.business_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Delivery item not found';
    END IF;

    IF v_delivery_item.product_id <> v_item.product_id THEN
      RAISE EXCEPTION 'Changing the product on a delivery item is not supported. Add a new delivery instead.';
    END IF;

    v_uom := public.assert_product_uom_link(v_delivery.business_id, v_item.product_id, v_item.uom_id);

    IF NOT EXISTS (
      SELECT 1
        FROM public.product_uom_links
       WHERE business_id = v_delivery.business_id
         AND product_id = v_item.product_id
         AND uom_id = v_item.uom_id
         AND is_purchase_uom = true
    ) THEN
      RAISE EXCEPTION 'Selected unit is not available for stock receiving';
    END IF;

    SELECT COALESCE(SUM((cost_value->>'amount')::numeric), 0)
      INTO v_costs_total
      FROM jsonb_array_elements(COALESCE(v_item.item_json->'costs', '[]'::jsonb)) AS cost_value
     WHERE NULLIF(trim(cost_value->>'description'), '') IS NOT NULL
       AND NULLIF(cost_value->>'amount', '') IS NOT NULL
       AND (cost_value->>'amount')::numeric > 0;

    v_unit_cost_total := CASE
      WHEN COALESCE(v_costs_total, 0) > 0 THEN v_costs_total
      ELSE COALESCE(v_item.unit_cost, 0)
    END;

    IF v_unit_cost_total < 0 THEN
      RAISE EXCEPTION 'Cost cannot be negative';
    END IF;

    v_base_quantity := round(v_item.quantity_in_uom * v_uom.conversion_factor, 4);

    IF v_base_quantity <= 0 OR v_base_quantity <> floor(v_base_quantity) THEN
      RAISE EXCEPTION 'Delivery quantity must convert to a whole base unit';
    END IF;

    v_legacy_quantity := floor(v_base_quantity)::integer;
    v_base_unit_cost := CASE
      WHEN v_unit_cost_total > 0 THEN round(v_unit_cost_total / v_base_quantity, 4)
      ELSE NULL
    END;
    v_total_cost := CASE
      WHEN v_unit_cost_total > 0 THEN round(v_unit_cost_total, 2)
      ELSE NULL
    END;
    v_old_received_base_quantity := COALESCE(NULLIF(v_delivery_item.base_quantity_received, 0), v_delivery_item.quantity_received, 0);
    v_new_received_base_quantity := CASE WHEN v_delivery.status = 'received' THEN v_base_quantity ELSE 0 END;
    v_delta := v_new_received_base_quantity - v_old_received_base_quantity;

    IF v_delivery.status = 'received' AND v_delta <> 0 THEN
      SELECT *
        INTO v_stock
        FROM public.branch_stock
       WHERE business_id = v_delivery.business_id
         AND branch_id = v_delivery.to_branch_id
         AND product_id = v_item.product_id
       FOR UPDATE;

      IF NOT FOUND AND v_delta < 0 THEN
        RAISE EXCEPTION 'Cannot reduce stock for a missing branch stock row';
      END IF;

      IF FOUND AND (v_stock.base_quantity_on_hand + v_delta) < COALESCE(v_stock.base_quantity_reserved, 0) THEN
        RAISE EXCEPTION 'Cannot reduce stock below reserved quantity';
      END IF;

      IF FOUND THEN
        UPDATE public.branch_stock
           SET base_quantity_on_hand = round(base_quantity_on_hand + v_delta, 4),
               quantity_on_hand = floor(base_quantity_on_hand + v_delta)::integer,
               last_updated_at = now()
         WHERE id = v_stock.id;
      ELSE
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
          floor(v_delta)::integer,
          0,
          10,
          v_delta,
          0,
          COALESCE(v_base_unit_cost, 0)
        );
      END IF;
    END IF;

    UPDATE public.supplier_delivery_items
       SET uom_id = v_uom.id,
           quantity_in_uom = v_item.quantity_in_uom,
           quantity_expected = v_legacy_quantity,
           quantity_received = CASE WHEN v_delivery.status = 'received' THEN v_legacy_quantity ELSE quantity_received END,
           quantity_discrepancy = CASE WHEN v_delivery.status = 'received' THEN 0 ELSE v_legacy_quantity END,
           unit_cost = NULLIF(round(v_unit_cost_total / v_item.quantity_in_uom, 2), 0),
           notes = v_item.notes,
           base_quantity_expected = v_base_quantity,
           base_quantity_received = CASE WHEN v_delivery.status = 'received' THEN v_base_quantity ELSE base_quantity_received END,
           base_unit_cost = v_base_unit_cost,
           total_cost = v_total_cost
     WHERE id = v_delivery_item.id;

    DELETE FROM public.supplier_delivery_item_costs
     WHERE delivery_item_id = v_delivery_item.id;

    FOR v_cost IN
      SELECT
        NULLIF(trim(cost_value->>'description'), '') AS description,
        (cost_value->>'amount')::numeric AS amount
      FROM jsonb_array_elements(COALESCE(v_item.item_json->'costs', '[]'::jsonb)) AS cost_value
      WHERE NULLIF(trim(cost_value->>'description'), '') IS NOT NULL
        AND NULLIF(cost_value->>'amount', '') IS NOT NULL
        AND (cost_value->>'amount')::numeric > 0
    LOOP
      INSERT INTO public.supplier_delivery_item_costs (
        delivery_item_id,
        business_id,
        description,
        amount
      )
      VALUES (
        v_delivery_item.id,
        v_delivery.business_id,
        v_cost.description,
        round(v_cost.amount, 2)
      );
    END LOOP;

    PERFORM public.recalculate_branch_stock_average_cost(
      v_delivery.business_id,
      v_delivery.to_branch_id,
      v_item.product_id
    );
  END LOOP;

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
    v_delivery.business_id,
    p_actor_id,
    'supplier_delivery',
    v_delivery.id,
    'edited',
    NULL,
    jsonb_build_object(
      'supplier_name', trim(p_supplier_name),
      'reference_code', NULLIF(trim(COALESCE(p_reference_code, '')), ''),
      'reason', NULLIF(trim(COALESCE(p_reason, '')), ''),
      'item_count', jsonb_array_length(p_items)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_request_supplier_delivery_edit(
  p_delivery_id uuid,
  p_supplier_name text,
  p_reference_code text,
  p_items jsonb,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_global_role text;
  v_effective_role text;
  v_delivery public.supplier_deliveries%ROWTYPE;
  v_request_id uuid;
  v_old_value jsonb;
  v_new_value jsonb;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();
  v_global_role := public.get_my_global_role();

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
      'dashboard_request_supplier_delivery_edit'
    );
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_old_value := public.snapshot_supplier_delivery(v_delivery.id);
  v_new_value := jsonb_build_object(
    'supplierName', trim(p_supplier_name),
    'referenceCode', NULLIF(trim(COALESCE(p_reference_code, '')), ''),
    'items', p_items
  );

  IF v_global_role = 'owner' THEN
    PERFORM public.apply_supplier_delivery_edit(
      v_delivery.id,
      p_supplier_name,
      p_reference_code,
      p_items,
      v_actor_id,
      p_reason
    );
    RETURN v_delivery.id;
  END IF;

  INSERT INTO public.supplier_delivery_edit_requests (
    business_id,
    delivery_id,
    branch_id,
    requested_by,
    old_value,
    new_value,
    reason
  )
  VALUES (
    v_business_id,
    v_delivery.id,
    v_delivery.to_branch_id,
    v_actor_id,
    v_old_value,
    v_new_value,
    NULLIF(trim(COALESCE(p_reason, '')), '')
  )
  RETURNING id INTO v_request_id;

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
    'supplier_delivery_edit_request',
    v_request_id,
    'requested',
    v_old_value,
    v_new_value || jsonb_build_object('reason', NULLIF(trim(COALESCE(p_reason, '')), ''))
  );

  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_review_supplier_delivery_edit_request(
  p_request_id uuid,
  p_action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_request public.supplier_delivery_edit_requests%ROWTYPE;
  v_next_status text;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid delivery edit action';
  END IF;

  SELECT *
    INTO v_request
    FROM public.supplier_delivery_edit_requests
   WHERE id = p_request_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery edit request not found';
  END IF;

  IF v_request.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Only pending delivery edit requests can be reviewed';
  END IF;

  v_next_status := CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END;

  IF p_action = 'approve' THEN
    PERFORM public.apply_supplier_delivery_edit(
      v_request.delivery_id,
      v_request.new_value->>'supplierName',
      v_request.new_value->>'referenceCode',
      v_request.new_value->'items',
      v_actor_id,
      v_request.reason
    );
  END IF;

  UPDATE public.supplier_delivery_edit_requests
     SET status = v_next_status,
         reviewed_by = v_actor_id,
         reviewed_at = now()
   WHERE id = v_request.id;

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
    'supplier_delivery_edit_request',
    v_request.id,
    CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
    to_jsonb(v_request),
    jsonb_build_object(
      'delivery_id', v_request.delivery_id,
      'status', v_next_status,
      'applied', p_action = 'approve'
    )
  );
END;
$$;
