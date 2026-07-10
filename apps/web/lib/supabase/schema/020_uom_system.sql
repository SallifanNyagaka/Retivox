/*
 * Unit of Measure system for Retivox.
 *
 * This additive migration introduces structured, tenant-scoped UOM records and
 * product-to-UOM links while preserving the legacy products.unit and integer
 * branch_stock quantity columns. No existing table is dropped or recreated.
 */

CREATE TABLE IF NOT EXISTS public.units_of_measure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  abbreviation text NOT NULL,
  conversion_factor numeric(10,4) NOT NULL DEFAULT 1,
  is_base_unit boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT units_of_measure_business_name_unique UNIQUE (business_id, name),
  CONSTRAINT units_of_measure_conversion_factor_positive CHECK (conversion_factor > 0)
);

CREATE TABLE IF NOT EXISTS public.product_uom_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  uom_id uuid NOT NULL REFERENCES public.units_of_measure(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  is_base_uom boolean NOT NULL DEFAULT false,
  is_default_purchase_uom boolean NOT NULL DEFAULT false,
  is_default_sale_uom boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_uom_links_product_uom_unique UNIQUE (product_id, uom_id)
);

ALTER TABLE public.branch_stock
  ADD COLUMN IF NOT EXISTS base_quantity_on_hand numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_quantity_reserved numeric(12,4) NOT NULL DEFAULT 0;

ALTER TABLE public.supplier_delivery_items
  ADD COLUMN IF NOT EXISTS uom_id uuid REFERENCES public.units_of_measure(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS quantity_in_uom numeric(12,4),
  ADD COLUMN IF NOT EXISTS base_quantity_expected numeric(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_quantity_received numeric(12,4) NOT NULL DEFAULT 0;

UPDATE public.branch_stock
   SET base_quantity_on_hand = quantity_on_hand
 WHERE base_quantity_on_hand = 0
   AND quantity_on_hand <> 0;

UPDATE public.branch_stock
   SET base_quantity_reserved = quantity_reserved
 WHERE base_quantity_reserved = 0
   AND quantity_reserved <> 0;

UPDATE public.supplier_delivery_items
   SET base_quantity_expected = COALESCE(quantity_expected, quantity_received, 0),
       base_quantity_received = quantity_received
 WHERE base_quantity_expected = 0
   AND base_quantity_received = 0
   AND COALESCE(quantity_expected, quantity_received, 0) <> 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'branch_stock_base_quantity_on_hand_nonnegative'
       AND conrelid = 'public.branch_stock'::regclass
  ) THEN
    ALTER TABLE public.branch_stock
      ADD CONSTRAINT branch_stock_base_quantity_on_hand_nonnegative CHECK (base_quantity_on_hand >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'branch_stock_base_quantity_reserved_nonnegative'
       AND conrelid = 'public.branch_stock'::regclass
  ) THEN
    ALTER TABLE public.branch_stock
      ADD CONSTRAINT branch_stock_base_quantity_reserved_nonnegative CHECK (base_quantity_reserved >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'supplier_delivery_items_base_quantity_expected_nonnegative'
       AND conrelid = 'public.supplier_delivery_items'::regclass
  ) THEN
    ALTER TABLE public.supplier_delivery_items
      ADD CONSTRAINT supplier_delivery_items_base_quantity_expected_nonnegative CHECK (base_quantity_expected >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'supplier_delivery_items_base_quantity_received_nonnegative'
       AND conrelid = 'public.supplier_delivery_items'::regclass
  ) THEN
    ALTER TABLE public.supplier_delivery_items
      ADD CONSTRAINT supplier_delivery_items_base_quantity_received_nonnegative CHECK (base_quantity_received >= 0);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_uom_links_one_base_per_product
  ON public.product_uom_links (product_id)
  WHERE is_base_uom = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_uom_links_default_purchase_per_product
  ON public.product_uom_links (product_id)
  WHERE is_default_purchase_uom = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_uom_links_default_sale_per_product
  ON public.product_uom_links (product_id)
  WHERE is_default_sale_uom = true;

CREATE INDEX IF NOT EXISTS idx_units_of_measure_business_active_factor
  ON public.units_of_measure (business_id, is_active, conversion_factor);

CREATE INDEX IF NOT EXISTS idx_product_uom_links_business_product
  ON public.product_uom_links (business_id, product_id);

CREATE INDEX IF NOT EXISTS idx_product_uom_links_business_uom
  ON public.product_uom_links (business_id, uom_id);

CREATE INDEX IF NOT EXISTS idx_branch_stock_business_base_quantity
  ON public.branch_stock (business_id, branch_id, product_id, base_quantity_on_hand);

ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_uom_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'units_of_measure'
       AND policyname = 'units_of_measure_select'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "units_of_measure_select" ON public.units_of_measure
      FOR SELECT
      USING (business_id = public.get_my_business_id())
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'units_of_measure'
       AND policyname = 'units_of_measure_insert'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "units_of_measure_insert" ON public.units_of_measure
      FOR INSERT
      WITH CHECK (
        business_id = public.get_my_business_id()
        AND created_by = auth.uid()
        AND public.get_my_global_role() IN ('owner', 'admin')
      )
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'units_of_measure'
       AND policyname = 'units_of_measure_update'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "units_of_measure_update" ON public.units_of_measure
      FOR UPDATE
      USING (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() IN ('owner', 'admin')
      )
      WITH CHECK (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() IN ('owner', 'admin')
      )
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'units_of_measure'
       AND policyname = 'units_of_measure_delete'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "units_of_measure_delete" ON public.units_of_measure
      FOR DELETE
      USING (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() = 'owner'
      )
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'product_uom_links'
       AND policyname = 'product_uom_links_select'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "product_uom_links_select" ON public.product_uom_links
      FOR SELECT
      USING (business_id = public.get_my_business_id())
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'product_uom_links'
       AND policyname = 'product_uom_links_insert'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "product_uom_links_insert" ON public.product_uom_links
      FOR INSERT
      WITH CHECK (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() IN ('owner', 'admin')
      )
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'product_uom_links'
       AND policyname = 'product_uom_links_update'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "product_uom_links_update" ON public.product_uom_links
      FOR UPDATE
      USING (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() IN ('owner', 'admin')
      )
      WITH CHECK (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() IN ('owner', 'admin')
      )
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'product_uom_links'
       AND policyname = 'product_uom_links_delete'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "product_uom_links_delete" ON public.product_uom_links
      FOR DELETE
      USING (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() = 'owner'
      )
    $policy$;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_product_uom_link_business()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_business_id uuid;
  v_uom_business_id uuid;
BEGIN
  SELECT products.business_id
    INTO v_product_business_id
    FROM public.products
   WHERE products.id = NEW.product_id;

  SELECT units_of_measure.business_id
    INTO v_uom_business_id
    FROM public.units_of_measure
   WHERE units_of_measure.id = NEW.uom_id
     AND units_of_measure.is_active = true;

  IF v_product_business_id IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF v_uom_business_id IS NULL THEN
    RAISE EXCEPTION 'Unit of measure not found or inactive';
  END IF;

  IF NEW.business_id <> v_product_business_id OR NEW.business_id <> v_uom_business_id THEN
    RAISE EXCEPTION 'Product and unit of measure must belong to the same business';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_product_uom_link_business_trigger ON public.product_uom_links;
CREATE TRIGGER validate_product_uom_link_business_trigger
BEFORE INSERT OR UPDATE ON public.product_uom_links
FOR EACH ROW
EXECUTE FUNCTION public.validate_product_uom_link_business();

CREATE OR REPLACE FUNCTION public.audit_uom_table_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_entity_id uuid;
  v_action text;
BEGIN
  v_actor_id := auth.uid();

  IF v_actor_id IS NULL AND TG_TABLE_NAME = 'units_of_measure' AND TG_OP = 'INSERT' THEN
    v_actor_id := NEW.created_by;
  END IF;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor required for audited UOM mutation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_business_id := OLD.business_id;
    v_entity_id := OLD.id;
  ELSE
    v_business_id := NEW.business_id;
    v_entity_id := NEW.id;
  END IF;

  v_action := CASE TG_OP
    WHEN 'INSERT' THEN 'created'
    WHEN 'UPDATE' THEN 'updated'
    WHEN 'DELETE' THEN 'deleted'
    ELSE lower(TG_OP)
  END;

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
    TG_TABLE_NAME,
    v_entity_id,
    v_action,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_units_of_measure_mutation_trigger ON public.units_of_measure;
CREATE TRIGGER audit_units_of_measure_mutation_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.units_of_measure
FOR EACH ROW
EXECUTE FUNCTION public.audit_uom_table_mutation();

DROP TRIGGER IF EXISTS audit_product_uom_links_mutation_trigger ON public.product_uom_links;
CREATE TRIGGER audit_product_uom_links_mutation_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.product_uom_links
FOR EACH ROW
EXECUTE FUNCTION public.audit_uom_table_mutation();

CREATE OR REPLACE FUNCTION public.sync_branch_stock_base_quantities()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.base_quantity_on_hand = 0 AND NEW.quantity_on_hand <> 0 THEN
      NEW.base_quantity_on_hand := NEW.quantity_on_hand;
    END IF;

    IF NEW.base_quantity_reserved = 0 AND NEW.quantity_reserved <> 0 THEN
      NEW.base_quantity_reserved := NEW.quantity_reserved;
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.quantity_on_hand IS DISTINCT FROM OLD.quantity_on_hand
     AND NEW.base_quantity_on_hand IS NOT DISTINCT FROM OLD.base_quantity_on_hand THEN
    NEW.base_quantity_on_hand := GREATEST(
      0,
      OLD.base_quantity_on_hand + (NEW.quantity_on_hand - OLD.quantity_on_hand)
    );
  END IF;

  IF NEW.quantity_reserved IS DISTINCT FROM OLD.quantity_reserved
     AND NEW.base_quantity_reserved IS NOT DISTINCT FROM OLD.base_quantity_reserved THEN
    NEW.base_quantity_reserved := GREATEST(
      0,
      OLD.base_quantity_reserved + (NEW.quantity_reserved - OLD.quantity_reserved)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_branch_stock_base_quantities_trigger ON public.branch_stock;
CREATE TRIGGER sync_branch_stock_base_quantities_trigger
BEFORE INSERT OR UPDATE ON public.branch_stock
FOR EACH ROW
EXECUTE FUNCTION public.sync_branch_stock_base_quantities();

CREATE OR REPLACE FUNCTION public.convert_to_base_units(quantity numeric, uom_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_factor numeric(10,4);
BEGIN
  IF $1 IS NULL OR $1 < 0 THEN
    RAISE EXCEPTION 'Quantity must be zero or greater';
  END IF;

  SELECT units_of_measure.conversion_factor
    INTO v_factor
    FROM public.units_of_measure
   WHERE units_of_measure.id = $2
     AND units_of_measure.is_active = true
     AND (
       auth.uid() IS NULL
       OR units_of_measure.business_id = public.get_my_business_id()
     );

  IF v_factor IS NULL THEN
    RAISE EXCEPTION 'Unit of measure not found';
  END IF;

  RETURN round($1 * v_factor, 4);
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_from_base_units(base_quantity numeric, uom_id uuid)
RETURNS TABLE(full_units numeric, remainder_base_units numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_factor numeric(10,4);
BEGIN
  IF $1 IS NULL OR $1 < 0 THEN
    RAISE EXCEPTION 'Base quantity must be zero or greater';
  END IF;

  SELECT units_of_measure.conversion_factor
    INTO v_factor
    FROM public.units_of_measure
   WHERE units_of_measure.id = $2
     AND units_of_measure.is_active = true
     AND (
       auth.uid() IS NULL
       OR units_of_measure.business_id = public.get_my_business_id()
     );

  IF v_factor IS NULL THEN
    RAISE EXCEPTION 'Unit of measure not found';
  END IF;

  RETURN QUERY
  SELECT
    floor($1 / v_factor)::numeric AS full_units,
    mod($1, v_factor)::numeric AS remainder_base_units;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_stock_delivery_with_uom(
  p_branch_id uuid,
  p_product_id uuid,
  p_business_id uuid,
  p_uom_id uuid,
  p_quantity_in_uom numeric,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_business_id uuid;
  v_actor_role text;
  v_effective_role text;
  v_base_qty numeric(12,4);
  v_legacy_qty integer;
  v_stock public.branch_stock%ROWTYPE;
  v_stock_id uuid;
  v_old_value jsonb;
  v_new_base_on_hand numeric(12,4);
  v_delivery_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF auth.uid() IS NOT NULL AND public.get_my_business_id() <> p_business_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_quantity_in_uom IS NULL OR p_quantity_in_uom <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT users.business_id, users.global_role
    INTO v_actor_business_id, v_actor_role
    FROM public.users
   WHERE users.id = p_actor_id
     AND users.deleted_at IS NULL
     AND users.is_active = true;

  IF v_actor_business_id IS NULL
     OR v_actor_business_id <> p_business_id
     OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.branches
     WHERE branches.id = p_branch_id
       AND branches.business_id = p_business_id
       AND branches.deleted_at IS NULL
       AND branches.is_active = true
  ) THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.products
     WHERE products.id = p_product_id
       AND products.business_id = p_business_id
       AND products.deleted_at IS NULL
       AND products.is_active = true
  ) THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.product_uom_links
      JOIN public.units_of_measure
        ON units_of_measure.id = product_uom_links.uom_id
       AND units_of_measure.business_id = product_uom_links.business_id
     WHERE product_uom_links.product_id = p_product_id
       AND product_uom_links.uom_id = p_uom_id
       AND product_uom_links.business_id = p_business_id
       AND units_of_measure.is_active = true
  ) THEN
    RAISE EXCEPTION 'Unit of measure is not linked to this product';
  END IF;

  v_effective_role := public.get_effective_branch_role(p_actor_id, p_branch_id);

  IF public.branch_role_rank(v_effective_role) < public.branch_role_rank('admin') THEN
    PERFORM public.log_branch_access_denial(
      p_actor_id,
      p_branch_id,
      'admin',
      v_effective_role,
      'record_stock_delivery_with_uom'
    );
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_base_qty := public.convert_to_base_units(p_quantity_in_uom, p_uom_id);
  v_legacy_qty := floor(v_base_qty)::integer;

  INSERT INTO public.supplier_deliveries (
    business_id,
    to_branch_id,
    received_by,
    supplier_name,
    reference_code,
    status,
    delivered_at
  )
  VALUES (
    p_business_id,
    p_branch_id,
    p_actor_id,
    'UOM stock delivery',
    NULL,
    'received',
    now()
  )
  RETURNING id INTO v_delivery_id;

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
    p_product_id,
    p_business_id,
    v_legacy_qty,
    v_legacy_qty,
    0,
    NULL,
    'Recorded with unit-of-measure conversion',
    p_uom_id,
    p_quantity_in_uom,
    v_base_qty,
    v_base_qty
  );

  SELECT *
    INTO v_stock
    FROM public.branch_stock
   WHERE branch_stock.business_id = p_business_id
     AND branch_stock.branch_id = p_branch_id
     AND branch_stock.product_id = p_product_id
   FOR UPDATE;

  IF FOUND THEN
    v_stock_id := v_stock.id;
    v_old_value := jsonb_build_object(
      'quantity_on_hand', v_stock.quantity_on_hand,
      'base_quantity_on_hand', v_stock.base_quantity_on_hand
    );
    v_new_base_on_hand := round(v_stock.base_quantity_on_hand + v_base_qty, 4);

    UPDATE public.branch_stock
       SET base_quantity_on_hand = v_new_base_on_hand,
           quantity_on_hand = floor(v_new_base_on_hand)::integer,
           last_updated_at = now()
     WHERE id = v_stock.id;
  ELSE
    v_old_value := NULL;
    v_new_base_on_hand := v_base_qty;

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
      p_branch_id,
      p_product_id,
      p_business_id,
      v_legacy_qty,
      0,
      10,
      v_new_base_on_hand,
      0
    )
    RETURNING id INTO v_stock_id;
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
    p_business_id,
    p_actor_id,
    'branch_stock',
    v_stock_id,
    'uom_delivery_recorded',
    v_old_value,
    jsonb_build_object(
      'branch_id', p_branch_id,
      'product_id', p_product_id,
      'uom_id', p_uom_id,
      'quantity_in_uom', p_quantity_in_uom,
      'base_quantity_added', v_base_qty,
      'base_quantity_on_hand', v_new_base_on_hand,
      'legacy_quantity_on_hand', floor(v_new_base_on_hand)::integer,
      'supplier_delivery_id', v_delivery_id,
      'effective_role', v_effective_role
    )
  );
END;
$$;
