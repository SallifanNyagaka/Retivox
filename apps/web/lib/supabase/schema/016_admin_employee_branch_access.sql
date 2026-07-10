/*
 * Admin employee branch-access hardening for Retivox.
 *
 * This additive migration gives user_branch_roles a soft access status so
 * admins can deactivate or restore employee access for only the branches they
 * manage. Historical user, transaction, and audit records remain intact.
 */

ALTER TABLE public.user_branch_roles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid REFERENCES public.users(id);

/*
 * Keep the shared authorization helper aligned with soft-deactivated branch
 * assignments. Owners still receive implicit owner access to every branch.
 */
CREATE OR REPLACE FUNCTION public.get_user_branch_roles(p_user_id uuid)
RETURNS TABLE(branch_id uuid, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_global_role text;
  v_is_active boolean;
BEGIN
  SELECT users.business_id, users.global_role, users.is_active
    INTO v_business_id, v_global_role, v_is_active
    FROM public.users
   WHERE users.id = p_user_id
     AND users.deleted_at IS NULL;

  IF v_business_id IS NULL OR v_is_active IS DISTINCT FROM true THEN
    RETURN;
  END IF;

  IF v_global_role = 'owner' THEN
    RETURN QUERY
    SELECT branches.id AS branch_id, 'owner'::text AS role
      FROM public.branches
     WHERE branches.business_id = v_business_id
       AND branches.deleted_at IS NULL;

    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (user_branch_roles.branch_id)
         user_branch_roles.branch_id,
         user_branch_roles.role
    FROM public.user_branch_roles
    JOIN public.branches
      ON branches.id = user_branch_roles.branch_id
     AND branches.business_id = user_branch_roles.business_id
   WHERE user_branch_roles.user_id = p_user_id
     AND user_branch_roles.business_id = v_business_id
     AND user_branch_roles.is_active = true
     AND branches.deleted_at IS NULL
   ORDER BY user_branch_roles.branch_id, public.branch_role_rank(user_branch_roles.role) DESC;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_user_branch_roles_business_branch_role_active
  ON public.user_branch_roles (business_id, branch_id, role, is_active, user_id);

CREATE INDEX IF NOT EXISTS idx_user_branch_roles_user_active_role_branch
  ON public.user_branch_roles (user_id, is_active, role, branch_id);

CREATE INDEX IF NOT EXISTS idx_transactions_business_branch_employee_recorded_at
  ON public.transactions (business_id, branch_id, employee_id, recorded_at DESC);
