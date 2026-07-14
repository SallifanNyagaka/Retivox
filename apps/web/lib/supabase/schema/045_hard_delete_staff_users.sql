/*
 * Hard-delete owner-managed staff users for Retivox.
 *
 * Owners expect deleted admins/employees to disappear from public.users
 * completely. Historical business records keep their data but lose the staff
 * foreign-key pointer, while audit_logs keep immutable actor/entity ids.
 */

CREATE OR REPLACE FUNCTION public.retivox_set_user_fk_on_delete_set_null(
  p_table_name text,
  p_column_name text,
  p_drop_not_null boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_constraint record;
  v_table regclass;
  v_column_attnum smallint;
BEGIN
  v_table := to_regclass(format('public.%I', p_table_name));

  IF v_table IS NULL THEN
    RETURN;
  END IF;

  SELECT attnum
    INTO v_column_attnum
    FROM pg_attribute
   WHERE attrelid = v_table
     AND attname = p_column_name
     AND NOT attisdropped;

  IF v_column_attnum IS NULL THEN
    RETURN;
  END IF;

  IF p_drop_not_null THEN
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', p_table_name, p_column_name);
  END IF;

  FOR v_constraint IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = v_table
       AND contype = 'f'
       AND array_length(conkey, 1) = 1
       AND conkey[1] = v_column_attnum
       AND confrelid = 'public.users'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', p_table_name, v_constraint.conname);
  END LOOP;

  EXECUTE format(
    'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.users(id) ON DELETE SET NULL',
    p_table_name,
    'retivox_' || substr(md5(p_table_name || '_' || p_column_name || '_users_set_null'), 1, 24) || '_fkey',
    p_column_name
  );
END;
$$;

SELECT public.retivox_set_user_fk_on_delete_set_null('user_branch_roles', 'assigned_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('user_branch_roles', 'deactivated_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('users', 'deactivated_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('users', 'deleted_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('employee_transfers', 'approved_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('transactions', 'employee_id');
SELECT public.retivox_set_user_fk_on_delete_set_null('payments', 'verified_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('branches', 'deleted_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('products', 'deleted_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('stock_transfers', 'deleted_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('product_pricing', 'set_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('stock_transfers', 'initiated_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('stock_transfers', 'received_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('supplier_deliveries', 'received_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('branch_product_prices', 'requested_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('branch_product_prices', 'approved_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('price_change_requests', 'requested_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('price_change_requests', 'reviewed_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('supplier_deliveries', 'requested_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('supplier_deliveries', 'reviewed_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('supplier_deliveries', 'approved_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('supplier_deliveries', 'acknowledged_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('units_of_measure', 'created_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('product_pricing_models', 'created_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('product_pricing_models', 'approved_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('supplier_delivery_edit_requests', 'requested_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('supplier_delivery_edit_requests', 'reviewed_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('finance_expenses', 'created_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('inventory_loss_events', 'created_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('inventory_recovery_items', 'created_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('finance_recurring_expense_templates', 'created_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('finance_recurring_expense_templates', 'updated_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('finance_recurring_expense_instances', 'created_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('finance_recurring_expense_instances', 'confirmed_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('finance_recurring_expense_instances', 'skipped_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('employee_inventory_loss_reports', 'reported_by');
SELECT public.retivox_set_user_fk_on_delete_set_null('employee_inventory_loss_reports', 'reviewed_by');

DROP FUNCTION public.retivox_set_user_fk_on_delete_set_null(text, text, boolean);

CREATE OR REPLACE FUNCTION public.owner_hard_delete_staff_user(
  p_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_staff public.users%ROWTYPE;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
    INTO v_staff
    FROM public.users
   WHERE id = p_user_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff user not found';
  END IF;

  IF v_staff.global_role NOT IN ('admin', 'employee') THEN
    RAISE EXCEPTION 'Only admins and employees can be deleted from this workflow';
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
    'user',
    v_staff.id,
    'hard_deleted',
    jsonb_build_object(
      'global_role', v_staff.global_role,
      'name', v_staff.name,
      'email', v_staff.email,
      'phone', v_staff.phone,
      'is_active', v_staff.is_active
    ),
    jsonb_build_object(
      'deleted_from_users', true,
      'reason', NULLIF(trim(COALESCE(p_reason, '')), '')
    )
  );

  DELETE FROM public.users
   WHERE id = v_staff.id
     AND business_id = v_business_id;
END;
$$;

DO $$
DECLARE
  v_staff record;
BEGIN
  FOR v_staff IN
    SELECT *
      FROM public.users
     WHERE global_role IN ('admin', 'employee')
       AND deleted_at IS NOT NULL
  LOOP
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
      v_staff.business_id,
      COALESCE(v_staff.deleted_by, v_staff.id),
      'user',
      v_staff.id,
      'hard_deleted_after_soft_delete',
      jsonb_build_object(
        'global_role', v_staff.global_role,
        'name', v_staff.name,
        'email', v_staff.email,
        'phone', v_staff.phone,
        'is_active', v_staff.is_active,
        'deleted_at', v_staff.deleted_at
      ),
      jsonb_build_object(
        'deleted_from_users', true,
        'reason', COALESCE(v_staff.delete_reason, 'Purged existing soft-deleted staff user')
      )
    );

    DELETE FROM public.users
     WHERE id = v_staff.id;

    BEGIN
      EXECUTE 'DELETE FROM auth.users WHERE id = $1' USING v_staff.id;
    EXCEPTION
      WHEN undefined_table OR insufficient_privilege THEN
        NULL;
    END;
  END LOOP;
END;
$$;
