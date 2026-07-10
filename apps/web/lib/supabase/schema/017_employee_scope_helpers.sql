/*
 * Employee scope helpers for Retivox.
 *
 * This migration adds branch-scope RPCs used by the employee web portal and
 * mobile-safe server actions. It is additive and does not delete data.
 */

ALTER TABLE public.user_branch_roles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid REFERENCES public.users(id);

/*
 * Returns the single active branch assigned to an employee.
 *
 * If the employee has no active assignment or more than one active assignment,
 * the function returns null so callers cannot accidentally widen scope.
 */
CREATE OR REPLACE FUNCTION public.get_employee_branch_id(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_assignment_count integer;
BEGIN
  SELECT COUNT(*)::integer
    INTO v_assignment_count
    FROM public.user_branch_roles
    JOIN public.users
      ON users.id = user_branch_roles.user_id
     AND users.business_id = user_branch_roles.business_id
    JOIN public.branches
      ON branches.id = user_branch_roles.branch_id
     AND branches.business_id = user_branch_roles.business_id
   WHERE user_branch_roles.user_id = p_user_id
     AND user_branch_roles.role = 'employee'
     AND user_branch_roles.is_active = true
     AND users.global_role = 'employee'
     AND users.is_active = true
     AND users.deleted_at IS NULL
     AND branches.is_active = true
     AND branches.deleted_at IS NULL;

  IF v_assignment_count <> 1 THEN
    RETURN NULL;
  END IF;

  SELECT user_branch_roles.branch_id
    INTO v_branch_id
    FROM public.user_branch_roles
    JOIN public.users
      ON users.id = user_branch_roles.user_id
     AND users.business_id = user_branch_roles.business_id
    JOIN public.branches
      ON branches.id = user_branch_roles.branch_id
     AND branches.business_id = user_branch_roles.business_id
   WHERE user_branch_roles.user_id = p_user_id
     AND user_branch_roles.role = 'employee'
     AND user_branch_roles.is_active = true
     AND users.global_role = 'employee'
     AND users.is_active = true
     AND users.deleted_at IS NULL
     AND branches.is_active = true
     AND branches.deleted_at IS NULL
   LIMIT 1;

  RETURN v_branch_id;
END;
$$;

/*
 * Returns the employee's read-only profile and current branch label.
 *
 * Deactivated users still return their identity row with null branch values so
 * the web layout can redirect them to the deactivated account screen without
 * leaking operational data.
 */
CREATE OR REPLACE FUNCTION public.get_employee_profile(p_user_id uuid)
RETURNS TABLE(
  id uuid,
  name text,
  email text,
  phone text,
  business_id uuid,
  is_active boolean,
  branch_id uuid,
  branch_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  SELECT public.get_employee_branch_id(p_user_id)
    INTO v_branch_id;

  RETURN QUERY
  SELECT
    users.id,
    users.name,
    users.email,
    users.phone,
    users.business_id,
    users.is_active,
    branches.id AS branch_id,
    branches.name AS branch_name
  FROM public.users
  LEFT JOIN public.branches
    ON branches.id = v_branch_id
   AND branches.business_id = users.business_id
   AND branches.deleted_at IS NULL
  WHERE users.id = p_user_id
    AND users.global_role = 'employee'
    AND users.deleted_at IS NULL;
END;
$$;

/*
 * Enforces that an employee can act only at their current single branch.
 *
 * Failed checks are audited when a business context is available.
 */
CREATE OR REPLACE FUNCTION public.assert_employee_at_branch(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_expected_branch_id uuid;
  v_user_is_active boolean;
BEGIN
  SELECT users.business_id, users.is_active
    INTO v_business_id, v_user_is_active
    FROM public.users
   WHERE users.id = p_user_id
     AND users.global_role = 'employee'
     AND users.deleted_at IS NULL;

  SELECT public.get_employee_branch_id(p_user_id)
    INTO v_expected_branch_id;

  IF v_business_id IS NOT NULL
     AND (
       v_user_is_active IS DISTINCT FROM true
       OR v_expected_branch_id IS NULL
       OR v_expected_branch_id <> p_branch_id
     ) THEN
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
      p_user_id,
      'employee_access',
      p_branch_id,
      'access_denied',
      NULL,
      jsonb_build_object(
        'required_role', 'employee',
        'effective_role', 'employee',
        'expected_branch_id', v_expected_branch_id,
        'attempted_branch_id', p_branch_id,
        'attempted_at', now()
      )
    );
  END IF;

  IF v_user_is_active IS DISTINCT FROM true
     OR v_expected_branch_id IS NULL
     OR v_expected_branch_id <> p_branch_id THEN
    RAISE EXCEPTION 'Employee branch access denied'
      USING ERRCODE = '42501';
  END IF;

  RETURN true;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_user_branch_roles_employee_active_scope
  ON public.user_branch_roles (user_id, role, is_active, business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_transactions_employee_branch_recorded_at
  ON public.transactions (employee_id, branch_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_branch_product_prices_branch_status_product
  ON public.branch_product_prices (branch_id, status, product_id);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read_created_at
  ON public.notifications (recipient_id, is_read, created_at DESC);
