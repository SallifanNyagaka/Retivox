-- Manual M-PESA references are claims for review, never proof of settlement.
-- Keep confirmation and transaction-state changes inside one database transaction.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS verification_source text,
  ADD COLUMN IF NOT EXISTS verification_note text;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_verification_source_valid;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_verification_source_valid
  CHECK (
    verification_source IS NULL OR verification_source IN (
      'mpesa_statement', 'merchant_portal', 'provider_callback', 'other_evidence'
    )
  );
ALTER TABLE public.payments
  ADD CONSTRAINT payments_verification_note_length
  CHECK (verification_note IS NULL OR length(btrim(verification_note)) BETWEEN 5 AND 1000);

-- M-PESA receipt references are business-scoped and can only be allocated once.
CREATE UNIQUE INDEX IF NOT EXISTS payments_business_mpesa_reference_unique
  ON public.payments (
    business_id,
    upper(btrim(COALESCE(mpesa_ref_code, reference_code)))
  )
  WHERE payment_method = 'mpesa_manual'
    AND NULLIF(btrim(COALESCE(mpesa_ref_code, reference_code)), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_manual_payment_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_method = 'mpesa_manual'
     AND NEW.status = 'verified'
     AND COALESCE(current_setting('retivox.allow_manual_payment_verification', true), 'off') <> 'on'
  THEN
    NEW.status := 'pending_verify';
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
    NEW.verification_source := NULL;
    NEW.verification_note := NULL;
    NEW.reconciliation_status := 'needs_review';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_manual_payment_review() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_manual_payment_review ON public.payments;
CREATE TRIGGER enforce_manual_payment_review
  BEFORE INSERT OR UPDATE OF payment_method, status, verified_by, verified_at
  ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_manual_payment_review();

CREATE OR REPLACE FUNCTION public.mark_manual_payment_transaction_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_method = 'mpesa_manual' AND NEW.status = 'pending_verify' THEN
    UPDATE public.transactions
       SET status = 'pending_verify'
     WHERE id = NEW.transaction_id
       AND business_id = NEW.business_id
       AND status <> 'voided';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_manual_payment_transaction_pending() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mark_manual_payment_transaction_pending ON public.payments;
CREATE TRIGGER mark_manual_payment_transaction_pending
  AFTER INSERT OR UPDATE OF payment_method, status
  ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.mark_manual_payment_transaction_pending();

CREATE OR REPLACE FUNCTION public.prevent_unverified_manual_sale_success()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('verified', 'synced')
     AND EXISTS (
       SELECT 1
         FROM public.payments AS payment
        WHERE payment.transaction_id = NEW.id
          AND payment.business_id = NEW.business_id
          AND payment.payment_method = 'mpesa_manual'
          AND payment.status = 'pending_verify'
     )
  THEN
    NEW.status := 'pending_verify';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_unverified_manual_sale_success() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_unverified_manual_sale_success ON public.transactions;
CREATE TRIGGER prevent_unverified_manual_sale_success
  BEFORE INSERT OR UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unverified_manual_sale_success();

-- Receivable balances include confirmed payments only. A submitted manual
-- reference cannot reduce a customer's balance until an owner verifies it.
CREATE OR REPLACE VIEW public.receivable_account_balances
WITH (security_invoker = true)
AS
SELECT ra.id, ra.business_id, ra.branch_id, ra.transaction_id, ra.customer_id,
       ra.due_date, ra.created_by, ra.created_at,
       c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
       b.name AS branch_name, t.total_amount,
       COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'verified'), 0)::numeric(10,2) AS amount_paid,
       GREATEST(t.total_amount - COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'verified'), 0), 0)::numeric(10,2) AS balance_due,
       CASE WHEN COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'verified'), 0) >= t.total_amount THEN 'paid'
            WHEN ra.due_date < CURRENT_DATE THEN 'overdue'
            WHEN COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'verified'), 0) > 0 THEN 'partial'
            ELSE 'open' END AS account_status
  FROM public.receivable_accounts ra
  JOIN public.customers c ON c.id = ra.customer_id AND c.business_id = ra.business_id
  JOIN public.branches b ON b.id = ra.branch_id AND b.business_id = ra.business_id
  JOIN public.transactions t ON t.id = ra.transaction_id AND t.business_id = ra.business_id
  LEFT JOIN public.payments p ON p.transaction_id = ra.transaction_id AND p.business_id = ra.business_id
 GROUP BY ra.id, c.id, b.id, t.id;

CREATE OR REPLACE FUNCTION public.record_receivable_payment(
  p_receivable_id uuid,
  p_payment_method text,
  p_amount numeric,
  p_amount_tendered numeric DEFAULT NULL,
  p_reference_code text DEFAULT NULL
)
RETURNS TABLE(payment_id uuid, balance_due numeric, change_given numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid := public.get_my_business_id();
  v_actor uuid := auth.uid();
  v_account public.receivable_accounts%ROWTYPE;
  v_total numeric(10,2);
  v_paid numeric(10,2);
  v_reserved numeric(10,2);
  v_balance numeric(10,2);
  v_status text;
  v_verified_by uuid;
  v_verified_at timestamptz;
  v_payment_id uuid;
  v_change numeric(10,2) := 0;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_payment_method NOT IN ('cash','mpesa_manual','card','bank_transfer','other') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount greater than zero';
  END IF;
  IF p_payment_method = 'mpesa_manual'
     AND length(btrim(COALESCE(p_reference_code, ''))) < 5 THEN
    RAISE EXCEPTION 'Enter a valid M-Pesa reference code';
  END IF;

  SELECT * INTO v_account
    FROM public.receivable_accounts
   WHERE id = p_receivable_id AND business_id = v_business_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Credit account not found'; END IF;

  IF public.get_my_global_role() <> 'owner'
     AND public.branch_role_rank(public.get_effective_branch_role(v_actor, v_account.branch_id))
         < public.branch_role_rank('employee') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT total_amount INTO v_total
    FROM public.transactions
   WHERE id = v_account.transaction_id AND business_id = v_business_id
   FOR UPDATE;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.payments
   WHERE transaction_id = v_account.transaction_id
     AND business_id = v_business_id
     AND status = 'verified';

  SELECT COALESCE(SUM(amount), 0) INTO v_reserved
    FROM public.payments
   WHERE transaction_id = v_account.transaction_id
     AND business_id = v_business_id
     AND status IN ('pending', 'pending_verify');

  v_balance := greatest(v_total - v_paid, 0);
  IF p_amount > greatest(v_balance - v_reserved, 0) THEN
    RAISE EXCEPTION 'Payment exceeds the unreserved outstanding balance of %', greatest(v_balance - v_reserved, 0);
  END IF;

  IF p_payment_method = 'cash' THEN
    IF COALESCE(p_amount_tendered, p_amount) < p_amount THEN
      RAISE EXCEPTION 'Cash received must cover the amount applied';
    END IF;
    v_change := COALESCE(p_amount_tendered, p_amount) - p_amount;
  END IF;

  IF public.get_my_global_role() = 'owner' AND p_payment_method <> 'mpesa_manual' THEN
    v_status := 'verified';
    v_verified_by := v_actor;
    v_verified_at := now();
  ELSE
    v_status := 'pending_verify';
  END IF;

  INSERT INTO public.payments (
    transaction_id, business_id, payment_method, amount, status,
    amount_tendered, change_given, reference_code, mpesa_ref_code,
    verified_by, verified_at, payment_at, verification_source, verification_note
  ) VALUES (
    v_account.transaction_id, v_business_id, p_payment_method, p_amount, v_status,
    CASE WHEN p_payment_method = 'cash' THEN COALESCE(p_amount_tendered, p_amount) ELSE p_amount END,
    v_change,
    CASE WHEN p_payment_method = 'cash' THEN NULL ELSE NULLIF(btrim(p_reference_code), '') END,
    CASE WHEN p_payment_method = 'mpesa_manual' THEN NULLIF(btrim(p_reference_code), '') ELSE NULL END,
    v_verified_by, v_verified_at, now(), NULL, NULL
  ) RETURNING id INTO v_payment_id;

  INSERT INTO public.audit_logs (
    business_id, actor_id, entity_type, entity_id, action, old_value, new_value
  ) VALUES (
    v_business_id, v_actor, 'payment', v_payment_id, 'receivable_payment_recorded',
    jsonb_build_object('balance_due', v_balance),
    jsonb_build_object(
      'transaction_id', v_account.transaction_id,
      'payment_method', p_payment_method,
      'amount', p_amount,
      'status', v_status,
      'balance_due', CASE WHEN v_status = 'verified' THEN greatest(v_balance - p_amount, 0) ELSE v_balance END
    )
  );

  RETURN QUERY SELECT v_payment_id,
    CASE WHEN v_status = 'verified' THEN greatest(v_balance - p_amount, 0) ELSE v_balance END,
    v_change;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_receivable_payment_v2(
  p_receivable_id uuid,
  p_payment_method text,
  p_amount numeric,
  p_amount_tendered numeric DEFAULT NULL,
  p_reference_code text DEFAULT NULL,
  p_local_id text DEFAULT NULL
)
RETURNS TABLE(payment_id uuid, balance_due numeric, change_given numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid := public.get_my_business_id();
  v_actor uuid := auth.uid();
  v_existing_id uuid;
  v_result record;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_local_id, '')), '') IS NULL OR length(p_local_id) > 128 THEN
    RAISE EXCEPTION 'A valid local payment id is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':receivable:' || p_local_id, 0));

  SELECT payment.id INTO v_existing_id
    FROM public.payments AS payment
   WHERE payment.business_id = v_business_id AND payment.local_id = p_local_id
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    SELECT greatest(transaction_row.total_amount - COALESCE((
             SELECT SUM(all_payments.amount)
               FROM public.payments AS all_payments
              WHERE all_payments.transaction_id = transaction_row.id
                AND all_payments.business_id = v_business_id
                AND all_payments.status = 'verified'
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

  SELECT * INTO v_result FROM public.record_receivable_payment(
    p_receivable_id, p_payment_method, p_amount, p_amount_tendered, p_reference_code
  );

  UPDATE public.payments
     SET local_id = p_local_id
   WHERE id = v_result.payment_id AND business_id = v_business_id;

  RETURN QUERY SELECT v_result.payment_id, v_result.balance_due, v_result.change_given;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_verify_payment_v2(
  p_payment_id uuid,
  p_action text,
  p_evidence_source text DEFAULT NULL,
  p_evidence_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid := public.get_my_business_id();
  v_actor_id uuid := auth.uid();
  v_payment public.payments%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_next_status text;
  v_next_transaction_status text;
  v_verified_at timestamptz;
  v_verified_total numeric(10,2);
  v_has_pending boolean;
  v_has_rejected boolean;
BEGIN
  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'Invalid payment action'; END IF;

  SELECT * INTO v_payment
    FROM public.payments
   WHERE id = p_payment_id AND business_id = v_business_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_payment.status <> 'pending_verify' THEN
    RAISE EXCEPTION 'Only pending verification payments can be updated';
  END IF;

  SELECT * INTO v_transaction
    FROM public.transactions
   WHERE id = v_payment.transaction_id AND business_id = v_business_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;

  IF v_payment.payment_method = 'mpesa_manual' THEN
    IF p_action = 'approve' AND p_evidence_source NOT IN (
      'mpesa_statement', 'merchant_portal', 'provider_callback', 'other_evidence'
    ) THEN
      RAISE EXCEPTION 'Select the source used to independently verify this M-PESA payment';
    END IF;
    IF length(btrim(COALESCE(p_evidence_note, ''))) < 10 THEN
      RAISE EXCEPTION 'Record at least 10 characters describing the verification evidence or rejection reason';
    END IF;
  END IF;

  v_next_status := CASE WHEN p_action = 'approve' THEN 'verified' ELSE 'rejected' END;
  v_verified_at := CASE WHEN p_action = 'approve' THEN now() ELSE NULL END;

  IF v_payment.payment_method = 'mpesa_manual' AND p_action = 'approve' THEN
    PERFORM set_config('retivox.allow_manual_payment_verification', 'on', true);
  END IF;

  UPDATE public.payments
     SET status = v_next_status,
         verified_by = CASE WHEN p_action = 'approve' THEN v_actor_id ELSE NULL END,
         verified_at = v_verified_at,
         verification_source = CASE WHEN v_payment.payment_method = 'mpesa_manual' AND p_action = 'approve' THEN p_evidence_source ELSE NULL END,
         verification_note = CASE WHEN v_payment.payment_method = 'mpesa_manual' THEN btrim(p_evidence_note) ELSE NULL END,
         reconciliation_status = CASE WHEN p_action = 'approve' THEN 'matched' ELSE 'needs_review' END
   WHERE id = v_payment.id;

  SELECT COALESCE(SUM(payment.amount) FILTER (WHERE payment.status = 'verified'), 0),
         COALESCE(bool_or(payment.status IN ('pending', 'pending_verify')), false),
         COALESCE(bool_or(payment.status = 'rejected'), false)
    INTO v_verified_total, v_has_pending, v_has_rejected
    FROM public.payments AS payment
   WHERE payment.transaction_id = v_transaction.id AND payment.business_id = v_business_id;

  IF v_has_pending THEN
    v_next_transaction_status := 'pending_verify';
  ELSIF v_verified_total >= v_transaction.total_amount
     OR (v_transaction.is_credit_sale AND v_verified_total > 0) THEN
    v_next_transaction_status := 'verified';
  ELSIF v_has_rejected THEN
    v_next_transaction_status := 'rejected';
  ELSE
    v_next_transaction_status := 'pending_verify';
  END IF;

  UPDATE public.transactions
     SET status = v_next_transaction_status
   WHERE id = v_transaction.id AND business_id = v_business_id AND status <> 'voided';

  IF v_transaction.employee_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      business_id, recipient_id, type, title, body, metadata, is_read
    ) VALUES (
      v_business_id,
      v_transaction.employee_id,
      CASE WHEN p_action = 'approve' THEN 'payment_verified' ELSE 'payment_rejected' END,
      CASE WHEN p_action = 'approve' THEN 'Payment approved' ELSE 'Payment rejected' END,
      CASE WHEN p_action = 'approve' THEN 'A payment you submitted has been approved.' ELSE 'A payment you submitted has been rejected.' END,
      jsonb_build_object('payment_id', v_payment.id, 'transaction_id', v_transaction.id, 'status', v_next_status),
      false
    );
  END IF;

  INSERT INTO public.audit_logs (
    business_id, actor_id, entity_type, entity_id, action, old_value, new_value
  ) VALUES (
    v_business_id, v_actor_id, 'payment', v_payment.id,
    CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
    jsonb_build_object('payment_status', v_payment.status, 'transaction_status', v_transaction.status),
    jsonb_build_object(
      'payment_status', v_next_status,
      'transaction_status', v_next_transaction_status,
      'verified_by', CASE WHEN p_action = 'approve' THEN v_actor_id ELSE NULL END,
      'verified_at', v_verified_at,
      'verification_source', CASE WHEN v_payment.payment_method = 'mpesa_manual' AND p_action = 'approve' THEN p_evidence_source ELSE NULL END,
      'verification_note', CASE WHEN v_payment.payment_method = 'mpesa_manual' THEN btrim(p_evidence_note) ELSE NULL END
    )
  );
END;
$$;

-- Official C2B receipts remain eligible for provider-confirmed settlement.
-- This is a separately authorized flow: the matched receipt must already be
-- retained by the service callback and the amount must match exactly.
CREATE OR REPLACE FUNCTION public.owner_reconcile_daraja_c2b_payment(
  p_unmatched_payment_id uuid,
  p_payment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid := public.get_my_business_id();
  v_actor uuid := auth.uid();
  v_external public.unmatched_provider_payments%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_branch uuid;
BEGIN
  IF v_actor IS NULL OR v_business_id IS NULL OR public.get_my_global_role() NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an authorized owner or admin can reconcile a provider payment' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_external
    FROM public.unmatched_provider_payments
   WHERE id = p_unmatched_payment_id AND business_id = v_business_id
   FOR UPDATE;
  IF NOT FOUND OR v_external.status <> 'unmatched' OR v_external.provider <> 'daraja' THEN
    RAISE EXCEPTION 'Provider payment is no longer unmatched';
  END IF;

  SELECT * INTO v_payment
    FROM public.payments
   WHERE id = p_payment_id AND business_id = v_business_id
   FOR UPDATE;
  IF NOT FOUND OR v_payment.status <> 'pending_verify'
     OR v_payment.payment_method <> 'mpesa_manual'
     OR round(v_payment.amount, 2) <> round(v_external.amount, 2) THEN
    RAISE EXCEPTION 'Choose an unsettled mobile payment with the exact same amount';
  END IF;

  SELECT branch_id INTO v_branch
    FROM public.transactions
   WHERE id = v_payment.transaction_id AND business_id = v_business_id;
  IF v_branch IS NULL OR (public.get_my_global_role() <> 'owner' AND
      public.branch_role_rank(public.get_effective_branch_role(v_actor, v_branch)) < public.branch_role_rank('admin')) THEN
    RAISE EXCEPTION 'You are not assigned as administrator for this payment branch' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('retivox.allow_manual_payment_verification', 'on', true);
  UPDATE public.payments
     SET status = 'verified',
         provider = 'daraja',
         provider_transaction_id = v_external.provider_transaction_id,
         mpesa_ref_code = v_external.provider_transaction_id,
         reference_code = v_external.provider_transaction_id,
         provider_phone = COALESCE(v_external.phone, provider_phone),
         verified_by = v_actor,
         verified_at = now(),
         verification_source = 'provider_callback',
         verification_note = 'Matched against an authenticated Safaricom C2B callback.',
         reconciliation_status = 'matched'
   WHERE id = v_payment.id;

  UPDATE public.transactions AS transaction_row
     SET status = 'verified'
   WHERE transaction_row.id = v_payment.transaction_id
     AND transaction_row.business_id = v_business_id
     AND transaction_row.status <> 'voided'
     AND NOT EXISTS (
       SELECT 1 FROM public.payments AS payment
        WHERE payment.transaction_id = transaction_row.id
          AND payment.business_id = transaction_row.business_id
          AND payment.status NOT IN ('verified', 'voided')
     );

  UPDATE public.unmatched_provider_payments
     SET status = 'matched',
         matched_transaction_id = v_payment.transaction_id,
         matched_payment_id = v_payment.id,
         matched_by = v_actor,
         matched_at = now()
   WHERE id = v_external.id;

  INSERT INTO public.audit_logs (business_id, actor_id, entity_type, entity_id, action, new_value)
  VALUES (
    v_business_id, v_actor, 'provider_payment', v_external.id, 'daraja_c2b_reconciled',
    jsonb_build_object(
      'receipt', v_external.provider_transaction_id,
      'amount', v_external.amount,
      'payment_id', v_payment.id,
      'transaction_id', v_payment.transaction_id,
      'verification_source', 'provider_callback'
    )
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_verify_payment(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_verify_payment_v2(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_verify_payment_v2(uuid, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_receivable_payment(uuid, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_receivable_payment(uuid, text, numeric, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_receivable_payment_v2(uuid, text, numeric, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_receivable_payment_v2(uuid, text, numeric, numeric, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_reconcile_daraja_c2b_payment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_reconcile_daraja_c2b_payment(uuid, uuid) TO authenticated;
