-- Capture lot identity and expiry through the existing supplier delivery RPC.
-- The legacy RPC is retained internally so existing web/desktop clients keep
-- calling the same public function signature.

ALTER TABLE public.supplier_delivery_items
  ADD COLUMN IF NOT EXISTS line_number integer,
  ADD COLUMN IF NOT EXISTS inventory_lot_id uuid REFERENCES public.inventory_lots(id) ON DELETE RESTRICT;

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY delivery_id ORDER BY id)::integer AS line_number
    FROM public.supplier_delivery_items
   WHERE line_number IS NULL
)
UPDATE public.supplier_delivery_items item
   SET line_number = numbered.line_number
  FROM numbered
 WHERE item.id = numbered.id;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_delivery_items_delivery_line_uidx
  ON public.supplier_delivery_items (delivery_id, line_number);

CREATE OR REPLACE FUNCTION public.assign_transaction_receipt_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.local_id IS DISTINCT FROM NEW.local_id THEN
    IF NULLIF(NEW.local_id, '') IS NOT NULL THEN
      NEW.receipt_number := 'RVX-' || upper(substr(regexp_replace(NEW.local_id, '[^a-fA-F0-9]', '', 'g'), 1, 16));
    ELSIF NEW.receipt_number IS NULL THEN
      NEW.receipt_number := 'RVX-' || upper(substr(md5(NEW.id::text), 1, 16));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_assign_receipt_number ON public.transactions;
CREATE TRIGGER transactions_assign_receipt_number
BEFORE INSERT OR UPDATE OF local_id ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.assign_transaction_receipt_number();

UPDATE public.transactions
   SET receipt_number = CASE
     WHEN NULLIF(local_id, '') IS NOT NULL
       THEN 'RVX-' || upper(substr(regexp_replace(local_id, '[^a-fA-F0-9]', '', 'g'), 1, 16))
     ELSE 'RVX-' || upper(substr(md5(id::text), 1, 16))
   END
 WHERE receipt_number IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_barcodes' AND policyname='product_barcodes_owner_insert') THEN
    CREATE POLICY product_barcodes_owner_insert ON public.product_barcodes FOR INSERT TO authenticated
      WITH CHECK (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() = 'owner'
        AND EXISTS (
          SELECT 1 FROM public.products p
           WHERE p.id = product_barcodes.product_id
             AND p.business_id = product_barcodes.business_id
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_barcodes' AND policyname='product_barcodes_owner_update') THEN
    CREATE POLICY product_barcodes_owner_update ON public.product_barcodes FOR UPDATE TO authenticated
      USING (business_id = public.get_my_business_id() AND public.get_my_global_role() = 'owner')
      WITH CHECK (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() = 'owner'
        AND EXISTS (
          SELECT 1 FROM public.products p
           WHERE p.id = product_barcodes.product_id
             AND p.business_id = product_barcodes.business_id
        )
      );
  END IF;
END;
$$;

GRANT INSERT, UPDATE ON public.product_barcodes TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_supplier_delivery_line_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.line_number IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.delivery_id::text, 0));
    SELECT COALESCE(MAX(line_number), 0) + 1
      INTO NEW.line_number
      FROM public.supplier_delivery_items
     WHERE delivery_id = NEW.delivery_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_delivery_items_assign_line_number ON public.supplier_delivery_items;
CREATE TRIGGER supplier_delivery_items_assign_line_number
BEFORE INSERT ON public.supplier_delivery_items
FOR EACH ROW EXECUTE FUNCTION public.assign_supplier_delivery_line_number();

ALTER FUNCTION public.dashboard_record_supplier_delivery(
  uuid, text, text, jsonb, uuid, text, text, text, text, integer, integer, integer, text
) RENAME TO dashboard_record_supplier_delivery_legacy;

CREATE FUNCTION public.dashboard_record_supplier_delivery(
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
  v_delivery_id uuid;
  v_item record;
  v_item_id uuid;
  v_product_tracks_expiry boolean;
  v_expiry date;
  v_lot_code text;
  v_lot_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- The legacy RPC performs ordinary receipt work first. Defer only the lot
  -- balance write until this wrapper has attached metadata to each line.
  PERFORM set_config('app.supplier_delivery_metadata_pending', 'on', true);
  v_delivery_id := public.dashboard_record_supplier_delivery_legacy(
    p_branch_id,
    p_supplier_name,
    p_reference_code,
    p_items,
    p_supplier_id,
    p_supplier_phone,
    p_supplier_email,
    p_supplier_contact_person,
    p_supplier_notes,
    p_price_rating,
    p_stock_quality_rating,
    p_availability_rating,
    p_rating_note
  );

  FOR v_item IN
    SELECT item_value AS item_json, item_ordinality::integer AS line_number,
           (item_value->>'productId')::uuid AS product_id
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS items(item_value, item_ordinality)
  LOOP
    SELECT p.tracks_expiry
      INTO v_product_tracks_expiry
      FROM public.products p
     WHERE p.id = v_item.product_id
       AND p.business_id = public.get_my_business_id();

    v_expiry := NULLIF(v_item.item_json->>'expiresOn', '')::date;
    v_lot_code := NULLIF(btrim(v_item.item_json->>'supplierLotCode'), '');

    IF COALESCE(v_product_tracks_expiry, false) AND v_expiry IS NULL THEN
      RAISE EXCEPTION 'An expiry date is required for this product';
    END IF;

    UPDATE public.supplier_delivery_items
       SET expires_on = v_expiry,
           supplier_lot_code = v_lot_code
     WHERE delivery_id = v_delivery_id
       AND line_number = v_item.line_number
       AND product_id = v_item.product_id
    RETURNING id INTO v_item_id;

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Unable to match a supplier delivery line to its batch details';
    END IF;

    INSERT INTO public.inventory_lots (
      business_id, product_id, supplier_lot_code, received_at,
      expires_on, is_untracked_legacy, source_delivery_item_id
    )
    VALUES (
      public.get_my_business_id(), v_item.product_id, v_lot_code, now(),
      v_expiry, false, v_item_id
    )
    RETURNING id INTO v_lot_id;

    UPDATE public.supplier_delivery_items
       SET inventory_lot_id = v_lot_id
     WHERE id = v_item_id;
  END LOOP;

  PERFORM set_config('app.supplier_delivery_metadata_pending', 'off', true);

  IF EXISTS (
    SELECT 1 FROM public.supplier_deliveries
     WHERE id = v_delivery_id AND status = 'received'
  ) THEN
    PERFORM public.add_supplier_delivery_lot_stock(v_delivery_id);
  END IF;

  RETURN v_delivery_id;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_record_supplier_delivery(
  uuid, text, text, jsonb, uuid, text, text, text, text, integer, integer, integer, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_record_supplier_delivery(
  uuid, text, text, jsonb, uuid, text, text, text, text, integer, integer, integer, text
) TO authenticated;
REVOKE ALL ON FUNCTION public.dashboard_record_supplier_delivery_legacy(
  uuid, text, text, jsonb, uuid, text, text, text, text, integer, integer, integer, text
) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.add_supplier_delivery_lot_stock(p_delivery_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery public.supplier_deliveries%ROWTYPE;
  v_item record;
  v_lot_id uuid;
BEGIN
  SELECT * INTO v_delivery FROM public.supplier_deliveries WHERE id = p_delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery not found'; END IF;

  FOR v_item IN
    SELECT product_id, inventory_lot_id,
           COALESCE(NULLIF(base_quantity_received, 0), quantity_received)::numeric(12,4) AS base_quantity
      FROM public.supplier_delivery_items
     WHERE delivery_id = p_delivery_id AND business_id = v_delivery.business_id
  LOOP
    v_lot_id := v_item.inventory_lot_id;
    IF v_lot_id IS NULL THEN
      -- Deliveries that were already awaiting approval at migration time have
      -- no batch metadata. Preserve their stock as explicitly untracked.
      INSERT INTO public.inventory_lots (business_id, product_id, is_untracked_legacy)
      VALUES (v_delivery.business_id, v_item.product_id, true)
      ON CONFLICT (business_id, product_id) WHERE is_untracked_legacy
      DO UPDATE SET product_id = EXCLUDED.product_id
      RETURNING id INTO v_lot_id;

      UPDATE public.supplier_delivery_items
         SET inventory_lot_id = v_lot_id
       WHERE delivery_id = p_delivery_id
         AND product_id = v_item.product_id
         AND inventory_lot_id IS NULL;
    END IF;
    INSERT INTO public.branch_lot_stock (
      business_id, branch_id, product_id, lot_id, base_quantity_on_hand
    ) VALUES (
      v_delivery.business_id, v_delivery.to_branch_id, v_item.product_id,
      v_lot_id, v_item.base_quantity
    )
    ON CONFLICT (branch_id, lot_id)
    DO UPDATE SET
      base_quantity_on_hand = public.branch_lot_stock.base_quantity_on_hand + EXCLUDED.base_quantity_on_hand,
      updated_at = now();
  END LOOP;
END;
$$;

ALTER FUNCTION public.apply_supplier_delivery_stock(uuid, uuid)
  RENAME TO apply_supplier_delivery_stock_legacy;

CREATE FUNCTION public.apply_supplier_delivery_stock(p_delivery_id uuid, p_actor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery public.supplier_deliveries%ROWTYPE;
  v_item record;
  v_previous_metadata_flag text;
BEGIN
  v_previous_metadata_flag := current_setting('app.supplier_delivery_metadata_pending', true);
  PERFORM set_config('app.supplier_delivery_metadata_pending', 'on', true);
  PERFORM public.apply_supplier_delivery_stock_legacy(p_delivery_id, p_actor_id);
  PERFORM set_config('app.supplier_delivery_metadata_pending', COALESCE(v_previous_metadata_flag, 'off'), true);
  IF COALESCE(v_previous_metadata_flag, 'off') <> 'on' THEN
    PERFORM public.add_supplier_delivery_lot_stock(p_delivery_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_supplier_delivery_stock(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_supplier_delivery_stock_legacy(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_supplier_delivery_lot_stock(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.product_expiry_alerts
WITH (security_invoker = true) AS
SELECT bls.business_id,
       bls.branch_id,
       bls.product_id,
       p.name AS product_name,
       p.sku,
       lot.id AS lot_id,
       lot.supplier_lot_code,
       lot.received_at::date AS received_on,
       lot.expires_on,
       bls.base_quantity_on_hand,
       (lot.expires_on - current_date) AS days_remaining,
       CASE WHEN lot.expires_on < current_date THEN 'expired' ELSE 'expiring_soon' END AS alert_status
  FROM public.branch_lot_stock bls
  JOIN public.inventory_lots lot
    ON lot.id = bls.lot_id
   AND lot.business_id = bls.business_id
   AND lot.product_id = bls.product_id
  JOIN public.products p
    ON p.id = bls.product_id
   AND p.business_id = bls.business_id
 WHERE p.tracks_expiry
   AND NOT lot.is_untracked_legacy
   AND lot.expires_on IS NOT NULL
   AND bls.base_quantity_on_hand > 0
   AND (lot.expires_on < current_date OR
        (lot.expires_on - current_date)::numeric <=
        GREATEST((lot.expires_on - lot.received_at::date)::numeric * 0.25, 1));
