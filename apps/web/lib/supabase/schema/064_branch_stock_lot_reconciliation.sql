-- Keep lot balances aligned with legacy stock mutations while those workflows
-- are progressively extended to carry full batch metadata.

CREATE OR REPLACE FUNCTION public.sync_branch_stock_lots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_quantity numeric(12,4) := 0;
  v_new_quantity numeric(12,4);
  v_delta numeric(12,4);
  v_remaining numeric(12,4);
  v_take numeric(12,4);
  v_legacy_lot_id uuid;
  v_lot record;
BEGIN
  IF current_setting('app.supplier_delivery_metadata_pending', true) = 'on'
     OR current_setting('app.fefo_lot_allocation', true) = 'on' THEN
    RETURN NEW;
  END IF;

  v_new_quantity := round(COALESCE(NEW.base_quantity_on_hand, NEW.quantity_on_hand, 0), 4);
  IF TG_OP = 'UPDATE' THEN
    v_old_quantity := round(COALESCE(OLD.base_quantity_on_hand, OLD.quantity_on_hand, 0), 4);
  END IF;
  v_delta := round(v_new_quantity - v_old_quantity, 4);
  IF v_delta = 0 THEN RETURN NEW; END IF;

  IF v_delta > 0 THEN
    INSERT INTO public.inventory_lots (business_id, product_id, is_untracked_legacy)
    VALUES (NEW.business_id, NEW.product_id, true)
    ON CONFLICT (business_id, product_id) WHERE is_untracked_legacy
    DO UPDATE SET product_id = EXCLUDED.product_id
    RETURNING id INTO v_legacy_lot_id;

    INSERT INTO public.branch_lot_stock (
      business_id, branch_id, product_id, lot_id, base_quantity_on_hand
    ) VALUES (
      NEW.business_id, NEW.branch_id, NEW.product_id, v_legacy_lot_id, v_delta
    )
    ON CONFLICT (branch_id, lot_id)
    DO UPDATE SET
      base_quantity_on_hand = public.branch_lot_stock.base_quantity_on_hand + EXCLUDED.base_quantity_on_hand,
      updated_at = now();

    RETURN NEW;
  END IF;

  v_remaining := abs(v_delta);
  FOR v_lot IN
    SELECT bls.id,
           bls.base_quantity_on_hand,
           lot.expires_on,
           lot.received_at,
           lot.is_untracked_legacy
      FROM public.branch_lot_stock bls
      JOIN public.inventory_lots lot
        ON lot.id = bls.lot_id
       AND lot.business_id = bls.business_id
       AND lot.product_id = bls.product_id
     WHERE bls.business_id = NEW.business_id
       AND bls.branch_id = NEW.branch_id
       AND bls.product_id = NEW.product_id
       AND bls.base_quantity_on_hand > 0
     ORDER BY CASE WHEN lot.expires_on < current_date THEN 0 ELSE 1 END,
              lot.expires_on ASC NULLS LAST,
              lot.received_at ASC,
              lot.id ASC
     FOR UPDATE OF bls
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_lot.base_quantity_on_hand);
    UPDATE public.branch_lot_stock
       SET base_quantity_on_hand = round(base_quantity_on_hand - v_take, 4),
           base_quantity_reserved = LEAST(base_quantity_reserved, round(base_quantity_on_hand - v_take, 4)),
           updated_at = now()
     WHERE id = v_lot.id;
    v_remaining := round(v_remaining - v_take, 4);
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Aggregate stock changed by more than the recorded lot balance. Reconcile inventory before retrying.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS branch_stock_sync_lots ON public.branch_stock;
CREATE TRIGGER branch_stock_sync_lots
AFTER INSERT OR UPDATE OF base_quantity_on_hand, quantity_on_hand ON public.branch_stock
FOR EACH ROW EXECUTE FUNCTION public.sync_branch_stock_lots();

REVOKE ALL ON FUNCTION public.sync_branch_stock_lots() FROM PUBLIC, anon, authenticated;
