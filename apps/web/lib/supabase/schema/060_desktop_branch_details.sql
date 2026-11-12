/*
 * Branch detail snapshot for the desktop stores section.
 * RLS remains active because this function runs as the signed-in caller.
 */

CREATE OR REPLACE FUNCTION public.desktop_branch_details(
  p_business_id uuid,
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
  v_role text := public.get_my_global_role();
  v_branch public.branches%ROWTYPE;
  v_branch_role text;
  v_timezone text := 'UTC';
  v_day_start timestamptz;
  v_next_day timestamptz;
  v_team jsonb := '[]'::jsonb;
  v_admins jsonb := '[]'::jsonb;
  v_gross_profit numeric := 0;
  v_expenses numeric := 0;
  v_losses numeric := 0;
BEGIN
  IF v_actor_id IS NULL
     OR v_business_id IS NULL
     OR p_business_id IS DISTINCT FROM v_business_id
     OR v_role IS NULL
     OR v_role NOT IN ('owner', 'admin', 'employee') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_branch_role := public.get_effective_branch_role(v_actor_id, p_branch_id);
  IF public.branch_role_rank(v_branch_role) < public.branch_role_rank('employee') THEN
    RAISE EXCEPTION 'Branch access denied';
  END IF;

  SELECT branches.*
    INTO v_branch
    FROM public.branches AS branches
   WHERE branches.id = p_branch_id
     AND branches.business_id = v_business_id
     AND branches.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  SELECT COALESCE(NULLIF(businesses.timezone, ''), 'UTC')
    INTO v_timezone
    FROM public.businesses AS businesses
   WHERE businesses.id = v_business_id;
  v_day_start := date_trunc('day', now() AT TIME ZONE v_timezone) AT TIME ZONE v_timezone;
  v_next_day := v_day_start + interval '1 day';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', users.id,
    'name', users.name,
    'email', users.email,
    'phone', users.phone,
    'role', roles.role,
    'globalRole', users.global_role
  ) ORDER BY CASE roles.role WHEN 'admin' THEN 0 ELSE 1 END, users.name), '[]'::jsonb)
    INTO v_team
    FROM public.user_branch_roles AS roles
    JOIN public.users AS users ON users.id = roles.user_id
   WHERE roles.business_id = v_business_id
     AND roles.branch_id = p_branch_id
     AND roles.is_active = true
     AND users.business_id = v_business_id
     AND users.is_active = true
     AND users.deleted_at IS NULL
     AND users.global_role IN ('admin', 'employee');

  SELECT COALESCE(jsonb_agg(person), '[]'::jsonb)
    INTO v_admins
    FROM jsonb_array_elements(v_team) AS team_members(person)
   WHERE person->>'role' = 'admin';

  SELECT COALESCE(SUM(items.gross_profit), 0)
    INTO v_gross_profit
    FROM public.transaction_items AS items
    JOIN public.transactions AS transactions
      ON transactions.id = items.transaction_id
     AND transactions.business_id = v_business_id
   WHERE items.business_id = v_business_id
     AND transactions.branch_id = p_branch_id
     AND transactions.recorded_at >= v_day_start
     AND transactions.recorded_at < v_next_day
     AND transactions.status IN ('synced', 'verified');

  IF v_role = 'owner' THEN
    SELECT COALESCE(SUM(expenses.amount), 0)
      INTO v_expenses
      FROM public.finance_expenses AS expenses
     WHERE expenses.business_id = v_business_id
       AND expenses.incurred_on = (now() AT TIME ZONE v_timezone)::date
       AND expenses.branch_id = p_branch_id;

    SELECT COALESCE(SUM(losses.net_loss), 0)
      INTO v_losses
      FROM public.inventory_loss_events AS losses
     WHERE losses.business_id = v_business_id
       AND losses.branch_id = p_branch_id
       AND losses.created_at >= v_day_start
       AND losses.created_at < v_next_day;
  END IF;

  RETURN jsonb_build_object(
    'id', v_branch.id,
    'name', v_branch.name,
    'location', v_branch.location,
    'branchType', v_branch.branch_type,
    'isActive', v_branch.is_active,
    'role', v_branch_role,
    'updatedAt', now(),
    'team', v_team,
    'adminAssigned', v_admins,
    'employeeCount', (SELECT COUNT(*)::integer FROM jsonb_array_elements(v_team) AS team_members(person) WHERE person->>'role' = 'employee'),
    'totalSales', COALESCE((
      SELECT SUM(transactions.total_amount)
        FROM public.transactions AS transactions
       WHERE transactions.business_id = v_business_id
         AND transactions.branch_id = p_branch_id
         AND transactions.recorded_at >= v_day_start
         AND transactions.recorded_at < v_next_day
         AND transactions.status IN ('synced', 'verified', 'pending_verify')
    ), 0),
    'transactionCount', COALESCE((
      SELECT COUNT(*)::integer
        FROM public.transactions AS transactions
       WHERE transactions.business_id = v_business_id
         AND transactions.branch_id = p_branch_id
         AND transactions.recorded_at >= v_day_start
         AND transactions.recorded_at < v_next_day
         AND transactions.status <> 'voided'
    ), 0),
    'totalProfit', round(v_gross_profit - v_expenses - v_losses, 2),
    'profitLabel', CASE WHEN v_role = 'owner' THEN 'Net profit today' ELSE 'Gross profit today' END,
    'bestSellingItem', (
      SELECT jsonb_build_object('id', ranked.product_id, 'name', ranked.name, 'sku', ranked.sku, 'quantity', ranked.quantity, 'sales', ranked.sales)
        FROM (
          SELECT products.id AS product_id, products.name, products.sku,
                 SUM(COALESCE(NULLIF(items.base_quantity, 0), items.quantity)) AS quantity,
                 SUM(COALESCE(items.net_line_total, items.line_total)) AS sales
            FROM public.transaction_items AS items
            JOIN public.transactions AS transactions ON transactions.id = items.transaction_id
            JOIN public.products AS products ON products.id = items.product_id
           WHERE items.business_id = v_business_id
             AND transactions.business_id = v_business_id
             AND transactions.branch_id = p_branch_id
             AND transactions.recorded_at >= v_day_start
             AND transactions.recorded_at < v_next_day
             AND transactions.status IN ('synced', 'verified', 'pending_verify')
           GROUP BY products.id, products.name, products.sku
           ORDER BY SUM(COALESCE(NULLIF(items.base_quantity, 0), items.quantity)) DESC, products.name
           LIMIT 1
        ) AS ranked
    ),
    'worstSellingItem', (
      SELECT jsonb_build_object('id', ranked.product_id, 'name', ranked.name, 'sku', ranked.sku, 'quantity', ranked.quantity, 'sales', ranked.sales)
        FROM (
          SELECT products.id AS product_id, products.name, products.sku,
                 SUM(COALESCE(NULLIF(items.base_quantity, 0), items.quantity)) AS quantity,
                 SUM(COALESCE(items.net_line_total, items.line_total)) AS sales
            FROM public.transaction_items AS items
            JOIN public.transactions AS transactions ON transactions.id = items.transaction_id
            JOIN public.products AS products ON products.id = items.product_id
           WHERE items.business_id = v_business_id
             AND transactions.business_id = v_business_id
             AND transactions.branch_id = p_branch_id
             AND transactions.recorded_at >= v_day_start
             AND transactions.recorded_at < v_next_day
             AND transactions.status IN ('synced', 'verified', 'pending_verify')
           GROUP BY products.id, products.name, products.sku
           ORDER BY SUM(COALESCE(NULLIF(items.base_quantity, 0), items.quantity)) ASC, products.name
           LIMIT 1
        ) AS ranked
    ),
    'bestEmployee', (
      SELECT jsonb_build_object('id', ranked.user_id, 'name', ranked.name, 'sales', ranked.sales, 'transactions', ranked.transactions)
        FROM (
          SELECT users.id AS user_id, users.name,
                 SUM(transactions.total_amount) AS sales,
                 COUNT(transactions.id)::integer AS transactions
            FROM public.transactions AS transactions
            JOIN public.users AS users ON users.id = transactions.employee_id
           WHERE transactions.business_id = v_business_id
             AND transactions.branch_id = p_branch_id
             AND transactions.recorded_at >= v_day_start
             AND transactions.recorded_at < v_next_day
             AND transactions.status IN ('synced', 'verified', 'pending_verify')
             AND users.global_role = 'employee'
             AND users.is_active = true
             AND users.deleted_at IS NULL
           GROUP BY users.id, users.name
           ORDER BY SUM(transactions.total_amount) DESC, users.name
           LIMIT 1
        ) AS ranked
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.desktop_branch_details(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.desktop_branch_details(uuid, uuid) TO authenticated;
