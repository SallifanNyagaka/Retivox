/*
 * Mobile physical stock visibility for Retivox.
 *
 * Sale-product RPCs intentionally omit unpriced or non-sellable items. This
 * function gives an employee an accurate, branch-scoped inventory view without
 * widening access to another branch.
 */

-- Repair only logically inconsistent legacy rows. A positive whole-unit
-- quantity with zero base quantity makes existing sellable-stock RPCs hide
-- real stock and causes an avoidable shortage at sale time.
UPDATE public.branch_stock
   SET base_quantity_on_hand = quantity_on_hand,
       base_quantity_reserved = GREATEST(COALESCE(quantity_reserved, 0), 0),
       last_updated_at = now()
 WHERE COALESCE(base_quantity_on_hand, 0) = 0
   AND COALESCE(quantity_on_hand, 0) > 0;

-- Mobile clients must never submit a user id to determine their own scope.
-- This helper derives the branch list solely from the authenticated session.
CREATE OR REPLACE FUNCTION public.my_accessible_branch_ids(p_min_role text DEFAULT 'employee')
RETURNS TABLE(branch_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branches.id AS branch_id
  FROM public.get_user_branch_roles(auth.uid()) AS roles
  JOIN public.branches
    ON branches.id = roles.branch_id
  WHERE public.branch_role_rank(roles.role) >= public.branch_role_rank(p_min_role)
    AND public.branch_role_rank(p_min_role) > 0
    AND branches.business_id = public.get_my_business_id()
    AND branches.is_active = true
    AND branches.deleted_at IS NULL
  ORDER BY branches.id;
$$;

CREATE OR REPLACE FUNCTION public.employee_branch_stock_levels(p_branch_id uuid)
RETURNS TABLE(
  product_id uuid,
  name text,
  sku text,
  category text,
  unit text,
  quantity_on_hand integer,
  quantity_reserved integer,
  base_quantity_on_hand numeric,
  base_quantity_reserved numeric,
  low_stock_threshold integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
  v_role text := public.get_my_global_role();
BEGIN
  IF v_actor_id IS NULL OR v_business_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_role = 'owner' THEN
    NULL;
  ELSIF public.branch_role_rank(public.get_effective_branch_role(v_actor_id, p_branch_id)) >= public.branch_role_rank('admin') THEN
    NULL;
  ELSIF v_role = 'employee' AND public.get_employee_branch_id(v_actor_id) = p_branch_id THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    branch_stock.product_id,
    products.name,
    products.sku,
    products.category,
    products.unit,
    branch_stock.quantity_on_hand,
    COALESCE(branch_stock.quantity_reserved, 0),
    branch_stock.base_quantity_on_hand,
    COALESCE(branch_stock.base_quantity_reserved, 0),
    branch_stock.low_stock_threshold
  FROM public.branch_stock
  JOIN public.products
    ON products.id = branch_stock.product_id
   AND products.business_id = branch_stock.business_id
  JOIN public.branches
    ON branches.id = branch_stock.branch_id
   AND branches.business_id = branch_stock.business_id
  WHERE branch_stock.business_id = v_business_id
    AND branch_stock.branch_id = p_branch_id
    AND branches.is_active = true
    AND branches.deleted_at IS NULL
    AND products.deleted_at IS NULL
    AND COALESCE(branch_stock.base_quantity_on_hand, branch_stock.quantity_on_hand) > 0
  ORDER BY products.name ASC;
END;
$$;
