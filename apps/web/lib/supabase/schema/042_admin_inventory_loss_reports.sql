/*
 * Admin inventory loss reports for Retivox.
 *
 * Branch admins can report damaged, spoiled, or lost stock for any branch they
 * manage. Reports remain pending until owner approval, matching the employee
 * reporting workflow.
 */

CREATE OR REPLACE FUNCTION public.admin_damage_report_products(p_branch_id uuid DEFAULT NULL)
RETURNS TABLE(
  branch_id uuid,
  branch_name text,
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
    branch_stock.branch_id,
    branches.name AS branch_name,
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
  JOIN public.branches
    ON branches.id = branch_stock.branch_id
   AND branches.business_id = branch_stock.business_id
  JOIN public.products
    ON products.id = branch_stock.product_id
   AND products.business_id = branch_stock.business_id
  WHERE branch_stock.business_id = public.get_my_business_id()
    AND (p_branch_id IS NULL OR branch_stock.branch_id = p_branch_id)
    AND branches.deleted_at IS NULL
    AND products.is_active = true
    AND products.deleted_at IS NULL
    AND (branch_stock.base_quantity_on_hand - COALESCE(branch_stock.base_quantity_reserved, 0)) > 0
    AND public.branch_role_rank(public.get_effective_branch_role(auth.uid(), branch_stock.branch_id)) >= public.branch_role_rank('admin')
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
  ORDER BY branches.name ASC, products.name ASC;
$$;

CREATE OR REPLACE FUNCTION public.admin_damage_report_products()
RETURNS TABLE(
  branch_id uuid,
  branch_name text,
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
  SELECT *
    FROM public.admin_damage_report_products(NULL::uuid);
$$;

CREATE OR REPLACE FUNCTION public.admin_managed_inventory_loss_reports(p_limit integer DEFAULT 50)
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
    reports.status,
    reports.review_note,
    reports.created_at,
    reports.reviewed_at
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
    AND public.branch_role_rank(public.get_effective_branch_role(auth.uid(), reports.branch_id)) >= public.branch_role_rank('admin')
  ORDER BY reports.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.admin_report_inventory_loss(
  p_branch_id uuid,
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
  v_uom public.units_of_measure%ROWTYPE;
  v_base_quantity numeric(12,4);
  v_available_base_quantity numeric(12,4);
  v_report_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF COALESCE(public.branch_role_rank(public.get_effective_branch_role(v_actor_id, p_branch_id)), 0) < public.branch_role_rank('admin') THEN
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

  IF NOT EXISTS (
    SELECT 1
      FROM public.branches
     WHERE id = p_branch_id
       AND business_id = v_business_id
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Branch not found';
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
    RAISE EXCEPTION 'Admins can only report damaged stock in individual units';
  END IF;

  v_base_quantity := round(p_quantity_in_uom * v_uom.conversion_factor, 4);

  IF v_base_quantity <= 0 OR v_base_quantity <> floor(v_base_quantity) THEN
    RAISE EXCEPTION 'Loss quantity must convert to a whole base unit';
  END IF;

  SELECT branch_stock.base_quantity_on_hand - COALESCE(branch_stock.base_quantity_reserved, 0)
    INTO v_available_base_quantity
    FROM public.branch_stock
   WHERE business_id = v_business_id
     AND branch_id = p_branch_id
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
    p_branch_id,
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
    'admin_inventory_loss_report',
    v_report_id,
    'reported',
    NULL,
    jsonb_build_object(
      'branch_id', p_branch_id,
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
