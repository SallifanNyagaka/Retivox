/*
 * Supplier delivery expense breakdown for Retivox.
 *
 * Each stock intake line can carry multiple cost components, for example:
 * stock expense, transport, packaging, loading fees. The total of those
 * components becomes the per-receiving-UOM cost used by profit tracking.
 */

CREATE TABLE IF NOT EXISTS public.supplier_delivery_item_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_item_id uuid NOT NULL REFERENCES public.supplier_delivery_items(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_delivery_item_costs_amount_positive CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_supplier_delivery_item_costs_item
  ON public.supplier_delivery_item_costs (delivery_item_id);

CREATE INDEX IF NOT EXISTS idx_supplier_delivery_item_costs_business
  ON public.supplier_delivery_item_costs (business_id, description);

ALTER TABLE public.supplier_delivery_item_costs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'supplier_delivery_item_costs'
       AND policyname = 'supplier_delivery_item_costs_select'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "supplier_delivery_item_costs_select" ON public.supplier_delivery_item_costs
      FOR SELECT
      USING (business_id = public.get_my_business_id())
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'supplier_delivery_item_costs'
       AND policyname = 'supplier_delivery_item_costs_insert'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "supplier_delivery_item_costs_insert" ON public.supplier_delivery_item_costs
      FOR INSERT
      WITH CHECK (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() IN ('owner', 'admin')
      )
    $policy$;
  END IF;
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
  v_cost record;
  v_uom_id uuid;
  v_uom public.units_of_measure%ROWTYPE;
  v_base_quantity numeric(12,4);
  v_legacy_quantity integer;
  v_costs_total numeric(12,2);
  v_unit_cost_total numeric(12,2);
  v_base_unit_cost numeric(12,4);
  v_total_cost numeric(12,2);
  v_delivery_item_id uuid;
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
      item_value AS item_json,
      (item_value->>'productId')::uuid AS product_id,
      COALESCE(NULLIF(item_value->>'uomId', '')::uuid, public.get_product_default_purchase_uom_id(v_business_id, (item_value->>'productId')::uuid)) AS uom_id,
      (item_value->>'quantity')::numeric AS quantity_in_uom,
      NULLIF(item_value->>'unitCost', '')::numeric AS unit_cost,
      NULLIF(item_value->>'notes', '') AS notes
    FROM jsonb_array_elements(p_items) AS item_value
  LOOP
    IF v_item.product_id IS NULL OR v_item.uom_id IS NULL OR v_item.quantity_in_uom IS NULL OR v_item.quantity_in_uom <= 0 THEN
      RAISE EXCEPTION 'Quantity must be greater than zero';
    END IF;

    SELECT COALESCE(SUM((cost_value->>'amount')::numeric), 0)
      INTO v_costs_total
      FROM jsonb_array_elements(COALESCE(v_item.item_json->'costs', '[]'::jsonb)) AS cost_value
     WHERE NULLIF(cost_value->>'description', '') IS NOT NULL
       AND NULLIF(cost_value->>'amount', '') IS NOT NULL
       AND (cost_value->>'amount')::numeric > 0;

    v_unit_cost_total := CASE
      WHEN COALESCE(v_costs_total, 0) > 0 THEN v_costs_total
      ELSE COALESCE(v_item.unit_cost, 0)
    END;

    IF v_unit_cost_total < 0 THEN
      RAISE EXCEPTION 'Cost cannot be negative';
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
    v_base_unit_cost := CASE
      WHEN v_unit_cost_total > 0
      THEN round(v_unit_cost_total / v_base_quantity, 4)
      ELSE NULL
    END;
    v_total_cost := CASE
      WHEN v_unit_cost_total > 0
      THEN round(v_unit_cost_total, 2)
      ELSE NULL
    END;

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
      base_quantity_received,
      base_unit_cost,
      total_cost
    )
    VALUES (
      v_delivery_id,
      v_item.product_id,
      v_business_id,
      v_legacy_quantity,
      CASE WHEN v_delivery_status = 'received' THEN v_legacy_quantity ELSE 0 END,
      CASE WHEN v_delivery_status = 'received' THEN 0 ELSE v_legacy_quantity END,
      NULLIF(round(v_unit_cost_total / v_item.quantity_in_uom, 2), 0),
      v_item.notes,
      v_uom_id,
      v_item.quantity_in_uom,
      v_base_quantity,
      CASE WHEN v_delivery_status = 'received' THEN v_base_quantity ELSE 0 END,
      v_base_unit_cost,
      v_total_cost
    )
    RETURNING id INTO v_delivery_item_id;

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
        v_delivery_item_id,
        v_business_id,
        v_cost.description,
        round(v_cost.amount, 2)
      );
    END LOOP;
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
      'quantity_mode', 'uom_to_base',
      'cost_mode', 'expense_breakdown'
    )
  );

  RETURN v_delivery_id;
END;
$$;
