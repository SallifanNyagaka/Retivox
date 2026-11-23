-- Bind a manual-payment instruction profile to the exact payment rows created
-- by a sale. The instruction snapshot is public merchant data only; secrets
-- are never stored on a sale or returned to a client.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS business_payment_method_id uuid
    REFERENCES public.business_payment_methods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_method_snapshot jsonb;

CREATE INDEX IF NOT EXISTS idx_payments_business_payment_method
  ON public.payments (business_payment_method_id)
  WHERE business_payment_method_id IS NOT NULL;

-- Payment settings are editable. Retain public, non-secret versions so a sale
-- queued offline can still refer to the exact instructions shown at checkout.
CREATE TABLE IF NOT EXISTS public.business_payment_method_versions (
  business_payment_method_id uuid NOT NULL REFERENCES public.business_payment_methods(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  configuration_version bigint NOT NULL,
  payment_method_snapshot jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_payment_method_id, configuration_version)
);
ALTER TABLE public.business_payment_method_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_payment_method_versions FROM PUBLIC, anon, authenticated;

INSERT INTO public.business_payment_method_versions(
  business_payment_method_id, business_id, configuration_version, payment_method_snapshot
)
SELECT method.id, method.business_id, method.configuration_version,
       jsonb_build_object(
         'id', method.id, 'configuration_version', method.configuration_version,
         'method_code', method.method_code, 'account_type', method.account_type,
         'display_name', method.display_name, 'merchant_number', method.merchant_number,
         'account_reference', method.account_reference, 'instructions', method.instructions
       )
  FROM public.business_payment_methods AS method
ON CONFLICT (business_payment_method_id, configuration_version) DO NOTHING;

CREATE OR REPLACE FUNCTION public.archive_business_payment_method_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.configuration_version IS DISTINCT FROM NEW.configuration_version THEN
    INSERT INTO public.business_payment_method_versions(
      business_payment_method_id, business_id, configuration_version, payment_method_snapshot
    ) VALUES (
      OLD.id, OLD.business_id, OLD.configuration_version,
      jsonb_build_object(
        'id', OLD.id, 'configuration_version', OLD.configuration_version,
        'method_code', OLD.method_code, 'account_type', OLD.account_type,
        'display_name', OLD.display_name, 'merchant_number', OLD.merchant_number,
        'account_reference', OLD.account_reference, 'instructions', OLD.instructions
      )
    ) ON CONFLICT (business_payment_method_id, configuration_version) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.archive_business_payment_method_version() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS archive_business_payment_method_version ON public.business_payment_methods;
CREATE TRIGGER archive_business_payment_method_version
BEFORE UPDATE OF configuration_version ON public.business_payment_methods
FOR EACH ROW EXECUTE FUNCTION public.archive_business_payment_method_version();

-- Internal helper. Caller identity and the payment's business are checked
-- here, even though the sale RPCs also perform their own role/branch checks.
CREATE OR REPLACE FUNCTION public.attach_sale_manual_payment_method(
  p_transaction_id uuid,
  p_method_id uuid,
  p_configuration_version bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
  v_method public.business_payment_methods%ROWTYPE;
  v_snapshot jsonb;
  v_payment record;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL OR p_transaction_id IS NULL OR p_method_id IS NULL THEN
    RAISE EXCEPTION 'Invalid sale payment method association' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users AS app_user
     WHERE app_user.id = v_actor
       AND app_user.business_id = v_business_id
       AND app_user.is_active
       AND app_user.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.transactions AS sale
     WHERE sale.id = p_transaction_id
       AND sale.business_id = v_business_id
       AND sale.employee_id = v_actor
  ) THEN
    RAISE EXCEPTION 'Sale does not belong to the current operator and business' USING ERRCODE = '42501';
  END IF;

  SELECT method.* INTO v_method
    FROM public.business_payment_methods AS method
   WHERE method.id = p_method_id
     AND method.business_id = v_business_id
     AND method.method_code = 'mpesa_manual';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manual payment instructions are unavailable for this business';
  END IF;

  IF p_configuration_version IS NULL OR p_configuration_version = v_method.configuration_version THEN
    v_snapshot := jsonb_build_object(
      'id', v_method.id,
      'configuration_version', v_method.configuration_version,
      'method_code', v_method.method_code,
      'account_type', v_method.account_type,
      'display_name', v_method.display_name,
      'merchant_number', v_method.merchant_number,
      'account_reference', v_method.account_reference,
      'instructions', v_method.instructions
    );
  ELSE
    SELECT history.payment_method_snapshot INTO v_snapshot
      FROM public.business_payment_method_versions AS history
     WHERE history.business_payment_method_id = p_method_id
       AND history.business_id = v_business_id
       AND history.configuration_version = p_configuration_version;
    IF v_snapshot IS NULL THEN
      RAISE EXCEPTION 'The saved manual payment instructions version is unavailable. Keep the sale queued and contact the business owner.';
    END IF;
  END IF;

  FOR v_payment IN
    SELECT payment.id, payment.business_payment_method_id
      FROM public.payments AS payment
     WHERE payment.transaction_id = p_transaction_id
       AND payment.business_id = v_business_id
       AND payment.payment_method = 'mpesa_manual'
       AND COALESCE(payment.reference_code, payment.mpesa_ref_code, '') NOT LIKE 'STK-PENDING:%'
       AND COALESCE(payment.reference_code, payment.mpesa_ref_code, '') NOT LIKE 'PESAPAL-PENDING:%'
     FOR UPDATE
  LOOP
    IF v_payment.business_payment_method_id IS NOT NULL
       AND v_payment.business_payment_method_id IS DISTINCT FROM p_method_id THEN
      RAISE EXCEPTION 'Sale retry used different manual payment instructions';
    END IF;
    IF v_payment.business_payment_method_id = p_method_id THEN
      CONTINUE;
    END IF;

    UPDATE public.payments AS payment
       SET business_payment_method_id = p_method_id,
           payment_method_snapshot = v_snapshot
     WHERE payment.id = v_payment.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_sale_manual_payment_method(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;

-- Online Web sales. The existing idempotent RPC performs all stock, payment,
-- receivable and audit writes; the profile association runs in this same SQL
-- transaction and therefore rolls everything back on any association error.
CREATE OR REPLACE FUNCTION public.employee_record_transaction_with_payment_method_v1(
  p_request_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_amount_paid numeric,
  p_amount_tendered numeric,
  p_discount_amount numeric,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_reference_code text,
  p_due_date date,
  p_is_credit boolean,
  p_split_payments jsonb,
  p_manual_payment_method_id uuid,
  p_manual_payment_method_version bigint
)
RETURNS TABLE(transaction_id uuid, status text, recorded_at timestamptz, total_amount numeric, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result record;
BEGIN
  SELECT * INTO v_result FROM public.employee_record_transaction_idempotent_v1(
    p_request_id, p_items, p_payment_method, p_amount_paid, p_amount_tendered,
    p_discount_amount, p_customer_name, p_customer_phone, p_customer_email,
    p_reference_code, p_due_date, p_is_credit, p_split_payments
  );
  IF p_manual_payment_method_id IS NOT NULL THEN
    PERFORM public.attach_sale_manual_payment_method(v_result.transaction_id, p_manual_payment_method_id, p_manual_payment_method_version);
  END IF;
  RETURN QUERY SELECT v_result.transaction_id, v_result.status, v_result.recorded_at,
                      v_result.total_amount, v_result.replayed;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_record_transaction_with_payment_method_v1(
  p_request_id uuid,
  p_branch_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_amount_paid numeric,
  p_amount_tendered numeric,
  p_discount_amount numeric,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_reference_code text,
  p_due_date date,
  p_is_credit boolean,
  p_split_payments jsonb,
  p_manual_payment_method_id uuid,
  p_manual_payment_method_version bigint
)
RETURNS TABLE(transaction_id uuid, status text, recorded_at timestamptz, total_amount numeric, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result record;
BEGIN
  SELECT * INTO v_result FROM public.dashboard_record_transaction_idempotent_v1(
    p_request_id, p_branch_id, p_items, p_payment_method, p_amount_paid,
    p_amount_tendered, p_discount_amount, p_customer_name, p_customer_phone,
    p_customer_email, p_reference_code, p_due_date, p_is_credit, p_split_payments
  );
  IF p_manual_payment_method_id IS NOT NULL THEN
    PERFORM public.attach_sale_manual_payment_method(v_result.transaction_id, p_manual_payment_method_id, p_manual_payment_method_version);
  END IF;
  RETURN QUERY SELECT v_result.transaction_id, v_result.status, v_result.recorded_at,
                      v_result.total_amount, v_result.replayed;
END;
$$;

-- Offline app/PWA sales use the stable local ID for idempotency. A payment
-- method ID captured alongside the locally cached instruction config follows
-- the sale through sync and is validated against the operator's own business.
CREATE OR REPLACE FUNCTION public.employee_record_transaction_offline_with_payment_method_v1(
  p_items jsonb,
  p_payment_method text,
  p_amount_paid numeric,
  p_amount_tendered numeric,
  p_discount_amount numeric,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_reference_code text,
  p_due_date date,
  p_is_credit boolean,
  p_recorded_at timestamptz,
  p_local_id text,
  p_manual_payment_method_id uuid,
  p_manual_payment_method_version bigint
)
RETURNS TABLE(transaction_id uuid, status text, recorded_at timestamptz, total_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result record;
BEGIN
  SELECT * INTO v_result FROM public.employee_record_transaction_offline_v2(
    p_items, p_payment_method, p_amount_paid, p_amount_tendered, p_discount_amount,
    p_customer_name, p_customer_phone, p_customer_email, p_reference_code,
    p_due_date, p_is_credit, p_recorded_at, p_local_id
  );
  IF p_manual_payment_method_id IS NOT NULL THEN
    PERFORM public.attach_sale_manual_payment_method(v_result.transaction_id, p_manual_payment_method_id, p_manual_payment_method_version);
  END IF;
  RETURN QUERY SELECT v_result.transaction_id, v_result.status, v_result.recorded_at,
                      v_result.total_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_record_transaction_offline_with_payment_method_v1(
  p_branch_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_amount_paid numeric,
  p_amount_tendered numeric,
  p_discount_amount numeric,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_reference_code text,
  p_due_date date,
  p_is_credit boolean,
  p_recorded_at timestamptz,
  p_local_id text,
  p_manual_payment_method_id uuid,
  p_manual_payment_method_version bigint
)
RETURNS TABLE(transaction_id uuid, status text, recorded_at timestamptz, total_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result record;
BEGIN
  SELECT * INTO v_result FROM public.dashboard_record_transaction_offline_v2(
    p_branch_id, p_items, p_payment_method, p_amount_paid, p_amount_tendered,
    p_discount_amount, p_customer_name, p_customer_phone, p_customer_email,
    p_reference_code, p_due_date, p_is_credit, p_recorded_at, p_local_id
  );
  IF p_manual_payment_method_id IS NOT NULL THEN
    PERFORM public.attach_sale_manual_payment_method(v_result.transaction_id, p_manual_payment_method_id, p_manual_payment_method_version);
  END IF;
  RETURN QUERY SELECT v_result.transaction_id, v_result.status, v_result.recorded_at,
                      v_result.total_amount;
END;
$$;

REVOKE ALL ON FUNCTION public.employee_record_transaction_with_payment_method_v1(uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,jsonb,uuid,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_record_transaction_with_payment_method_v1(uuid,uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,jsonb,uuid,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employee_record_transaction_offline_with_payment_method_v1(jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,timestamptz,text,uuid,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_record_transaction_offline_with_payment_method_v1(uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,timestamptz,text,uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_record_transaction_with_payment_method_v1(uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,jsonb,uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_record_transaction_with_payment_method_v1(uuid,uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,jsonb,uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_record_transaction_offline_with_payment_method_v1(jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,timestamptz,text,uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_record_transaction_offline_with_payment_method_v1(uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,timestamptz,text,uuid,bigint) TO authenticated;
