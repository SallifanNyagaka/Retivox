-- Multi-stage, idempotent cash deposits for owners, administrators and employees.
ALTER TABLE public.branch_cash_deposits
  ADD COLUMN IF NOT EXISTS local_id uuid,
  ADD COLUMN IF NOT EXISTS submitted_role text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS admin_approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_approved_at timestamptz;

ALTER TABLE public.branch_cash_deposits DROP CONSTRAINT IF EXISTS branch_cash_deposits_status_valid;
ALTER TABLE public.branch_cash_deposits ADD CONSTRAINT branch_cash_deposits_status_valid
  CHECK (status IN ('pending', 'pending_owner', 'verified', 'rejected'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_cash_deposits_local_id
  ON public.branch_cash_deposits (business_id, local_id) WHERE local_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.branch_cash_deposit_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  local_id uuid NOT NULL, deposit_id uuid NOT NULL REFERENCES public.branch_cash_deposits(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, local_id)
);
ALTER TABLE public.branch_cash_deposit_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_cash_deposit_reviews_select_scope ON public.branch_cash_deposit_reviews;
CREATE POLICY branch_cash_deposit_reviews_select_scope ON public.branch_cash_deposit_reviews FOR SELECT
USING (business_id=public.get_my_business_id() AND public.get_my_global_role()='owner');

DROP POLICY IF EXISTS branch_cash_deposits_select_scope ON public.branch_cash_deposits;
CREATE POLICY branch_cash_deposits_select_scope ON public.branch_cash_deposits
FOR SELECT USING (
  business_id = public.get_my_business_id()
  AND (
    public.get_my_global_role() = 'owner'
    OR deposited_by = auth.uid()
    OR public.branch_role_rank(public.get_effective_branch_role(auth.uid(), branch_id)) >= public.branch_role_rank('employee')
  )
);

CREATE OR REPLACE FUNCTION public.record_branch_cash_deposit_v2(
  p_branch_id uuid,
  p_deposit_date date,
  p_amount numeric,
  p_deposit_reference text,
  p_note text DEFAULT NULL,
  p_local_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_business uuid := public.get_my_business_id();
  v_role text;
  v_expected numeric(12,2);
  v_id uuid;
  v_status text;
BEGIN
  IF v_actor IS NULL OR v_business IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  v_role := CASE WHEN public.get_my_global_role() = 'owner' THEN 'owner'
    ELSE public.get_effective_branch_role(v_actor, p_branch_id) END;
  IF COALESCE(v_role, '') NOT IN ('owner', 'admin', 'employee') THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Cash deposit amount must be greater than zero'; END IF;
  IF p_deposit_date IS NULL OR p_deposit_date > CURRENT_DATE THEN RAISE EXCEPTION 'Deposit date must be today or earlier'; END IF;
  IF NULLIF(trim(COALESCE(p_deposit_reference, '')), '') IS NULL THEN RAISE EXCEPTION 'Deposit reference is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id=p_branch_id AND business_id=v_business AND is_active AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF p_local_id IS NOT NULL THEN
    SELECT id INTO v_id FROM branch_cash_deposits WHERE business_id=v_business AND local_id=p_local_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  v_expected := get_branch_recorded_cash_amount(v_business, p_branch_id, p_deposit_date);
  v_status := CASE WHEN v_role = 'admin' THEN 'pending_owner' ELSE 'pending' END;
  INSERT INTO branch_cash_deposits (business_id,branch_id,deposited_by,deposit_date,amount,expected_cash_amount,variance_amount,deposit_reference,note,status,local_id,submitted_role)
  VALUES (v_business,p_branch_id,v_actor,p_deposit_date,round(p_amount,2),v_expected,round(p_amount-v_expected,2),trim(p_deposit_reference),NULLIF(trim(COALESCE(p_note,'')),''),v_status,p_local_id,v_role)
  RETURNING id INTO v_id;
  INSERT INTO audit_logs (business_id,actor_id,entity_type,entity_id,action,old_value,new_value)
  VALUES (v_business,v_actor,'branch_cash_deposit',v_id,'recorded',NULL,jsonb_build_object('branch_id',p_branch_id,'deposit_date',p_deposit_date,'amount',round(p_amount,2),'status',v_status,'submitted_role',v_role));
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  IF p_local_id IS NOT NULL THEN
    SELECT id INTO v_id FROM branch_cash_deposits WHERE business_id=v_business AND local_id=p_local_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  RAISE EXCEPTION 'A cash deposit for this branch and date is already pending or verified';
END $$;

CREATE OR REPLACE FUNCTION public.review_branch_cash_deposit_v2(
  p_deposit_id uuid, p_action text, p_review_note text DEFAULT NULL, p_local_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_business uuid := public.get_my_business_id();
  v_role text := public.get_my_global_role();
  v_deposit branch_cash_deposits%ROWTYPE;
  v_effective_role text;
  v_next text;
  v_now timestamptz := now();
BEGIN
  IF v_actor IS NULL OR v_business IS NULL OR p_action NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Unauthorized or invalid action'; END IF;
  IF p_local_id IS NOT NULL AND EXISTS (SELECT 1 FROM branch_cash_deposit_reviews WHERE business_id=v_business AND local_id=p_local_id) THEN RETURN; END IF;
  SELECT * INTO v_deposit FROM branch_cash_deposits WHERE id=p_deposit_id AND business_id=v_business FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cash deposit not found'; END IF;
  IF p_local_id IS NOT NULL AND EXISTS (SELECT 1 FROM branch_cash_deposit_reviews WHERE business_id=v_business AND local_id=p_local_id) THEN RETURN; END IF;
  v_effective_role := CASE WHEN v_role='owner' THEN 'owner' ELSE public.get_effective_branch_role(v_actor,v_deposit.branch_id) END;
  IF COALESCE(v_effective_role, '') NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_action='approve' AND v_effective_role='admin' THEN
    IF v_deposit.status <> 'pending' OR v_deposit.submitted_role <> 'employee' OR v_deposit.deposited_by=v_actor THEN RAISE EXCEPTION 'This deposit is not awaiting administrator approval'; END IF;
    UPDATE branch_cash_deposits SET status='pending_owner',admin_approved_by=v_actor,admin_approved_at=v_now,review_note=NULLIF(trim(COALESCE(p_review_note,'')),'') WHERE id=v_deposit.id;
    v_next := 'pending_owner';
  ELSE
    IF v_effective_role <> 'owner' THEN
      IF p_action <> 'reject' OR v_deposit.status <> 'pending' OR v_deposit.submitted_role <> 'employee' OR v_deposit.deposited_by=v_actor THEN RAISE EXCEPTION 'Administrator may only review employee deposits awaiting first approval'; END IF;
    ELSIF v_deposit.status NOT IN ('pending','pending_owner') THEN
      RAISE EXCEPTION 'This deposit is no longer awaiting owner review';
    END IF;
    IF p_action='approve' AND round(v_deposit.variance_amount,2) <> 0 THEN RAISE EXCEPTION 'Cash deposit must match recorded cash before final approval. Variance: %',v_deposit.variance_amount; END IF;
    v_next := CASE WHEN p_action='approve' THEN 'verified' ELSE 'rejected' END;
    UPDATE branch_cash_deposits SET status=v_next,verified_by=CASE WHEN p_action='approve' THEN v_actor ELSE verified_by END,verified_at=CASE WHEN p_action='approve' THEN v_now ELSE verified_at END,review_note=NULLIF(trim(COALESCE(p_review_note,'')),'') WHERE id=v_deposit.id;
    IF p_action='approve' THEN
      UPDATE payments SET status='verified',cash_deposit_code=v_deposit.deposit_reference,verified_by=v_actor,verified_at=v_now
      FROM transactions WHERE payments.transaction_id=transactions.id AND payments.business_id=v_business AND transactions.business_id=v_business AND transactions.branch_id=v_deposit.branch_id AND payments.payment_method='cash' AND payments.status IN ('pending','pending_verify','verified') AND transactions.status IN ('pending_verify','verified','synced') AND transactions.recorded_at>=v_deposit.deposit_date::timestamptz AND transactions.recorded_at<(v_deposit.deposit_date+1)::timestamptz;
      UPDATE transactions SET status='verified' WHERE business_id=v_business AND branch_id=v_deposit.branch_id AND status='pending_verify' AND recorded_at>=v_deposit.deposit_date::timestamptz AND recorded_at<(v_deposit.deposit_date+1)::timestamptz AND EXISTS (SELECT 1 FROM payments WHERE payments.transaction_id=transactions.id AND payments.business_id=v_business AND payments.payment_method='cash');
    END IF;
  END IF;
  INSERT INTO audit_logs (business_id,actor_id,entity_type,entity_id,action,old_value,new_value)
  VALUES (v_business,v_actor,'branch_cash_deposit',v_deposit.id,CASE WHEN p_action='approve' AND v_effective_role='admin' THEN 'admin_approved' WHEN p_action='approve' THEN 'approved' ELSE 'rejected' END,jsonb_build_object('status',v_deposit.status),jsonb_build_object('status',v_next,'review_note',NULLIF(trim(COALESCE(p_review_note,'')),''),'review_stage',v_effective_role));
  IF p_local_id IS NOT NULL THEN
    INSERT INTO branch_cash_deposit_reviews (business_id,local_id,deposit_id,actor_id,action) VALUES (v_business,p_local_id,v_deposit.id,v_actor,p_action) ON CONFLICT (business_id,local_id) DO NOTHING;
  END IF;
END $$;

-- Notify branch administrators and owner on submission; notify owner after admin approval,
-- and the depositor after final decision. Notification reads remain recipient-scoped.
CREATE OR REPLACE FUNCTION public.notify_cash_deposit_stage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_recipient uuid; v_branch text;
BEGIN
  SELECT name INTO v_branch FROM branches WHERE id=NEW.branch_id;
  IF TG_OP='INSERT' THEN
    FOR v_recipient IN SELECT DISTINCT id FROM (
      SELECT u.id FROM users u WHERE u.business_id=NEW.business_id AND u.global_role='owner' AND u.is_active AND u.id<>COALESCE(NEW.deposited_by,gen_random_uuid())
      UNION SELECT ubr.user_id FROM user_branch_roles ubr JOIN users u ON u.id=ubr.user_id WHERE ubr.business_id=NEW.business_id AND ubr.branch_id=NEW.branch_id AND ubr.role='admin' AND ubr.is_active AND u.is_active AND u.id<>COALESCE(NEW.deposited_by,gen_random_uuid())
    ) recipients LOOP
      INSERT INTO notifications (business_id,recipient_id,type,title,body,metadata) VALUES (NEW.business_id,v_recipient,'cash_deposit_pending','Cash deposit needs review',format('%s recorded a cash deposit of %s for %s.',COALESCE((SELECT name FROM users WHERE id=NEW.deposited_by),'A team member'),NEW.amount,v_branch),jsonb_build_object('deposit_id',NEW.id,'branch_id',NEW.branch_id,'status',NEW.status));
    END LOOP;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status='pending_owner' THEN
      FOR v_recipient IN SELECT id FROM users WHERE business_id=NEW.business_id AND global_role='owner' AND is_active LOOP
        INSERT INTO notifications (business_id,recipient_id,type,title,body,metadata) VALUES (NEW.business_id,v_recipient,'cash_deposit_owner_approval','Cash deposit needs final approval',format('Administrator review is complete for the %s deposit of %s.',v_branch,NEW.amount),jsonb_build_object('deposit_id',NEW.id,'branch_id',NEW.branch_id,'status',NEW.status));
      END LOOP;
    ELSIF NEW.status IN ('verified','rejected') AND NEW.deposited_by IS NOT NULL THEN
      INSERT INTO notifications (business_id,recipient_id,type,title,body,metadata) VALUES (NEW.business_id,NEW.deposited_by,CASE WHEN NEW.status='verified' THEN 'cash_deposit_approved' ELSE 'cash_deposit_rejected' END,CASE WHEN NEW.status='verified' THEN 'Cash deposit approved' ELSE 'Cash deposit rejected' END,format('Your %s cash deposit of %s for %s was %s.',v_branch,NEW.amount,v_branch,NEW.status),jsonb_build_object('deposit_id',NEW.id,'branch_id',NEW.branch_id,'status',NEW.status));
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS branch_cash_deposit_notifications ON public.branch_cash_deposits;
CREATE TRIGGER branch_cash_deposit_notifications AFTER INSERT OR UPDATE OF status ON public.branch_cash_deposits FOR EACH ROW EXECUTE FUNCTION public.notify_cash_deposit_stage();
