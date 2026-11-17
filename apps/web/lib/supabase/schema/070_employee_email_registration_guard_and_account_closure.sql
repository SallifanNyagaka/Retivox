-- Prevent an employee identity from being reused to register another business.
-- Closing an employee account removes both the public profile and Auth identity.

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_global_normalized_email_unique
  ON public.users (lower(trim(email)));

CREATE OR REPLACE FUNCTION public.retivox_employee_email_in_use(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.users
     WHERE global_role = 'employee'
       AND lower(trim(email)) = lower(trim(p_email))
  );
$$;
REVOKE ALL ON FUNCTION public.retivox_employee_email_in_use(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retivox_employee_email_in_use(text) TO service_role;

CREATE OR REPLACE FUNCTION public.manager_close_staff_account(
  p_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
  v_actor_role text := public.get_my_global_role();
  v_staff public.users%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR v_business_id IS NULL
     OR COALESCE(v_actor_role, '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only a business owner or administrator can close staff accounts';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users actor
     WHERE actor.id = v_actor_id
       AND actor.business_id = v_business_id
       AND actor.global_role = v_actor_role
       AND actor.is_active = true
       AND actor.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Your account is not active';
  END IF;

  SELECT *
    INTO v_staff
    FROM public.users
   WHERE id = p_user_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff account not found';
  END IF;

  IF v_staff.global_role NOT IN ('admin', 'employee') THEN
    RAISE EXCEPTION 'This account cannot be closed by the staff account workflow';
  END IF;

  IF v_actor_role = 'admin' THEN
    IF v_staff.global_role <> 'employee' THEN
      RAISE EXCEPTION 'Administrators may close employee accounts only';
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM public.user_branch_roles target_role
        JOIN public.user_branch_roles manager_role
          ON manager_role.branch_id = target_role.branch_id
         AND manager_role.business_id = target_role.business_id
       WHERE target_role.user_id = v_staff.id
         AND target_role.business_id = v_business_id
         AND target_role.role = 'employee'
         AND manager_role.user_id = v_actor_id
         AND manager_role.role = 'admin'
         AND manager_role.is_active = true
    ) THEN
      RAISE EXCEPTION 'You can only close employee accounts assigned to stores you manage';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.user_branch_roles target_role
       WHERE target_role.user_id = v_staff.id
         AND target_role.business_id = v_business_id
         AND target_role.role = 'employee'
         AND target_role.is_active = true
         AND NOT EXISTS (
           SELECT 1
             FROM public.user_branch_roles manager_role
            WHERE manager_role.user_id = v_actor_id
              AND manager_role.business_id = v_business_id
              AND manager_role.branch_id = target_role.branch_id
              AND manager_role.role = 'admin'
              AND manager_role.is_active = true
         )
    ) THEN
      RAISE EXCEPTION 'This employee also has active access to a store you do not manage';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    business_id, actor_id, entity_type, entity_id, action, old_value, new_value
  ) VALUES (
    v_business_id, v_actor_id, 'user', v_staff.id, 'account_closed',
    jsonb_build_object(
      'global_role', v_staff.global_role,
      'name', v_staff.name,
      'email', v_staff.email,
      'phone', v_staff.phone,
      'is_active', v_staff.is_active
    ),
    jsonb_build_object(
      'profile_removed', true,
      'auth_identity_removal_required', true,
      'reason', NULLIF(trim(COALESCE(p_reason, '')), '')
    )
  );

  DELETE FROM public.users
   WHERE id = v_staff.id
     AND business_id = v_business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.manager_close_staff_account(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_close_staff_account(uuid, text) TO authenticated;
