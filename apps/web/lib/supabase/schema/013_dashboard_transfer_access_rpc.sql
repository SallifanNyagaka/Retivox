/*
 * Shared dashboard transfer RPCs for Retivox.
 *
 * These functions mirror the existing owner transfer transactions but authorize
 * by contextual branch role:
 * - initiate: admin at source or destination
 * - approve: owner at both source and destination
 * - receive: admin at destination
 */

CREATE OR REPLACE FUNCTION public.dashboard_initiate_stock_transfer(
  p_from_branch_id uuid,
  p_to_branch_id uuid,
  p_items jsonb,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_from_role text;
  v_to_role text;
  v_effective_role text;
  v_transfer_id uuid;
  v_item record;
  v_stock public.branch_stock%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_from_branch_id = p_to_branch_id THEN
    RAISE EXCEPTION 'Source and destination branches must be different';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one product';
  END IF;

  IF (SELECT count(*) FROM public.branches WHERE id IN (p_from_branch_id, p_to_branch_id) AND business_id = v_business_id) <> 2 THEN
    RAISE EXCEPTION 'One or more branches are invalid';
  END IF;

  v_from_role := public.get_effective_branch_role(v_actor_id, p_from_branch_id);
  v_to_role := public.get_effective_branch_role(v_actor_id, p_to_branch_id);

  IF public.branch_role_rank(v_from_role) < public.branch_role_rank('admin')
     AND public.branch_role_rank(v_to_role) < public.branch_role_rank('admin') THEN
    PERFORM public.log_branch_access_denial(
      v_actor_id,
      p_from_branch_id,
      'admin',
      v_from_role,
      'dashboard_initiate_stock_transfer'
    );
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_effective_role := CASE
    WHEN public.branch_role_rank(v_from_role) >= public.branch_role_rank(v_to_role) THEN v_from_role
    ELSE v_to_role
  END;

  INSERT INTO public.stock_transfers (
    business_id,
    from_branch_id,
    to_branch_id,
    initiated_by,
    status,
    notes
  )
  VALUES (
    v_business_id,
    p_from_branch_id,
    p_to_branch_id,
    v_actor_id,
    'initiated',
    NULLIF(p_notes, '')
  )
  RETURNING id INTO v_transfer_id;

  FOR v_item IN
    SELECT
      (item_value->>'productId')::uuid AS product_id,
      SUM((item_value->>'quantity')::integer)::integer AS quantity
    FROM jsonb_array_elements(p_items) AS item_value
    GROUP BY (item_value->>'productId')::uuid
  LOOP
    IF v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Quantity must be greater than zero';
    END IF;

    SELECT *
      INTO v_stock
      FROM public.branch_stock
     WHERE business_id = v_business_id
       AND branch_id = p_from_branch_id
       AND product_id = v_item.product_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'One or more products are not stocked at the source branch';
    END IF;

    IF (v_stock.quantity_on_hand - v_stock.quantity_reserved) < v_item.quantity THEN
      RAISE EXCEPTION 'Insufficient available stock for one or more products';
    END IF;

    INSERT INTO public.stock_transfer_items (
      transfer_id,
      business_id,
      product_id,
      quantity_sent
    )
    VALUES (
      v_transfer_id,
      v_business_id,
      v_item.product_id,
      v_item.quantity
    );

    UPDATE public.branch_stock
       SET quantity_reserved = quantity_reserved + v_item.quantity,
           last_updated_at = now()
     WHERE id = v_stock.id;
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
    v_business_id,
    v_actor_id,
    'stock_transfer',
    v_transfer_id,
    'initiated',
    NULL,
    jsonb_build_object(
      'effective_role', v_effective_role,
      'from_branch_id', p_from_branch_id,
      'to_branch_id', p_to_branch_id,
      'item_count', jsonb_array_length(p_items),
      'notes', NULLIF(p_notes, '')
    )
  );

  RETURN v_transfer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_approve_stock_transfer(p_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_transfer public.stock_transfers%ROWTYPE;
  v_from_role text;
  v_to_role text;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
    INTO v_transfer
    FROM public.stock_transfers
   WHERE id = p_transfer_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;

  v_from_role := public.get_effective_branch_role(v_actor_id, v_transfer.from_branch_id);
  v_to_role := public.get_effective_branch_role(v_actor_id, v_transfer.to_branch_id);

  IF v_from_role <> 'owner' OR v_to_role <> 'owner' THEN
    PERFORM public.log_branch_access_denial(
      v_actor_id,
      v_transfer.from_branch_id,
      'owner',
      v_from_role,
      'dashboard_approve_stock_transfer'
    );
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_transfer.status <> 'initiated' THEN
    RAISE EXCEPTION 'Only initiated transfers can be approved';
  END IF;

  UPDATE public.stock_transfers
     SET status = 'in_transit'
   WHERE id = v_transfer.id;

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
    'stock_transfer',
    v_transfer.id,
    'approved',
    jsonb_build_object('status', 'initiated'),
    jsonb_build_object('status', 'in_transit', 'effective_role', 'owner')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_mark_stock_transfer_received(p_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_effective_role text;
  v_transfer public.stock_transfers%ROWTYPE;
  v_item public.stock_transfer_items%ROWTYPE;
  v_source public.branch_stock%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
    INTO v_transfer
    FROM public.stock_transfers
   WHERE id = p_transfer_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;

  v_effective_role := public.get_effective_branch_role(v_actor_id, v_transfer.to_branch_id);

  IF public.branch_role_rank(v_effective_role) < public.branch_role_rank('admin') THEN
    PERFORM public.log_branch_access_denial(
      v_actor_id,
      v_transfer.to_branch_id,
      'admin',
      v_effective_role,
      'dashboard_mark_stock_transfer_received'
    );
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_transfer.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Only in-transit transfers can be received';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.stock_transfer_items
     WHERE transfer_id = p_transfer_id
       AND business_id = v_business_id
  ) THEN
    RAISE EXCEPTION 'Transfer has no items';
  END IF;

  FOR v_item IN
    SELECT *
      FROM public.stock_transfer_items
     WHERE transfer_id = p_transfer_id
       AND business_id = v_business_id
     FOR UPDATE
  LOOP
    SELECT *
      INTO v_source
      FROM public.branch_stock
     WHERE business_id = v_business_id
       AND branch_id = v_transfer.from_branch_id
       AND product_id = v_item.product_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Missing source stock for one or more products';
    END IF;

    IF v_source.quantity_reserved < v_item.quantity_sent THEN
      RAISE EXCEPTION 'Reserved stock is lower than the transfer quantity';
    END IF;

    UPDATE public.branch_stock
       SET quantity_reserved = quantity_reserved - v_item.quantity_sent,
           last_updated_at = now()
     WHERE id = v_source.id;

    INSERT INTO public.branch_stock (
      branch_id,
      product_id,
      business_id,
      quantity_on_hand,
      quantity_reserved,
      low_stock_threshold
    )
    VALUES (
      v_transfer.to_branch_id,
      v_item.product_id,
      v_business_id,
      v_item.quantity_sent,
      0,
      v_source.low_stock_threshold
    )
    ON CONFLICT (branch_id, product_id)
    DO UPDATE
       SET quantity_on_hand = branch_stock.quantity_on_hand + EXCLUDED.quantity_on_hand,
           last_updated_at = now();

    UPDATE public.stock_transfer_items
       SET quantity_received = v_item.quantity_sent,
           quantity_discrepancy = 0
     WHERE id = v_item.id;
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'received',
         received_by = v_actor_id,
         received_at = now()
   WHERE id = v_transfer.id;

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
    'stock_transfer',
    v_transfer.id,
    'received',
    jsonb_build_object('status', 'in_transit'),
    jsonb_build_object(
      'status', 'received',
      'effective_role', v_effective_role,
      'from_branch_id', v_transfer.from_branch_id,
      'to_branch_id', v_transfer.to_branch_id
    )
  );
END;
$$;

CREATE INDEX IF NOT EXISTS idx_stock_transfers_business_from_to_status
  ON public.stock_transfers (business_id, from_branch_id, to_branch_id, status);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_business_transfer
  ON public.stock_transfer_items (business_id, transfer_id);
