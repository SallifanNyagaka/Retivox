-- These helpers are called from SECURITY DEFINER workflows. They have no
-- independent client use; remove their Data API grants to prevent callers
-- from supplying another business, actor, branch, or delivery ID directly.
REVOKE ALL ON FUNCTION public.apply_supplier_delivery_edit(uuid, text, text, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_approved_branch_price(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.snapshot_supplier_delivery(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_branch_recorded_cash_amount(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_product_uom_link(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Retain authenticated access only where the signed-in app has an actual
-- direct call or the function independently checks the authenticated actor.
REVOKE ALL ON FUNCTION public.record_stock_delivery_with_uom(uuid, uuid, uuid, uuid, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_delivery_with_uom(uuid, uuid, uuid, uuid, numeric, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.ensure_recurring_finance_expense_instances(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_recurring_finance_expense_instances(date) TO authenticated;
REVOKE ALL ON FUNCTION public.assert_employee_at_branch(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_employee_at_branch(uuid, uuid) TO authenticated;

-- This audit helper has one app call and must not allow an authenticated user
-- to write a denial event attributed to somebody else.
CREATE OR REPLACE FUNCTION public.log_branch_access_denial(
  p_user_id uuid,p_branch_id uuid,p_min_role text,p_effective_role text,p_attempted_action text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_business_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(b.business_id,u.business_id) INTO v_business_id
    FROM public.users u LEFT JOIN public.branches b ON b.id=p_branch_id
   WHERE u.id=auth.uid();
  IF v_business_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.audit_logs(business_id,actor_id,entity_type,entity_id,action,old_value,new_value)
    VALUES(v_business_id,auth.uid(),'branch_access',p_branch_id,'access_denied',NULL,
      jsonb_build_object('branch_id',p_branch_id,'required_role',p_min_role,
        'effective_role',p_effective_role,'attempted_action',p_attempted_action,'attempted_at',now()));
END; $$;
REVOKE ALL ON FUNCTION public.log_branch_access_denial(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_branch_access_denial(uuid, uuid, text, text, text) TO authenticated;
