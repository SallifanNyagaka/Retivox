ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS is_credit_sale boolean NOT NULL DEFAULT false;

UPDATE public.transactions AS transaction_row
   SET is_credit_sale = true
 WHERE EXISTS (
         SELECT 1 FROM public.receivable_accounts AS account
          WHERE account.transaction_id = transaction_row.id
       )
    OR EXISTS (
         SELECT 1 FROM public.audit_logs AS audit
          WHERE audit.entity_type = 'transaction'
            AND audit.entity_id = transaction_row.id
            AND audit.action = 'credit_sale_payment_recorded'
       );

CREATE OR REPLACE FUNCTION public.mark_transaction_as_credit_sale()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.transactions AS transaction_row
     SET is_credit_sale = true
   WHERE transaction_row.id = NEW.transaction_id
     AND transaction_row.business_id = NEW.business_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mark_transaction_as_credit_sale ON public.receivable_accounts;
CREATE TRIGGER mark_transaction_as_credit_sale
AFTER INSERT OR UPDATE ON public.receivable_accounts
FOR EACH ROW EXECUTE FUNCTION public.mark_transaction_as_credit_sale();
REVOKE ALL ON FUNCTION public.mark_transaction_as_credit_sale() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS local_id text;
CREATE UNIQUE INDEX IF NOT EXISTS payments_business_local_id_unique
  ON public.payments (business_id, local_id)
  WHERE local_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_receivable_payment_v2(
  p_receivable_id uuid,
  p_payment_method text,
  p_amount numeric,
  p_amount_tendered numeric DEFAULT NULL,
  p_reference_code text DEFAULT NULL,
  p_local_id text DEFAULT NULL
)
RETURNS TABLE(payment_id uuid, balance_due numeric, change_given numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_id uuid := public.get_my_business_id();
  v_actor uuid := auth.uid();
  v_existing_id uuid;
  v_result record;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(COALESCE(p_local_id, '')), '') IS NULL OR length(p_local_id) > 128 THEN
    RAISE EXCEPTION 'A valid local payment id is required';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_business_id::text || ':receivable:' || p_local_id, 0)
  );

  SELECT payment.id INTO v_existing_id
    FROM public.payments AS payment
   WHERE payment.business_id = v_business_id
     AND payment.local_id = p_local_id
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    SELECT greatest(transaction_row.total_amount - COALESCE((
             SELECT SUM(all_payments.amount)
               FROM public.payments AS all_payments
              WHERE all_payments.transaction_id = transaction_row.id
                AND all_payments.business_id = v_business_id
                AND all_payments.status <> 'rejected'
           ), 0), 0), existing_payment.change_given
      INTO balance_due, change_given
      FROM public.payments AS existing_payment
      JOIN public.transactions AS transaction_row
        ON transaction_row.id = existing_payment.transaction_id
       AND transaction_row.business_id = existing_payment.business_id
     WHERE existing_payment.id = v_existing_id;
    payment_id := v_existing_id;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_result
    FROM public.record_receivable_payment(
      p_receivable_id,
      p_payment_method,
      p_amount,
      p_amount_tendered,
      p_reference_code
    );

  UPDATE public.payments AS payment
     SET local_id = p_local_id
   WHERE payment.id = v_result.payment_id
     AND payment.business_id = v_business_id;

  RETURN QUERY SELECT v_result.payment_id, v_result.balance_due, v_result.change_given;
END;
$$;

REVOKE ALL ON FUNCTION public.record_receivable_payment_v2(uuid, text, numeric, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_receivable_payment_v2(uuid, text, numeric, numeric, text, text) TO authenticated;
