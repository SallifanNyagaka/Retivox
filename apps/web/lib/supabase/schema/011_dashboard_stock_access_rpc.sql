/*
 * Shared dashboard stock RPCs for Retivox.
 *
 * This migration is additive. It keeps the existing owner-only RPCs intact and
 * adds branch-role-aware functions for owner/admin dashboard routes that share
 * the same authorization model.
 */

-- Aggregate stock metrics for an already-authorized branch scope.
CREATE OR REPLACE FUNCTION public.dashboard_stock_metrics(p_branch_ids uuid[])
RETURNS TABLE(
  total_skus integer,
  low_stock_count integer,
  out_of_stock_count integer,
  branches_with_alerts integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::integer AS total_skus,
    COUNT(*) FILTER (
      WHERE branch_stock.quantity_on_hand > 0
        AND branch_stock.quantity_on_hand <= branch_stock.low_stock_threshold
    )::integer AS low_stock_count,
    COUNT(*) FILTER (WHERE branch_stock.quantity_on_hand = 0)::integer AS out_of_stock_count,
    COUNT(DISTINCT branch_stock.branch_id) FILTER (
      WHERE branch_stock.quantity_on_hand <= branch_stock.low_stock_threshold
    )::integer AS branches_with_alerts
  FROM public.branch_stock
  WHERE branch_stock.branch_id = ANY(p_branch_ids)
    AND branch_stock.business_id = public.get_my_business_id();
$$;

-- Adjust stock using branch-scoped admin access instead of global owner access.
CREATE OR REPLACE FUNCTION public.dashboard_adjust_stock(
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
  v_actor_id uuid;
  v_business_id uuid;
  v_effective_role text;
  v_stock public.branch_stock%ROWTYPE;
  v_next_quantity integer;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL THEN
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
    FROM public.branch_stock
   WHERE id = p_stock_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock record not found';
  END IF;

  v_effective_role := public.get_effective_branch_role(v_actor_id, v_stock.branch_id);

  IF public.branch_role_rank(v_effective_role) < public.branch_role_rank('admin') THEN
    PERFORM public.log_branch_access_denial(
      v_actor_id,
      v_stock.branch_id,
      'admin',
      v_effective_role,
      'dashboard_adjust_stock'
    );
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_operation = 'add' THEN
    v_next_quantity := v_stock.quantity_on_hand + p_quantity;
  ELSE
    v_next_quantity := GREATEST(0, v_stock.quantity_on_hand - p_quantity);
  END IF;

  UPDATE public.branch_stock
     SET quantity_on_hand = v_next_quantity,
         last_updated_at = now()
   WHERE id = v_stock.id;

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
    'branch_stock',
    v_stock.id,
    'adjusted',
    jsonb_build_object(
      'branch_id', v_stock.branch_id,
      'quantity_on_hand', v_stock.quantity_on_hand
    ),
    jsonb_build_object(
      'branch_id', v_stock.branch_id,
      'effective_role', v_effective_role,
      'quantity_on_hand', v_next_quantity,
      'operation', p_operation,
      'quantity', p_quantity
    )
  );
END;
$$;

-- Query support for scoped stock reads and stock adjustment lookups.
CREATE INDEX IF NOT EXISTS idx_branch_stock_business_branch_product
  ON public.branch_stock (business_id, branch_id, product_id);

CREATE INDEX IF NOT EXISTS idx_branch_stock_branch_quantity
  ON public.branch_stock (branch_id, quantity_on_hand);
