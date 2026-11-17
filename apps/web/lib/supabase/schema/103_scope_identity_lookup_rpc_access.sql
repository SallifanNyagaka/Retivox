-- These identity lookup helpers are SECURITY DEFINER functions and accept a
-- user ID. The application only calls them for the signed-in user, so enforce
-- that invariant inside the database instead of trusting every caller.
CREATE OR REPLACE FUNCTION public.get_user_branch_roles(p_user_id uuid)
RETURNS TABLE(branch_id uuid, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_business_id uuid; v_global_role text; v_is_active boolean;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT u.business_id,u.global_role,u.is_active INTO v_business_id,v_global_role,v_is_active
    FROM public.users u WHERE u.id=p_user_id AND u.deleted_at IS NULL;
  IF v_business_id IS NULL OR v_is_active IS DISTINCT FROM true THEN RETURN; END IF;
  IF v_global_role='owner' THEN
    RETURN QUERY SELECT b.id,'owner'::text FROM public.branches b
      WHERE b.business_id=v_business_id AND b.deleted_at IS NULL;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT DISTINCT ON (ubr.branch_id) ubr.branch_id,ubr.role
      FROM public.user_branch_roles ubr
      JOIN public.branches b ON b.id=ubr.branch_id AND b.business_id=ubr.business_id
     WHERE ubr.user_id=p_user_id AND ubr.business_id=v_business_id
       AND ubr.is_active=true AND b.deleted_at IS NULL
     ORDER BY ubr.branch_id,public.branch_role_rank(ubr.role) DESC;
END; $$;

CREATE OR REPLACE FUNCTION public.get_accessible_branch_ids(p_user_id uuid,p_min_role text)
RETURNS TABLE(branch_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT roles.branch_id FROM public.get_user_branch_roles(auth.uid()) roles
    WHERE public.branch_role_rank(roles.role)>=public.branch_role_rank(p_min_role)
      AND public.branch_role_rank(p_min_role)>0;
END; $$;

CREATE OR REPLACE FUNCTION public.get_effective_branch_role(p_user_id uuid,p_branch_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT roles.role INTO v_role FROM public.get_user_branch_roles(auth.uid()) roles
    WHERE roles.branch_id=p_branch_id
    ORDER BY public.branch_role_rank(roles.role) DESC LIMIT 1;
  RETURN v_role;
END; $$;

CREATE OR REPLACE FUNCTION public.get_employee_branch_id(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_branch_id uuid; v_assignment_count integer;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT count(*)::integer INTO v_assignment_count
    FROM public.user_branch_roles ubr
    JOIN public.users u ON u.id=ubr.user_id AND u.business_id=ubr.business_id
    JOIN public.branches b ON b.id=ubr.branch_id AND b.business_id=ubr.business_id
   WHERE ubr.user_id=p_user_id AND ubr.role='employee' AND ubr.is_active=true
     AND u.global_role='employee' AND u.is_active=true AND u.deleted_at IS NULL
     AND b.is_active=true AND b.deleted_at IS NULL;
  IF v_assignment_count<>1 THEN RETURN NULL; END IF;
  SELECT ubr.branch_id INTO v_branch_id
    FROM public.user_branch_roles ubr
    JOIN public.users u ON u.id=ubr.user_id AND u.business_id=ubr.business_id
    JOIN public.branches b ON b.id=ubr.branch_id AND b.business_id=ubr.business_id
   WHERE ubr.user_id=p_user_id AND ubr.role='employee' AND ubr.is_active=true
     AND u.global_role='employee' AND u.is_active=true AND u.deleted_at IS NULL
     AND b.is_active=true AND b.deleted_at IS NULL LIMIT 1;
  RETURN v_branch_id;
END; $$;

CREATE OR REPLACE FUNCTION public.get_employee_profile(p_user_id uuid)
RETURNS TABLE(id uuid,name text,email text,phone text,business_id uuid,is_active boolean,branch_id uuid,branch_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT public.get_employee_branch_id(auth.uid()) INTO v_branch_id;
  RETURN QUERY SELECT u.id,u.name,u.email,u.phone,u.business_id,u.is_active,b.id,b.name
    FROM public.users u
    LEFT JOIN public.branches b ON b.id=v_branch_id AND b.business_id=u.business_id AND b.deleted_at IS NULL
   WHERE u.id=auth.uid() AND u.global_role='employee' AND u.deleted_at IS NULL;
END; $$;

REVOKE ALL ON FUNCTION public.get_user_branch_roles(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_user_branch_roles(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_accessible_branch_ids(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_accessible_branch_ids(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_effective_branch_role(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_effective_branch_role(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_employee_branch_id(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_employee_branch_id(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_employee_profile(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_employee_profile(uuid) TO authenticated;
