/*
 * Employee inventory loss reports for Retivox.
 *
 * Employees can report damaged, spoiled, or lost stock from their assigned
 * branch. Reports are pending records only; owner approval converts a report
 * into the existing inventory loss event, which deducts normal stock and can
 * create recovery stock for employee sale.
 */

CREATE TABLE IF NOT EXISTS public.employee_inventory_loss_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  uom_id uuid NOT NULL REFERENCES public.units_of_measure(id) ON DELETE RESTRICT,
  reported_by uuid NOT NULL REFERENCES public.users(id),
  quantity_in_uom numeric(12,4) NOT NULL,
  base_quantity numeric(12,4) NOT NULL,
  loss_type text NOT NULL,
  reason text NOT NULL,
  suggested_recovery_sale_price_per_base_unit numeric(12,2),
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES public.users(id),
  reviewed_at timestamptz,
  review_note text,
  inventory_loss_event_id uuid REFERENCES public.inventory_loss_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_inventory_loss_reports_loss_type_valid CHECK (loss_type IN ('breakage', 'spoilage', 'theft', 'markdown_damage', 'other')),
  CONSTRAINT employee_inventory_loss_reports_status_valid CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT employee_inventory_loss_reports_quantities_positive CHECK (quantity_in_uom > 0 AND base_quantity > 0),
  CONSTRAINT employee_inventory_loss_reports_recovery_nonnegative CHECK (suggested_recovery_sale_price_per_base_unit IS NULL OR suggested_recovery_sale_price_per_base_unit >= 0),
  CONSTRAINT employee_inventory_loss_reports_reason_present CHECK (NULLIF(trim(reason), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_employee_inventory_loss_reports_business_status
  ON public.employee_inventory_loss_reports (business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_inventory_loss_reports_branch_status
  ON public.employee_inventory_loss_reports (business_id, branch_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_inventory_loss_reports_reported_by
  ON public.employee_inventory_loss_reports (reported_by, created_at DESC);

ALTER TABLE public.employee_inventory_loss_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'employee_inventory_loss_reports'
       AND policyname = 'employee_inventory_loss_reports_select_scope'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "employee_inventory_loss_reports_select_scope" ON public.employee_inventory_loss_reports
      FOR SELECT
      USING (
        business_id = public.get_my_business_id()
        AND (
          reported_by = auth.uid()
          OR public.get_my_global_role() = 'owner'
          OR public.branch_role_rank(public.get_effective_branch_role(auth.uid(), branch_id)) >= public.branch_role_rank('admin')
        )
      )
    $policy$;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS touch_employee_inventory_loss_reports_updated_at ON public.employee_inventory_loss_reports;
CREATE TRIGGER touch_employee_inventory_loss_reports_updated_at
BEFORE UPDATE ON public.employee_inventory_loss_reports
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.employee_damage_report_products(p_branch_id uuid)
RETURNS TABLE(
  product_id uuid,
  name text,
  sku text,
  category text,
  base_quantity_available numeric,
  uom_options jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    products.id AS product_id,
    products.name,
    products.sku,
    products.category,
    GREATEST(branch_stock.base_quantity_on_hand - COALESCE(branch_stock.base_quantity_reserved, 0), 0) AS base_quantity_available,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', units_of_measure.id,
            'name', units_of_measure.name,
            'abbreviation', units_of_measure.abbreviation,
            'conversionFactor', units_of_measure.conversion_factor,
            'isBaseUnit', units_of_measure.is_base_unit,
            'isBaseUom', product_uom_links.is_base_uom,
            'isDefaultPurchaseUom', product_uom_links.is_default_purchase_uom,
            'isDefaultSaleUom', product_uom_links.is_default_sale_uom
          )
          ORDER BY
            product_uom_links.is_base_uom DESC,
            units_of_measure.conversion_factor ASC
        )
        FROM public.product_uom_links
        JOIN public.units_of_measure
          ON units_of_measure.id = product_uom_links.uom_id
         AND units_of_measure.business_id = product_uom_links.business_id
        WHERE product_uom_links.business_id = branch_stock.business_id
          AND product_uom_links.product_id = branch_stock.product_id
          AND (
            product_uom_links.is_base_uom = true
            OR units_of_measure.is_base_unit = true
            OR units_of_measure.conversion_factor = 1
          )
          AND units_of_measure.is_active = true
      ),
      '[]'::jsonb
    ) AS uom_options
  FROM public.branch_stock
  JOIN public.products
    ON products.id = branch_stock.product_id
   AND products.business_id = branch_stock.business_id
  WHERE branch_stock.business_id = public.get_my_business_id()
    AND branch_stock.branch_id = p_branch_id
    AND public.get_employee_branch_id(auth.uid()) = p_branch_id
    AND products.is_active = true
    AND products.deleted_at IS NULL
    AND (branch_stock.base_quantity_on_hand - COALESCE(branch_stock.base_quantity_reserved, 0)) > 0
    AND EXISTS (
      SELECT 1
        FROM public.product_uom_links
        JOIN public.units_of_measure
          ON units_of_measure.id = product_uom_links.uom_id
         AND units_of_measure.business_id = product_uom_links.business_id
       WHERE product_uom_links.business_id = branch_stock.business_id
         AND product_uom_links.product_id = branch_stock.product_id
         AND units_of_measure.is_active = true
         AND (
           product_uom_links.is_base_uom = true
           OR units_of_measure.is_base_unit = true
           OR units_of_measure.conversion_factor = 1
         )
    )
  ORDER BY products.name ASC;
$$;

CREATE OR REPLACE FUNCTION public.employee_my_inventory_loss_reports(p_limit integer DEFAULT 25)
RETURNS TABLE(
  report_id uuid,
  product_id uuid,
  product_name text,
  sku text,
  uom_id uuid,
  uom_name text,
  quantity_in_uom numeric,
  base_quantity numeric,
  loss_type text,
  reason text,
  suggested_recovery_sale_price_per_base_unit numeric,
  status text,
  review_note text,
  created_at timestamptz,
  reviewed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    reports.id AS report_id,
    reports.product_id,
    products.name AS product_name,
    products.sku,
    reports.uom_id,
    units_of_measure.name AS uom_name,
    reports.quantity_in_uom,
    reports.base_quantity,
    reports.loss_type,
    reports.reason,
    reports.suggested_recovery_sale_price_per_base_unit,
    reports.status,
    reports.review_note,
    reports.created_at,
    reports.reviewed_at
  FROM public.employee_inventory_loss_reports AS reports
  JOIN public.products
    ON products.id = reports.product_id
  JOIN public.units_of_measure
    ON units_of_measure.id = reports.uom_id
  WHERE reports.business_id = public.get_my_business_id()
    AND reports.reported_by = auth.uid()
  ORDER BY reports.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

DROP FUNCTION IF EXISTS public.employee_report_inventory_loss(uuid, uuid, numeric, text, text, numeric);

CREATE OR REPLACE FUNCTION public.employee_report_inventory_loss(
  p_product_id uuid,
  p_uom_id uuid,
  p_quantity_in_uom numeric,
  p_loss_type text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_branch_id uuid;
  v_uom public.units_of_measure%ROWTYPE;
  v_base_quantity numeric(12,4);
  v_available_base_quantity numeric(12,4);
  v_report_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();
  v_branch_id := public.get_employee_branch_id(v_actor_id);

  IF v_actor_id IS NULL OR v_business_id IS NULL OR v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  PERFORM public.assert_employee_at_branch(v_actor_id, v_branch_id);

  IF p_quantity_in_uom IS NULL OR p_quantity_in_uom <= 0 THEN
    RAISE EXCEPTION 'Loss quantity must be greater than zero';
  END IF;

  IF p_loss_type NOT IN ('breakage', 'spoilage', 'theft', 'markdown_damage', 'other') THEN
    RAISE EXCEPTION 'Invalid loss type';
  END IF;

  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Loss reason is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.products
     WHERE id = p_product_id
       AND business_id = v_business_id
       AND is_active = true
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Product not found';
  END IF;

  v_uom := public.assert_product_uom_link(v_business_id, p_product_id, p_uom_id);

  IF NOT EXISTS (
    SELECT 1
      FROM public.product_uom_links
      JOIN public.units_of_measure
        ON units_of_measure.id = product_uom_links.uom_id
       AND units_of_measure.business_id = product_uom_links.business_id
     WHERE product_uom_links.business_id = v_business_id
       AND product_uom_links.product_id = p_product_id
       AND product_uom_links.uom_id = p_uom_id
       AND (
         product_uom_links.is_base_uom = true
         OR units_of_measure.is_base_unit = true
         OR units_of_measure.conversion_factor = 1
       )
  ) THEN
    RAISE EXCEPTION 'Employees can only report damaged stock in individual units';
  END IF;

  v_base_quantity := round(p_quantity_in_uom * v_uom.conversion_factor, 4);

  IF v_base_quantity <= 0 OR v_base_quantity <> floor(v_base_quantity) THEN
    RAISE EXCEPTION 'Loss quantity must convert to a whole base unit';
  END IF;

  SELECT branch_stock.base_quantity_on_hand - COALESCE(branch_stock.base_quantity_reserved, 0)
    INTO v_available_base_quantity
    FROM public.branch_stock
   WHERE business_id = v_business_id
     AND branch_id = v_branch_id
     AND product_id = p_product_id;

  IF v_available_base_quantity IS NULL OR v_available_base_quantity < v_base_quantity THEN
    RAISE EXCEPTION 'Reported quantity is higher than available stock';
  END IF;

  INSERT INTO public.employee_inventory_loss_reports (
    business_id,
    branch_id,
    product_id,
    uom_id,
    reported_by,
    quantity_in_uom,
    base_quantity,
    loss_type,
    reason
  )
  VALUES (
    v_business_id,
    v_branch_id,
    p_product_id,
    p_uom_id,
    v_actor_id,
    p_quantity_in_uom,
    v_base_quantity,
    p_loss_type,
    trim(p_reason)
  )
  RETURNING id INTO v_report_id;

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
    'employee_inventory_loss_report',
    v_report_id,
    'reported',
    NULL,
    jsonb_build_object(
      'branch_id', v_branch_id,
      'product_id', p_product_id,
      'uom_id', p_uom_id,
      'quantity_in_uom', p_quantity_in_uom,
      'base_quantity', v_base_quantity,
      'loss_type', p_loss_type
    )
  );

  RETURN v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_pending_employee_inventory_loss_reports(p_limit integer DEFAULT 25)
RETURNS TABLE(
  report_id uuid,
  branch_id uuid,
  branch_name text,
  product_id uuid,
  product_name text,
  sku text,
  uom_id uuid,
  uom_name text,
  reported_by uuid,
  reporter_name text,
  quantity_in_uom numeric,
  base_quantity numeric,
  loss_type text,
  reason text,
  suggested_recovery_sale_price_per_base_unit numeric,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    reports.id AS report_id,
    reports.branch_id,
    branches.name AS branch_name,
    reports.product_id,
    products.name AS product_name,
    products.sku,
    reports.uom_id,
    units_of_measure.name AS uom_name,
    reports.reported_by,
    users.name AS reporter_name,
    reports.quantity_in_uom,
    reports.base_quantity,
    reports.loss_type,
    reports.reason,
    reports.suggested_recovery_sale_price_per_base_unit,
    reports.created_at
  FROM public.employee_inventory_loss_reports AS reports
  JOIN public.branches
    ON branches.id = reports.branch_id
  JOIN public.products
    ON products.id = reports.product_id
  JOIN public.units_of_measure
    ON units_of_measure.id = reports.uom_id
  LEFT JOIN public.users
    ON users.id = reports.reported_by
  WHERE reports.business_id = public.get_my_business_id()
    AND public.get_my_global_role() = 'owner'
    AND reports.status = 'pending'
  ORDER BY reports.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

DROP FUNCTION IF EXISTS public.owner_approve_employee_inventory_loss_report(uuid, text);

DROP FUNCTION IF EXISTS public.owner_update_employee_inventory_loss_report(uuid, numeric, text, text, numeric, text);

CREATE OR REPLACE FUNCTION public.owner_update_employee_inventory_loss_report(
  p_report_id uuid,
  p_quantity_in_uom numeric,
  p_loss_type text,
  p_reason text,
  p_recovery_sale_price_per_base_unit numeric DEFAULT NULL,
  p_review_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_report public.employee_inventory_loss_reports%ROWTYPE;
  v_uom public.units_of_measure%ROWTYPE;
  v_base_quantity numeric(12,4);
  v_available_base_quantity numeric(12,4);
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_quantity_in_uom IS NULL OR p_quantity_in_uom <= 0 THEN
    RAISE EXCEPTION 'Loss quantity must be greater than zero';
  END IF;

  IF p_loss_type NOT IN ('breakage', 'spoilage', 'theft', 'markdown_damage', 'other') THEN
    RAISE EXCEPTION 'Invalid loss type';
  END IF;

  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Loss reason is required';
  END IF;

  IF COALESCE(p_recovery_sale_price_per_base_unit, 0) < 0 THEN
    RAISE EXCEPTION 'Recovery selling price cannot be negative';
  END IF;

  SELECT *
    INTO v_report
    FROM public.employee_inventory_loss_reports
   WHERE id = p_report_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Damage report not found';
  END IF;

  IF v_report.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending damage reports can be edited';
  END IF;

  v_uom := public.assert_product_uom_link(v_business_id, v_report.product_id, v_report.uom_id);
  v_base_quantity := round(p_quantity_in_uom * v_uom.conversion_factor, 4);

  IF v_base_quantity <= 0 OR v_base_quantity <> floor(v_base_quantity) THEN
    RAISE EXCEPTION 'Loss quantity must convert to a whole base unit';
  END IF;

  SELECT branch_stock.base_quantity_on_hand - COALESCE(branch_stock.base_quantity_reserved, 0)
    INTO v_available_base_quantity
    FROM public.branch_stock
   WHERE business_id = v_business_id
     AND branch_id = v_report.branch_id
     AND product_id = v_report.product_id;

  IF v_available_base_quantity IS NULL OR v_available_base_quantity < v_base_quantity THEN
    RAISE EXCEPTION 'Damage quantity is higher than available stock';
  END IF;

  UPDATE public.employee_inventory_loss_reports
     SET quantity_in_uom = p_quantity_in_uom,
         base_quantity = v_base_quantity,
         loss_type = p_loss_type,
         reason = trim(p_reason),
         suggested_recovery_sale_price_per_base_unit = NULLIF(round(COALESCE(p_recovery_sale_price_per_base_unit, 0), 2), 0),
         reviewed_by = v_actor_id,
         review_note = NULLIF(trim(COALESCE(p_review_note, '')), '')
   WHERE id = v_report.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_approve_employee_inventory_loss_report(
  p_report_id uuid,
  p_recovery_sale_price_per_base_unit numeric DEFAULT NULL,
  p_review_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_report public.employee_inventory_loss_reports%ROWTYPE;
  v_loss_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
    INTO v_report
    FROM public.employee_inventory_loss_reports
   WHERE id = p_report_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Damage report not found';
  END IF;

  IF v_report.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending damage reports can be approved';
  END IF;

  IF COALESCE(p_recovery_sale_price_per_base_unit, 0) < 0 THEN
    RAISE EXCEPTION 'Recovery selling price cannot be negative';
  END IF;

  v_loss_id := public.record_inventory_loss_event(
    v_report.branch_id,
    v_report.product_id,
    v_report.uom_id,
    v_report.quantity_in_uom,
    v_report.loss_type,
    v_report.reason,
    0,
    COALESCE(NULLIF(round(COALESCE(p_recovery_sale_price_per_base_unit, 0), 2), 0), v_report.suggested_recovery_sale_price_per_base_unit)
  );

  UPDATE public.employee_inventory_loss_reports
     SET status = 'approved',
         reviewed_by = v_actor_id,
         reviewed_at = now(),
         review_note = NULLIF(trim(COALESCE(p_review_note, '')), ''),
         suggested_recovery_sale_price_per_base_unit = COALESCE(NULLIF(round(COALESCE(p_recovery_sale_price_per_base_unit, 0), 2), 0), suggested_recovery_sale_price_per_base_unit),
         inventory_loss_event_id = v_loss_id
   WHERE id = v_report.id;

  RETURN v_loss_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_reject_employee_inventory_loss_report(
  p_report_id uuid,
  p_review_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.employee_inventory_loss_reports
     SET status = 'rejected',
         reviewed_by = v_actor_id,
         reviewed_at = now(),
         review_note = NULLIF(trim(COALESCE(p_review_note, '')), '')
   WHERE id = p_report_id
     AND business_id = v_business_id
     AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending damage report not found';
  END IF;
END;
$$;
