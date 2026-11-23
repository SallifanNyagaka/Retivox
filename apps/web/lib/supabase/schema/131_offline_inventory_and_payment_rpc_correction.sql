-- Repair the public payment-instructions RPC type mismatch and make offline
-- stock adjustments and supplier deliveries idempotent across network retries.

DROP FUNCTION IF EXISTS public.business_public_payment_methods();

CREATE FUNCTION public.business_public_payment_methods()
RETURNS TABLE (
  id uuid,
  method_code text,
  account_type text,
  display_name text,
  merchant_number text,
  account_reference text,
  instructions text,
  is_active boolean,
  is_default boolean,
  configuration_version bigint,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_business_id uuid := public.get_my_business_id();
  v_role text := public.get_my_global_role();
BEGIN
  IF auth.uid() IS NULL OR v_business_id IS NULL OR v_role NOT IN ('owner', 'admin', 'employee') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users AS app_user
     WHERE app_user.id = auth.uid()
       AND app_user.business_id = v_business_id
       AND app_user.is_active
       AND app_user.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT method.id,
         method.method_code,
         method.account_type,
         method.display_name,
         method.merchant_number,
         method.account_reference,
         method.instructions,
         method.is_active,
         method.is_default,
         method.configuration_version,
         method.updated_at
    FROM public.business_payment_methods AS method
   WHERE method.business_id = v_business_id
     AND method.is_active
   ORDER BY method.is_default DESC, method.updated_at DESC, method.id;
END;
$$;

REVOKE ALL ON FUNCTION public.business_public_payment_methods() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_public_payment_methods() TO authenticated;

-- This ledger is intentionally inaccessible through the Data API. The
-- SECURITY DEFINER wrappers retain the existing RPC authorization checks and
-- commit the receipt in the same transaction as the inventory mutation.
CREATE TABLE IF NOT EXISTS public.dashboard_mutation_requests (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('supplier_delivery', 'stock_adjustment')),
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, actor_id, request_id)
);
ALTER TABLE public.dashboard_mutation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dashboard_mutation_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.dashboard_mutation_requests TO service_role;

CREATE OR REPLACE FUNCTION public.dashboard_record_supplier_delivery_idempotent_v1(
  p_request_id uuid,
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
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
  v_payload jsonb;
  v_existing public.dashboard_mutation_requests%ROWTYPE;
  v_delivery_id uuid;
BEGIN
  IF v_actor_id IS NULL OR v_business_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  v_payload := jsonb_build_object(
    'branch_id', p_branch_id,
    'supplier_name', p_supplier_name,
    'reference_code', p_reference_code,
    'items', p_items,
    'supplier_id', p_supplier_id,
    'supplier_phone', p_supplier_phone,
    'supplier_email', p_supplier_email,
    'supplier_contact_person', p_supplier_contact_person,
    'supplier_notes', p_supplier_notes,
    'price_rating', p_price_rating,
    'stock_quality_rating', p_stock_quality_rating,
    'availability_rating', p_availability_rating,
    'rating_note', p_rating_note
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_business_id::text || ':' || v_actor_id::text || ':' || p_request_id::text, 0)
  );
  SELECT * INTO v_existing
    FROM public.dashboard_mutation_requests
   WHERE business_id = v_business_id AND actor_id = v_actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.action_type <> 'supplier_delivery' OR v_existing.request_payload <> v_payload THEN
      RAISE EXCEPTION 'Saved request ID was already used with different delivery details';
    END IF;
    RETURN (v_existing.result->>'delivery_id')::uuid;
  END IF;

  v_delivery_id := public.dashboard_record_supplier_delivery(
    p_branch_id, p_supplier_name, p_reference_code, p_items, p_supplier_id,
    p_supplier_phone, p_supplier_email, p_supplier_contact_person, p_supplier_notes,
    p_price_rating, p_stock_quality_rating, p_availability_rating, p_rating_note
  );
  INSERT INTO public.dashboard_mutation_requests(
    business_id, actor_id, request_id, action_type, request_payload, result
  ) VALUES (
    v_business_id, v_actor_id, p_request_id, 'supplier_delivery', v_payload,
    jsonb_build_object('delivery_id', v_delivery_id)
  );
  RETURN v_delivery_id;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_record_supplier_delivery_idempotent_v1(uuid,uuid,text,text,jsonb,uuid,text,text,text,text,integer,integer,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_record_supplier_delivery_idempotent_v1(uuid,uuid,text,text,jsonb,uuid,text,text,text,text,integer,integer,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_adjust_stock_idempotent_v1(
  p_request_id uuid,
  p_stock_id uuid,
  p_quantity integer,
  p_operation text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
  v_payload jsonb;
  v_existing public.dashboard_mutation_requests%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR v_business_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  v_payload := jsonb_build_object(
    'stock_id', p_stock_id,
    'quantity', p_quantity,
    'operation', p_operation
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_business_id::text || ':' || v_actor_id::text || ':' || p_request_id::text, 0)
  );
  SELECT * INTO v_existing
    FROM public.dashboard_mutation_requests
   WHERE business_id = v_business_id AND actor_id = v_actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.action_type <> 'stock_adjustment' OR v_existing.request_payload <> v_payload THEN
      RAISE EXCEPTION 'Saved request ID was already used with different stock adjustment details';
    END IF;
    RETURN true;
  END IF;

  PERFORM public.dashboard_adjust_stock(p_stock_id, p_quantity, p_operation);
  INSERT INTO public.dashboard_mutation_requests(
    business_id, actor_id, request_id, action_type, request_payload, result
  ) VALUES (
    v_business_id, v_actor_id, p_request_id, 'stock_adjustment', v_payload,
    jsonb_build_object('applied', true)
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_adjust_stock_idempotent_v1(uuid,uuid,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_adjust_stock_idempotent_v1(uuid,uuid,integer,text) TO authenticated;
