/*
 * Supplier directory and rankings for Retivox.
 *
 * Suppliers become first-class business records. Stock intake can select an
 * existing supplier or create/update one, and each delivery stores simple
 * 1-5 supplier ratings used for operational ranking.
 */

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text,
  contact_person text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_name_present CHECK (NULLIF(trim(name), '') IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_business_name_unique
  ON public.suppliers (business_id, lower(trim(name)));

CREATE INDEX IF NOT EXISTS idx_suppliers_business_active
  ON public.suppliers (business_id, is_active, name);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'suppliers'
       AND policyname = 'suppliers_select_business'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "suppliers_select_business" ON public.suppliers
      FOR SELECT
      USING (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() IN ('owner', 'admin')
      )
    $policy$;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS touch_suppliers_updated_at ON public.suppliers;
CREATE TRIGGER touch_suppliers_updated_at
BEFORE UPDATE ON public.suppliers
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.supplier_deliveries
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_reference_number text,
  ADD COLUMN IF NOT EXISTS supplier_price_rating integer,
  ADD COLUMN IF NOT EXISTS supplier_stock_quality_rating integer,
  ADD COLUMN IF NOT EXISTS supplier_availability_rating integer,
  ADD COLUMN IF NOT EXISTS supplier_rating_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supplier_deliveries_price_rating_range'
  ) THEN
    ALTER TABLE public.supplier_deliveries
      ADD CONSTRAINT supplier_deliveries_price_rating_range
      CHECK (supplier_price_rating IS NULL OR supplier_price_rating BETWEEN 1 AND 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supplier_deliveries_quality_rating_range'
  ) THEN
    ALTER TABLE public.supplier_deliveries
      ADD CONSTRAINT supplier_deliveries_quality_rating_range
      CHECK (supplier_stock_quality_rating IS NULL OR supplier_stock_quality_rating BETWEEN 1 AND 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'supplier_deliveries_availability_rating_range'
  ) THEN
    ALTER TABLE public.supplier_deliveries
      ADD CONSTRAINT supplier_deliveries_availability_rating_range
      CHECK (supplier_availability_rating IS NULL OR supplier_availability_rating BETWEEN 1 AND 5);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_supplier_deliveries_supplier
  ON public.supplier_deliveries (business_id, supplier_id, recorded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_deliveries_supplier_reference
  ON public.supplier_deliveries (business_id, supplier_reference_number)
  WHERE supplier_reference_number IS NOT NULL;

WITH distinct_supplier_names AS (
  SELECT DISTINCT
    supplier_deliveries.business_id,
    trim(supplier_deliveries.supplier_name) AS supplier_name
  FROM public.supplier_deliveries
  WHERE NULLIF(trim(supplier_deliveries.supplier_name), '') IS NOT NULL
),
inserted_suppliers AS (
  INSERT INTO public.suppliers (business_id, name)
  SELECT distinct_supplier_names.business_id, distinct_supplier_names.supplier_name
    FROM distinct_supplier_names
  ON CONFLICT (business_id, lower(trim(name))) DO NOTHING
  RETURNING id, business_id, name
)
UPDATE public.supplier_deliveries
   SET supplier_id = suppliers.id
  FROM public.suppliers
 WHERE supplier_deliveries.supplier_id IS NULL
   AND suppliers.business_id = supplier_deliveries.business_id
   AND lower(trim(suppliers.name)) = lower(trim(supplier_deliveries.supplier_name));

CREATE OR REPLACE FUNCTION public.slugify_supplier_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' FROM regexp_replace(lower(trim(COALESCE(p_name, 'supplier'))), '[^a-z0-9]+', '-', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.upsert_business_supplier(
  p_supplier_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_contact_person text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_supplier_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NULLIF(trim(COALESCE(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Supplier name is required';
  END IF;

  IF p_supplier_id IS NOT NULL THEN
    UPDATE public.suppliers
       SET name = trim(p_name),
           phone = NULLIF(trim(COALESCE(p_phone, '')), ''),
           email = NULLIF(trim(COALESCE(p_email, '')), ''),
           contact_person = NULLIF(trim(COALESCE(p_contact_person, '')), ''),
           notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
           is_active = COALESCE(p_is_active, true),
           updated_by = v_actor_id
     WHERE id = p_supplier_id
       AND business_id = v_business_id
     RETURNING id INTO v_supplier_id;

    IF v_supplier_id IS NULL THEN
      RAISE EXCEPTION 'Supplier not found';
    END IF;
  ELSE
    INSERT INTO public.suppliers (
      business_id,
      name,
      phone,
      email,
      contact_person,
      notes,
      is_active,
      created_by,
      updated_by
    )
    VALUES (
      v_business_id,
      trim(p_name),
      NULLIF(trim(COALESCE(p_phone, '')), ''),
      NULLIF(trim(COALESCE(p_email, '')), ''),
      NULLIF(trim(COALESCE(p_contact_person, '')), ''),
      NULLIF(trim(COALESCE(p_notes, '')), ''),
      COALESCE(p_is_active, true),
      v_actor_id,
      v_actor_id
    )
    ON CONFLICT (business_id, lower(trim(name)))
    DO UPDATE SET
      phone = COALESCE(NULLIF(trim(COALESCE(EXCLUDED.phone, '')), ''), suppliers.phone),
      email = COALESCE(NULLIF(trim(COALESCE(EXCLUDED.email, '')), ''), suppliers.email),
      contact_person = COALESCE(NULLIF(trim(COALESCE(EXCLUDED.contact_person, '')), ''), suppliers.contact_person),
      notes = COALESCE(NULLIF(trim(COALESCE(EXCLUDED.notes, '')), ''), suppliers.notes),
      is_active = true,
      updated_by = v_actor_id
    RETURNING id INTO v_supplier_id;
  END IF;

  RETURN v_supplier_id;
END;
$$;

DROP FUNCTION IF EXISTS public.dashboard_record_supplier_delivery(uuid, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.dashboard_record_supplier_delivery(
  p_branch_id uuid,
  p_supplier_name text,
  p_reference_code text,
  p_items jsonb,
  p_supplier_id uuid DEFAULT NULL,
  p_supplier_phone text DEFAULT NULL,
  p_supplier_email text DEFAULT NULL,
  p_supplier_contact_person text DEFAULT NULL,
  p_supplier_notes text DEFAULT NULL,
  p_price_rating integer DEFAULT NULL,
  p_stock_quality_rating integer DEFAULT NULL,
  p_availability_rating integer DEFAULT NULL,
  p_rating_note text DEFAULT NULL
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
  v_supplier_id uuid;
  v_supplier_name text;
  v_supplier_supply_count integer;
  v_supplier_reference_number text;
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

  IF p_price_rating IS NOT NULL AND (p_price_rating < 1 OR p_price_rating > 5) THEN
    RAISE EXCEPTION 'Price rating must be between 1 and 5';
  END IF;

  IF p_stock_quality_rating IS NOT NULL AND (p_stock_quality_rating < 1 OR p_stock_quality_rating > 5) THEN
    RAISE EXCEPTION 'Stock quality rating must be between 1 and 5';
  END IF;

  IF p_availability_rating IS NOT NULL AND (p_availability_rating < 1 OR p_availability_rating > 5) THEN
    RAISE EXCEPTION 'Availability rating must be between 1 and 5';
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

  v_supplier_id := public.upsert_business_supplier(
    p_supplier_id,
    p_supplier_name,
    p_supplier_phone,
    p_supplier_email,
    p_supplier_contact_person,
    p_supplier_notes,
    true
  );

  SELECT suppliers.name
    INTO v_supplier_name
    FROM public.suppliers
   WHERE suppliers.id = v_supplier_id
     AND suppliers.business_id = v_business_id;

  SELECT COUNT(*) + 1
    INTO v_supplier_supply_count
    FROM public.supplier_deliveries
   WHERE supplier_deliveries.business_id = v_business_id
     AND supplier_deliveries.supplier_id = v_supplier_id;

  v_supplier_reference_number := CONCAT(
    COALESCE(NULLIF(public.slugify_supplier_name(v_supplier_name), ''), 'supplier'),
    '_',
    to_char(now(), 'YYYYMMDDHH24MISS'),
    '_',
    v_supplier_supply_count
  );

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
    supplier_id,
    reference_code,
    supplier_reference_number,
    supplier_price_rating,
    supplier_stock_quality_rating,
    supplier_availability_rating,
    supplier_rating_note,
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
    v_supplier_name,
    v_supplier_id,
    COALESCE(NULLIF(trim(p_reference_code), ''), v_supplier_reference_number),
    v_supplier_reference_number,
    p_price_rating,
    p_stock_quality_rating,
    p_availability_rating,
    NULLIF(trim(COALESCE(p_rating_note, '')), ''),
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
      'supplier_id', v_supplier_id,
      'supplier_name', v_supplier_name,
      'reference_code', COALESCE(NULLIF(trim(p_reference_code), ''), v_supplier_reference_number),
      'supplier_reference_number', v_supplier_reference_number,
      'item_count', jsonb_array_length(p_items),
      'quantity_mode', 'uom_to_base',
      'cost_mode', 'expense_breakdown',
      'supplier_ratings', jsonb_build_object(
        'price', p_price_rating,
        'stock_quality', p_stock_quality_rating,
        'availability', p_availability_rating
      )
    )
  );

  RETURN v_delivery_id;
END;
$$;
