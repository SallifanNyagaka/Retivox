/*
 * Branch-scoped authorization support for Retivox.
 *
 * This migration adds SQL/RPC helpers used by the shared TypeScript
 * authorization layer. It is additive and does not delete or rewrite data.
 * The helpers preserve the contextual role model:
 * - owners receive implicit owner access to every branch in their business
 * - admins/employees receive explicit roles from user_branch_roles
 * - effective role is resolved per branch using owner > admin > employee
 */

-- Converts role text into a numeric rank for permission comparisons.
CREATE OR REPLACE FUNCTION public.branch_role_rank(p_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'employee' THEN 1
    WHEN 'admin' THEN 2
    WHEN 'owner' THEN 3
    ELSE 0
  END;
$$;

-- Returns every effective branch role for a user, including implicit owner expansion.
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
   WHERE users.id = p_user_id;

  IF v_business_id IS NULL OR v_is_active IS DISTINCT FROM true THEN
    RETURN;
  END IF;

  IF v_global_role = 'owner' THEN
    RETURN QUERY
    SELECT branches.id AS branch_id, 'owner'::text AS role
      FROM public.branches
     WHERE branches.business_id = v_business_id;

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
   ORDER BY user_branch_roles.branch_id, public.branch_role_rank(user_branch_roles.role) DESC;
END;
$$;

-- Returns the highest role a user holds for a specific branch.
CREATE OR REPLACE FUNCTION public.get_effective_branch_role(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT roles.role
    FROM public.get_user_branch_roles(p_user_id) AS roles
   WHERE roles.branch_id = p_branch_id
   ORDER BY public.branch_role_rank(roles.role) DESC
   LIMIT 1;
$$;

-- Returns all branches where a user's effective role is at least p_min_role.
CREATE OR REPLACE FUNCTION public.get_accessible_branch_ids(
  p_user_id uuid,
  p_min_role text
)
RETURNS TABLE(branch_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT roles.branch_id
    FROM public.get_user_branch_roles(p_user_id) AS roles
   WHERE public.branch_role_rank(roles.role) >= public.branch_role_rank(p_min_role)
     AND public.branch_role_rank(p_min_role) > 0;
$$;

-- Records denied branch-access attempts without granting the attempted action.
CREATE OR REPLACE FUNCTION public.log_branch_access_denial(
  p_user_id uuid,
  p_branch_id uuid,
  p_min_role text,
  p_effective_role text,
  p_attempted_action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT COALESCE(branches.business_id, users.business_id)
    INTO v_business_id
    FROM public.users
    LEFT JOIN public.branches
      ON branches.id = p_branch_id
   WHERE users.id = p_user_id;

  IF v_business_id IS NULL THEN
    RETURN;
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
    p_user_id,
    'branch_access',
    p_branch_id,
    'access_denied',
    NULL,
    jsonb_build_object(
      'branch_id', p_branch_id,
      'required_role', p_min_role,
      'effective_role', p_effective_role,
      'attempted_action', p_attempted_action,
      'attempted_at', now()
    )
  );
END;
$$;

-- Required indexes for branch authorization queries and security reviews.
CREATE INDEX IF NOT EXISTS idx_user_branch_roles_user_business_branch_role
  ON public.user_branch_roles (user_id, business_id, branch_id, role);

CREATE INDEX IF NOT EXISTS idx_user_branch_roles_branch_user_role
  ON public.user_branch_roles (branch_id, user_id, role);

CREATE INDEX IF NOT EXISTS idx_branches_business_active_id
  ON public.branches (business_id, is_active, id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_business_entity_entity_id_created_at
  ON public.audit_logs (business_id, entity_type, entity_id, created_at DESC);
