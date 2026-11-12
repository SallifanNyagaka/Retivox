-- Allocate ordinary sale lines against tracked batches by earliest expiry.
-- Legacy stock without known batch details remains saleable as the final lot.

CREATE OR REPLACE FUNCTION public.allocate_transaction_item_lots_fefo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_available_base numeric(12,4);
  v_remaining numeric(12,4);
  v_take numeric(12,4);
  v_lot record;
BEGIN
  IF NEW.stock_status IS DISTINCT FROM 'deducted'
     OR NEW.recovery_item_id IS NOT NULL
     OR COALESCE(NEW.base_quantity, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.fefo_lot_allocation', 'on', true);

  SELECT t.branch_id
    INTO v_branch_id
    FROM public.transactions t
   WHERE t.id = NEW.transaction_id
     AND t.business_id = NEW.business_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve the branch for this sale line';
  END IF;

  SELECT GREATEST(bs.base_quantity_on_hand - bs.base_quantity_reserved, 0)
    INTO v_available_base
    FROM public.branch_stock bs
   WHERE bs.business_id = NEW.business_id
     AND bs.branch_id = v_branch_id
     AND bs.product_id = NEW.product_id
   FOR UPDATE;

  IF NOT FOUND OR v_available_base < NEW.base_quantity THEN
    RAISE EXCEPTION 'Insufficient available stock for lot allocation';
  END IF;

  SELECT COALESCE(SUM(bls.base_quantity_on_hand - bls.base_quantity_reserved), 0)
    INTO v_available_base
    FROM public.branch_lot_stock bls
    JOIN public.inventory_lots lot
      ON lot.id = bls.lot_id
     AND lot.business_id = bls.business_id
     AND lot.product_id = bls.product_id
   WHERE bls.business_id = NEW.business_id
     AND bls.branch_id = v_branch_id
     AND bls.product_id = NEW.product_id
     AND (lot.expires_on IS NULL OR lot.expires_on >= current_date);

  IF v_available_base < NEW.base_quantity THEN
    RAISE EXCEPTION 'Tracked lot quantities do not cover this sale. Reconcile stock before retrying.';
  END IF;

  v_remaining := round(NEW.base_quantity, 4);
  FOR v_lot IN
    SELECT bls.id AS branch_lot_stock_id,
           bls.lot_id,
           GREATEST(bls.base_quantity_on_hand - bls.base_quantity_reserved, 0) AS available_quantity
      FROM public.branch_lot_stock bls
      JOIN public.inventory_lots lot
        ON lot.id = bls.lot_id
       AND lot.business_id = bls.business_id
       AND lot.product_id = bls.product_id
     WHERE bls.business_id = NEW.business_id
       AND bls.branch_id = v_branch_id
       AND bls.product_id = NEW.product_id
       AND bls.base_quantity_on_hand > bls.base_quantity_reserved
       AND (lot.expires_on IS NULL OR lot.expires_on >= current_date)
     ORDER BY CASE WHEN lot.expires_on IS NULL THEN 1 ELSE 0 END,
              lot.expires_on ASC NULLS LAST,
              lot.received_at ASC,
              lot.id ASC
     FOR UPDATE OF bls
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_lot.available_quantity);
    IF v_take <= 0 THEN CONTINUE; END IF;

    UPDATE public.branch_lot_stock
       SET base_quantity_on_hand = round(base_quantity_on_hand - v_take, 4),
           updated_at = now()
     WHERE id = v_lot.branch_lot_stock_id;

    INSERT INTO public.transaction_item_lot_allocations (
      business_id, transaction_item_id, lot_id, base_quantity
    ) VALUES (
      NEW.business_id, NEW.id, v_lot.lot_id, v_take
    );

    v_remaining := round(v_remaining - v_take, 4);
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Unable to allocate all sale quantity to inventory lots';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transaction_items_allocate_lots_fefo ON public.transaction_items;
CREATE TRIGGER transaction_items_allocate_lots_fefo
AFTER INSERT ON public.transaction_items
FOR EACH ROW EXECUTE FUNCTION public.allocate_transaction_item_lots_fefo();

REVOKE ALL ON FUNCTION public.allocate_transaction_item_lots_fefo() FROM PUBLIC, anon, authenticated;
