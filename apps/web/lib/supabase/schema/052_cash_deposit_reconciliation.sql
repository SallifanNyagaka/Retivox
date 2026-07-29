/*
 * Branch cash deposit reconciliation for Retivox.
 *
 * Cash sales are recorded at sale time without a bank/agent reference. At the
 * end of the day the depositor records one branch deposit; the owner approves
 * it only when it matches the recorded cash sales for that branch and date.
 */

CREATE TABLE IF NOT EXISTS public.branch_cash_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  deposited_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  verified_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deposit_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(12,2) NOT NULL,
  expected_cash_amount numeric(12,2) NOT NULL DEFAULT 0,
  variance_amount numeric(12,2) NOT NULL DEFAULT 0,
  deposit_reference text NOT NULL,
  note text,
  review_note text,
  status text NOT NULL DEFAULT 'pending',
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_cash_deposits_amount_positive CHECK (amount > 0),
  CONSTRAINT branch_cash_deposits_reference_present CHECK (NULLIF(trim(deposit_reference), '') IS NOT NULL),
  CONSTRAINT branch_cash_deposits_status_valid CHECK (status IN ('pending', 'verified', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_branch_cash_deposits_business_status
  ON public.branch_cash_deposits (business_id, status, deposit_date DESC);

CREATE INDEX IF NOT EXISTS idx_branch_cash_deposits_branch_date
  ON public.branch_cash_deposits (business_id, branch_id, deposit_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_cash_deposits_one_open_per_day
  ON public.branch_cash_deposits (business_id, branch_id, deposit_date)
  WHERE status <> 'rejected';

ALTER TABLE public.branch_cash_deposits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'branch_cash_deposits'
       AND policyname = 'branch_cash_deposits_select_scope'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "branch_cash_deposits_select_scope" ON public.branch_cash_deposits
      FOR SELECT
      USING (
        business_id = public.get_my_business_id()
        AND (
          public.get_my_global_role() = 'owner'
          OR public.branch_role_rank(public.get_effective_branch_role(auth.uid(), branch_id)) >= public.branch_role_rank('admin')
        )
      )
    $policy$;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS touch_branch_cash_deposits_updated_at ON public.branch_cash_deposits;
CREATE TRIGGER touch_branch_cash_deposits_updated_at
BEFORE UPDATE ON public.branch_cash_deposits
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.get_branch_recorded_cash_amount(
  p_business_id uuid,
  p_branch_id uuid,
  p_deposit_date date
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(payments.amount), 0)::numeric(12,2)
    FROM public.payments
    JOIN public.transactions
      ON transactions.id = payments.transaction_id
     AND transactions.business_id = payments.business_id
   WHERE payments.business_id = p_business_id
     AND transactions.branch_id = p_branch_id
     AND payments.payment_method = 'cash'
     AND payments.status IN ('pending', 'pending_verify', 'verified')
     AND transactions.status IN ('pending_verify', 'verified', 'synced')
     AND transactions.recorded_at >= p_deposit_date::timestamptz
     AND transactions.recorded_at < (p_deposit_date + 1)::timestamptz;
$$;

CREATE OR REPLACE FUNCTION public.record_branch_cash_deposit(
  p_branch_id uuid,
  p_deposit_date date,
  p_amount numeric,
  p_deposit_reference text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_expected_amount numeric(12,2);
  v_deposit_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF public.get_my_global_role() <> 'owner'
     AND COALESCE(public.branch_role_rank(public.get_effective_branch_role(v_actor_id, p_branch_id)), 0) < public.branch_role_rank('admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Cash deposit amount must be greater than zero';
  END IF;

  IF p_deposit_date IS NULL THEN
    RAISE EXCEPTION 'Deposit date is required';
  END IF;

  IF NULLIF(trim(COALESCE(p_deposit_reference, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Deposit reference is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.branches
     WHERE id = p_branch_id
       AND business_id = v_business_id
       AND is_active = true
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  v_expected_amount := public.get_branch_recorded_cash_amount(v_business_id, p_branch_id, p_deposit_date);

  INSERT INTO public.branch_cash_deposits (
    business_id,
    branch_id,
    deposited_by,
    deposit_date,
    amount,
    expected_cash_amount,
    variance_amount,
    deposit_reference,
    note
  )
  VALUES (
    v_business_id,
    p_branch_id,
    v_actor_id,
    p_deposit_date,
    round(p_amount, 2),
    v_expected_amount,
    round(p_amount - v_expected_amount, 2),
    trim(p_deposit_reference),
    NULLIF(trim(COALESCE(p_note, '')), '')
  )
  RETURNING id INTO v_deposit_id;

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
    'branch_cash_deposit',
    v_deposit_id,
    'recorded',
    NULL,
    jsonb_build_object(
      'branch_id', p_branch_id,
      'deposit_date', p_deposit_date,
      'amount', round(p_amount, 2),
      'expected_cash_amount', v_expected_amount,
      'variance_amount', round(p_amount - v_expected_amount, 2)
    )
  );

  RETURN v_deposit_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A cash deposit for this branch and date is already pending or verified';
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_review_branch_cash_deposit(
  p_deposit_id uuid,
  p_action text,
  p_review_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_deposit public.branch_cash_deposits%ROWTYPE;
  v_next_status text;
  v_now timestamptz := now();
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid cash deposit action';
  END IF;

  SELECT *
    INTO v_deposit
    FROM public.branch_cash_deposits
   WHERE id = p_deposit_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cash deposit not found';
  END IF;

  IF v_deposit.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending cash deposits can be reviewed';
  END IF;

  v_next_status := CASE WHEN p_action = 'approve' THEN 'verified' ELSE 'rejected' END;

  IF p_action = 'approve' AND round(v_deposit.variance_amount, 2) <> 0 THEN
    RAISE EXCEPTION 'Cash deposit must match recorded cash before approval. Variance: %', v_deposit.variance_amount;
  END IF;

  UPDATE public.branch_cash_deposits
     SET status = v_next_status,
         verified_by = v_actor_id,
         verified_at = v_now,
         review_note = NULLIF(trim(COALESCE(p_review_note, '')), '')
   WHERE id = v_deposit.id;

  IF p_action = 'approve' THEN
    UPDATE public.payments
       SET status = 'verified',
           cash_deposit_code = v_deposit.deposit_reference,
           verified_by = v_actor_id,
           verified_at = v_now
      FROM public.transactions
     WHERE payments.transaction_id = transactions.id
       AND payments.business_id = v_business_id
       AND transactions.business_id = v_business_id
       AND transactions.branch_id = v_deposit.branch_id
       AND payments.payment_method = 'cash'
       AND payments.status IN ('pending', 'pending_verify', 'verified')
       AND transactions.status IN ('pending_verify', 'verified', 'synced')
       AND transactions.recorded_at >= v_deposit.deposit_date::timestamptz
       AND transactions.recorded_at < (v_deposit.deposit_date + 1)::timestamptz;

    UPDATE public.transactions
       SET status = 'verified'
     WHERE business_id = v_business_id
       AND branch_id = v_deposit.branch_id
       AND status = 'pending_verify'
       AND recorded_at >= v_deposit.deposit_date::timestamptz
       AND recorded_at < (v_deposit.deposit_date + 1)::timestamptz
       AND EXISTS (
         SELECT 1
           FROM public.payments
          WHERE payments.transaction_id = transactions.id
            AND payments.business_id = v_business_id
            AND payments.payment_method = 'cash'
       );
  END IF;

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
    'branch_cash_deposit',
    v_deposit.id,
    CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
    jsonb_build_object('status', v_deposit.status, 'variance_amount', v_deposit.variance_amount),
    jsonb_build_object('status', v_next_status, 'review_note', NULLIF(trim(COALESCE(p_review_note, '')), ''))
  );
END;
$$;
