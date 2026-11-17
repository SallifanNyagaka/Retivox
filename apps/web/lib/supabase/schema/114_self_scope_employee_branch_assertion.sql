-- The employee branch assertion is a direct employee-session RPC. Never let a
-- caller choose another user's identity (including for denial audit entries).
CREATE OR REPLACE FUNCTION public.assert_employee_at_branch(
  p_user_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_business_id uuid;
  v_expected_branch_id uuid;
  v_user_is_active boolean;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Employee identity does not match the authenticated user'
      USING ERRCODE = '42501';
  END IF;

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
      business_id, actor_id, entity_type, entity_id, action, old_value, new_value
    ) VALUES (
      v_business_id, p_user_id, 'employee_access', p_branch_id, 'access_denied', NULL,
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

REVOKE ALL ON FUNCTION public.assert_employee_at_branch(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_employee_at_branch(uuid, uuid) TO authenticated;
