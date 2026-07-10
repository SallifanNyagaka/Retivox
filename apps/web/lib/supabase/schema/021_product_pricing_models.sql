/*
 * Product classification and pricing models for Retivox.
 *
 * This migration supports the simplified product setup flow:
 * - product kind distinguishes fixed package products from measured/counted ones
 * - category/subcategory/brand fields keep catalogs understandable
 * - pricing models store fixed, assisted pack, and manual quantity pricing
 *
 * All changes are additive and preserve the legacy products.category/unit fields.
 */

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_kind text NOT NULL DEFAULT 'fixed_package',
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS brand_family text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'products_product_kind_valid'
       AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_product_kind_valid
      CHECK (product_kind IN ('fixed_package', 'measured_counted'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.product_pricing_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  pricing_method text NOT NULL DEFAULT 'fixed_price',
  rounding_rule text NOT NULL DEFAULT 'nearest_5',
  calculation_strategy text NOT NULL DEFAULT 'nearest_lower_pack_rate',
  status text NOT NULL DEFAULT 'approved',
  created_by uuid NOT NULL REFERENCES public.users(id),
  approved_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  CONSTRAINT product_pricing_models_method_valid
    CHECK (pricing_method IN ('fixed_price', 'assisted_pack', 'manual_quantity')),
  CONSTRAINT product_pricing_models_rounding_valid
    CHECK (rounding_rule IN ('none', 'nearest_5', 'up_5', 'down_5', 'nearest_10')),
  CONSTRAINT product_pricing_models_strategy_valid
    CHECK (calculation_strategy IN ('nearest_lower_pack_rate')),
  CONSTRAINT product_pricing_models_status_valid
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_pricing_models_one_active_scope
  ON public.product_pricing_models (product_id, (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  WHERE status IN ('approved', 'pending_approval', 'draft');

CREATE TABLE IF NOT EXISTS public.product_price_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  pricing_model_id uuid NOT NULL REFERENCES public.product_pricing_models(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  uom_id uuid REFERENCES public.units_of_measure(id) ON DELETE RESTRICT,
  quantity_in_uom numeric(12,4) NOT NULL,
  base_quantity numeric(12,4) NOT NULL,
  price numeric(12,2) NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_price_points_quantity_positive CHECK (quantity_in_uom > 0 AND base_quantity > 0),
  CONSTRAINT product_price_points_price_nonnegative CHECK (price >= 0),
  CONSTRAINT product_price_points_source_valid CHECK (source IN ('manual', 'assisted_anchor', 'generated'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_price_points_unique_quantity
  ON public.product_price_points (pricing_model_id, base_quantity);

CREATE INDEX IF NOT EXISTS idx_product_pricing_models_business_product_branch
  ON public.product_pricing_models (business_id, product_id, branch_id, status);

CREATE INDEX IF NOT EXISTS idx_product_price_points_business_model_quantity
  ON public.product_price_points (business_id, pricing_model_id, base_quantity);

ALTER TABLE public.product_pricing_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_price_points ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'product_pricing_models'
       AND policyname = 'product_pricing_models_select'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "product_pricing_models_select" ON public.product_pricing_models
      FOR SELECT
      USING (business_id = public.get_my_business_id())
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'product_pricing_models'
       AND policyname = 'product_pricing_models_insert'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "product_pricing_models_insert" ON public.product_pricing_models
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
       AND tablename = 'product_pricing_models'
       AND policyname = 'product_pricing_models_update'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "product_pricing_models_update" ON public.product_pricing_models
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
       AND tablename = 'product_pricing_models'
       AND policyname = 'product_pricing_models_delete'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "product_pricing_models_delete" ON public.product_pricing_models
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
       AND tablename = 'product_price_points'
       AND policyname = 'product_price_points_select'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "product_price_points_select" ON public.product_price_points
      FOR SELECT
      USING (business_id = public.get_my_business_id())
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'product_price_points'
       AND policyname = 'product_price_points_insert'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "product_price_points_insert" ON public.product_price_points
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
       AND tablename = 'product_price_points'
       AND policyname = 'product_price_points_update'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "product_price_points_update" ON public.product_price_points
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
       AND tablename = 'product_price_points'
       AND policyname = 'product_price_points_delete'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "product_price_points_delete" ON public.product_price_points
      FOR DELETE
      USING (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() = 'owner'
      )
    $policy$;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_product_pricing_model_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_business_id uuid;
  v_branch_business_id uuid;
BEGIN
  SELECT products.business_id
    INTO v_product_business_id
    FROM public.products
   WHERE products.id = NEW.product_id;

  IF v_product_business_id IS NULL OR v_product_business_id <> NEW.business_id THEN
    RAISE EXCEPTION 'Pricing model product must belong to the same business';
  END IF;

  IF NEW.branch_id IS NOT NULL THEN
    SELECT branches.business_id
      INTO v_branch_business_id
      FROM public.branches
     WHERE branches.id = NEW.branch_id;

    IF v_branch_business_id IS NULL OR v_branch_business_id <> NEW.business_id THEN
      RAISE EXCEPTION 'Pricing model branch must belong to the same business';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_product_pricing_model_scope_trigger ON public.product_pricing_models;
CREATE TRIGGER validate_product_pricing_model_scope_trigger
BEFORE INSERT OR UPDATE ON public.product_pricing_models
FOR EACH ROW
EXECUTE FUNCTION public.validate_product_pricing_model_scope();

CREATE OR REPLACE FUNCTION public.validate_product_price_point_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_model public.product_pricing_models%ROWTYPE;
  v_uom_business_id uuid;
BEGIN
  SELECT *
    INTO v_model
    FROM public.product_pricing_models
   WHERE product_pricing_models.id = NEW.pricing_model_id;

  IF NOT FOUND
     OR v_model.business_id <> NEW.business_id
     OR v_model.product_id <> NEW.product_id
     OR v_model.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'Price point must match its pricing model scope';
  END IF;

  IF NEW.uom_id IS NOT NULL THEN
    SELECT units_of_measure.business_id
      INTO v_uom_business_id
      FROM public.units_of_measure
     WHERE units_of_measure.id = NEW.uom_id
       AND units_of_measure.is_active = true;

    IF v_uom_business_id IS NULL OR v_uom_business_id <> NEW.business_id THEN
      RAISE EXCEPTION 'Price point unit must belong to the same business';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_product_price_point_scope_trigger ON public.product_price_points;
CREATE TRIGGER validate_product_price_point_scope_trigger
BEFORE INSERT OR UPDATE ON public.product_price_points
FOR EACH ROW
EXECUTE FUNCTION public.validate_product_price_point_scope();

CREATE OR REPLACE FUNCTION public.audit_product_pricing_mutation()
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

  IF v_actor_id IS NULL AND TG_OP <> 'DELETE' AND TG_TABLE_NAME = 'product_pricing_models' THEN
    v_actor_id := NEW.created_by;
  END IF;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor required for audited pricing mutation';
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

DROP TRIGGER IF EXISTS audit_product_pricing_models_mutation_trigger ON public.product_pricing_models;
CREATE TRIGGER audit_product_pricing_models_mutation_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.product_pricing_models
FOR EACH ROW
EXECUTE FUNCTION public.audit_product_pricing_mutation();

DROP TRIGGER IF EXISTS audit_product_price_points_mutation_trigger ON public.product_price_points;
CREATE TRIGGER audit_product_price_points_mutation_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.product_price_points
FOR EACH ROW
EXECUTE FUNCTION public.audit_product_pricing_mutation();
