/*
 * Role-scoped desktop overview summary.
 * The result is intentionally a compact JSON snapshot so the Windows client
 * can cache the same data it presents online and show it while offline.
 */

CREATE OR REPLACE FUNCTION public.desktop_overview_detailed(business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_business_id uuid := public.get_my_business_id();
  v_role text := public.get_my_global_role();
  v_timezone text := 'UTC';
  v_today_start timestamptz;
  v_tomorrow_start timestamptz;
  v_branch_ids uuid[] := ARRAY[]::uuid[];
  v_alerts jsonb := '[]'::jsonb;
  v_pending_count integer := 0;
  v_pending_amount numeric := 0;
  v_variance_count integer := 0;
  v_damage_count integer := 0;
  v_void_count integer := 0;
  v_mpesa_count integer := 0;
  v_cash_count integer := 0;
  v_mpesa_total numeric := 0;
  v_cash_total numeric := 0;
BEGIN
  IF v_actor_id IS NULL
     OR v_business_id IS NULL
     OR business_id IS DISTINCT FROM v_business_id
     OR v_role IS NULL
     OR v_role NOT IN ('owner', 'admin', 'employee') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COALESCE(NULLIF(businesses.timezone, ''), 'UTC')
    INTO v_timezone
    FROM public.businesses
   WHERE businesses.id = v_business_id;

  v_today_start := date_trunc('day', now() AT TIME ZONE v_timezone) AT TIME ZONE v_timezone;
  v_tomorrow_start := v_today_start + interval '1 day';

  SELECT COALESCE(array_agg(scoped.id), ARRAY[]::uuid[])
    INTO v_branch_ids
    FROM (
      SELECT DISTINCT branches.id
        FROM public.get_user_branch_roles(v_actor_id) AS roles
        JOIN public.branches AS branches
          ON branches.id = roles.branch_id
         AND branches.business_id = v_business_id
       WHERE branches.is_active = true
         AND branches.deleted_at IS NULL
         AND public.branch_role_rank(roles.role) >= public.branch_role_rank('employee')
    ) AS scoped;

  IF cardinality(v_branch_ids) = 0 THEN
    RETURN jsonb_build_object(
      'updatedAt', now(), 'totalSalesToday', 0, 'verifiedSales', 0,
      'unverifiedSales', 0, 'totalTransactionsToday', 0,
      'mpesaTransactions', 0, 'cashTransactions', 0,
      'mpesaSalesToday', 0, 'cashSalesToday', 0,
      'activeBranches', 0, 'pendingApprovals', 0,
      'branchOverview', '[]'::jsonb, 'stockAlerts', '[]'::jsonb,
      'operationalAlerts', '[]'::jsonb, 'totalProfitToday', 0,
      'totalLosses', 0, 'bestEmployees', '[]'::jsonb,
      'bestAdmins', '[]'::jsonb, 'bestStores', '[]'::jsonb,
      'lowSellingItems', '[]'::jsonb, 'bestSellingItems', '[]'::jsonb,
      'mySalesToday', 0, 'myTransactionsToday', 0,
      'recentTransactions', '[]'::jsonb
    );
  END IF;

  SELECT COUNT(*)::integer, COALESCE(SUM(transactions.total_amount), 0)
    INTO v_pending_count, v_pending_amount
    FROM public.transactions AS transactions
   WHERE transactions.business_id = v_business_id
     AND transactions.branch_id = ANY(v_branch_ids)
     AND transactions.recorded_at >= v_today_start
     AND transactions.recorded_at < v_tomorrow_start
     AND transactions.status = 'pending_verify'
     AND (v_role <> 'employee' OR transactions.employee_id = v_actor_id);

  IF v_pending_count > 0 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'severity', CASE WHEN v_pending_amount >= 10000 OR v_pending_count >= 8 THEN 'high' ELSE 'medium' END,
      'title', 'Unverified sales need review',
      'description', format('%s transactions worth %s are awaiting verification today.', v_pending_count, round(v_pending_amount, 2))
    ));
  END IF;

  SELECT COUNT(DISTINCT transactions.id)::integer, COALESCE(SUM(payments.amount), 0)
    INTO v_mpesa_count, v_mpesa_total
    FROM public.payments AS payments
    JOIN public.transactions AS transactions
      ON transactions.id = payments.transaction_id
     AND transactions.business_id = v_business_id
   WHERE payments.business_id = v_business_id
     AND transactions.branch_id = ANY(v_branch_ids)
     AND transactions.recorded_at >= v_today_start
     AND transactions.recorded_at < v_tomorrow_start
     AND payments.payment_at >= v_today_start
     AND payments.payment_at < v_tomorrow_start
     AND payments.status <> 'rejected'
     AND payments.payment_method IN ('mpesa_manual', 'mpesa_stk')
     AND (v_role <> 'employee' OR transactions.employee_id = v_actor_id);

  SELECT COUNT(DISTINCT transactions.id)::integer, COALESCE(SUM(payments.amount), 0)
    INTO v_cash_count, v_cash_total
    FROM public.payments AS payments
    JOIN public.transactions AS transactions
      ON transactions.id = payments.transaction_id
     AND transactions.business_id = v_business_id
   WHERE payments.business_id = v_business_id
     AND transactions.branch_id = ANY(v_branch_ids)
     AND transactions.recorded_at >= v_today_start
     AND transactions.recorded_at < v_tomorrow_start
     AND payments.payment_at >= v_today_start
     AND payments.payment_at < v_tomorrow_start
     AND payments.status <> 'rejected'
     AND payments.payment_method = 'cash'
     AND (v_role <> 'employee' OR transactions.employee_id = v_actor_id);

  IF v_role IN ('owner', 'admin') THEN
    SELECT COUNT(*)::integer
      INTO v_variance_count
      FROM public.branch_cash_deposits AS deposits
     WHERE deposits.business_id = v_business_id
       AND deposits.branch_id = ANY(v_branch_ids)
       AND deposits.deposit_date = (now() AT TIME ZONE v_timezone)::date
       AND deposits.status = 'pending'
       AND deposits.variance_amount <> 0;

    IF v_variance_count > 0 THEN
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
        'severity', 'high',
        'title', 'Cash deposit variance needs review',
        'description', format('%s pending cash deposits do not match recorded cash sales.', v_variance_count)
      ));
    END IF;

    SELECT COUNT(*)::integer
      INTO v_damage_count
      FROM public.employee_inventory_loss_reports AS reports
     WHERE reports.business_id = v_business_id
       AND reports.branch_id = ANY(v_branch_ids)
       AND reports.created_at >= now() - interval '7 days'
       AND reports.status = 'pending'
     GROUP BY reports.reported_by
    HAVING COUNT(*) >= 3
     LIMIT 1;

    IF COALESCE(v_damage_count, 0) > 0 THEN
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
        'severity', 'high',
        'title', 'Repeated damage reports',
        'description', 'A staff member has submitted at least three pending damage reports in the last seven days.'
      ));
    END IF;
  END IF;

  SELECT COUNT(*)::integer
    INTO v_void_count
    FROM public.transactions AS transactions
   WHERE transactions.business_id = v_business_id
     AND transactions.branch_id = ANY(v_branch_ids)
     AND transactions.recorded_at >= v_today_start
     AND transactions.recorded_at < v_tomorrow_start
     AND transactions.status = 'voided'
     AND (v_role <> 'employee' OR transactions.employee_id = v_actor_id);

  IF v_void_count >= 2 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'severity', 'medium',
      'title', 'Multiple voided transactions',
      'description', format('%s transactions were voided today. Review the transaction history.', v_void_count)
    ));
  END IF;

  RETURN jsonb_build_object(
    'updatedAt', now(),
    'totalSalesToday', COALESCE((
      SELECT SUM(transactions.total_amount)
        FROM public.transactions AS transactions
       WHERE transactions.business_id = v_business_id
         AND transactions.branch_id = ANY(v_branch_ids)
         AND transactions.recorded_at >= v_today_start
         AND transactions.recorded_at < v_tomorrow_start
         AND transactions.status IN ('synced', 'verified', 'pending_verify')
         AND (v_role <> 'employee' OR transactions.employee_id = v_actor_id)
    ), 0),
    'verifiedSales', COALESCE((
      SELECT COUNT(*)::integer
        FROM public.transactions AS transactions
       WHERE transactions.business_id = v_business_id
         AND transactions.branch_id = ANY(v_branch_ids)
         AND transactions.recorded_at >= v_today_start
         AND transactions.recorded_at < v_tomorrow_start
         AND transactions.status IN ('synced', 'verified')
         AND (v_role <> 'employee' OR transactions.employee_id = v_actor_id)
    ), 0),
    'unverifiedSales', v_pending_count,
    'totalTransactionsToday', COALESCE((
      SELECT COUNT(*)::integer
        FROM public.transactions AS transactions
       WHERE transactions.business_id = v_business_id
         AND transactions.branch_id = ANY(v_branch_ids)
         AND transactions.recorded_at >= v_today_start
         AND transactions.recorded_at < v_tomorrow_start
         AND transactions.status <> 'voided'
         AND (v_role <> 'employee' OR transactions.employee_id = v_actor_id)
    ), 0),
    'mpesaTransactions', v_mpesa_count,
    'cashTransactions', v_cash_count,
    'mpesaSalesToday', round(v_mpesa_total, 2),
    'cashSalesToday', round(v_cash_total, 2),
    'activeBranches', cardinality(v_branch_ids),
    'pendingApprovals', v_pending_count + CASE WHEN v_role = 'owner' THEN COALESCE((
      SELECT COUNT(*)::integer FROM public.price_change_requests AS requests
       WHERE requests.business_id = v_business_id
         AND requests.status = 'pending_approval'
    ), 0) ELSE 0 END,
    'branchOverview', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ranked.branch_id, 'name', ranked.name,
        'sales', ranked.sales, 'transactions', ranked.transactions
      ) ORDER BY ranked.sales DESC, ranked.name)
      FROM (
        SELECT branches.id AS branch_id, branches.name,
               COALESCE(SUM(t.total_amount) FILTER (WHERE t.id IS NOT NULL), 0) AS sales,
               COUNT(t.id)::integer AS transactions
          FROM public.branches AS branches
          LEFT JOIN public.transactions AS t
            ON t.branch_id = branches.id
           AND t.business_id = v_business_id
           AND t.recorded_at >= v_today_start
           AND t.recorded_at < v_tomorrow_start
           AND t.status IN ('synced', 'verified', 'pending_verify')
           AND (v_role <> 'employee' OR t.employee_id = v_actor_id)
         WHERE branches.id = ANY(v_branch_ids)
         GROUP BY branches.id, branches.name
      ) AS ranked
    ), '[]'::jsonb),
    'recentTransactions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', recent.id, 'amount', recent.total_amount,
        'status', recent.status, 'recordedAt', recent.recorded_at,
        'branchName', recent.branch_name, 'employeeName', recent.employee_name
      ) ORDER BY recent.recorded_at DESC)
        FROM (
          SELECT transactions.id, transactions.total_amount,
                 transactions.status, transactions.recorded_at,
                 branches.name AS branch_name, users.name AS employee_name
            FROM public.transactions AS transactions
            LEFT JOIN public.branches AS branches ON branches.id = transactions.branch_id
            LEFT JOIN public.users AS users ON users.id = transactions.employee_id
           WHERE transactions.business_id = v_business_id
             AND transactions.branch_id = ANY(v_branch_ids)
             AND transactions.recorded_at >= v_today_start
             AND transactions.recorded_at < v_tomorrow_start
             AND transactions.status <> 'voided'
             AND (v_role <> 'employee' OR transactions.employee_id = v_actor_id)
           ORDER BY transactions.recorded_at DESC
           LIMIT 6
        ) AS recent
    ), '[]'::jsonb),
    'stockAlerts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', alerts.id, 'name', alerts.name, 'sku', alerts.sku,
        'branchName', alerts.branch_name,
        'quantity', alerts.quantity,
        'threshold', alerts.threshold
      ) ORDER BY alerts.quantity ASC)
        FROM (
          SELECT stock.id, products.name, products.sku, branches.name AS branch_name,
                 COALESCE(stock.base_quantity_on_hand, stock.quantity_on_hand) AS quantity,
                 stock.low_stock_threshold * public.get_product_default_purchase_conversion_factor(v_business_id, stock.product_id) AS threshold
            FROM public.branch_stock AS stock
            JOIN public.products AS products ON products.id = stock.product_id
            JOIN public.branches AS branches ON branches.id = stock.branch_id
           WHERE stock.business_id = v_business_id
             AND stock.branch_id = ANY(v_branch_ids)
             AND products.is_active = true
             AND products.deleted_at IS NULL
             AND COALESCE(stock.base_quantity_on_hand, stock.quantity_on_hand)
                 <= stock.low_stock_threshold * public.get_product_default_purchase_conversion_factor(v_business_id, stock.product_id)
           ORDER BY COALESCE(stock.base_quantity_on_hand, stock.quantity_on_hand) ASC
           LIMIT 8
        ) AS alerts
    ), '[]'::jsonb),
    'operationalAlerts', v_alerts,
    'totalProfitToday', CASE WHEN v_role = 'owner' THEN
      COALESCE((
        SELECT SUM(items.gross_profit)
          FROM public.transaction_items AS items
          JOIN public.transactions AS transactions
            ON transactions.id = items.transaction_id
           AND transactions.business_id = v_business_id
         WHERE items.business_id = v_business_id
           AND transactions.branch_id = ANY(v_branch_ids)
           AND transactions.recorded_at >= v_today_start
           AND transactions.recorded_at < v_tomorrow_start
           AND transactions.status IN ('synced', 'verified')
      ), 0)
      - COALESCE((
        SELECT SUM(expenses.amount)
          FROM public.finance_expenses AS expenses
         WHERE expenses.business_id = v_business_id
           AND expenses.incurred_on = (now() AT TIME ZONE v_timezone)::date
           AND (expenses.branch_id IS NULL OR expenses.branch_id = ANY(v_branch_ids))
      ), 0)
      - COALESCE((
        SELECT SUM(losses.net_loss)
          FROM public.inventory_loss_events AS losses
         WHERE losses.business_id = v_business_id
           AND losses.branch_id = ANY(v_branch_ids)
           AND losses.created_at >= v_today_start
           AND losses.created_at < v_tomorrow_start
      ), 0)
    ELSE 0 END,
    'totalLosses', CASE WHEN v_role = 'owner' THEN COALESCE((
      SELECT SUM(losses.net_loss)
        FROM public.inventory_loss_events AS losses
       WHERE losses.business_id = v_business_id
         AND losses.branch_id = ANY(v_branch_ids)
         AND losses.created_at >= v_today_start
         AND losses.created_at < v_tomorrow_start
    ), 0) END,
    'bestEmployees', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ranked.user_id, 'name', ranked.name,
        'sales', ranked.sales, 'transactions', ranked.transactions
      ) ORDER BY ranked.sales DESC, ranked.name)
      FROM (
        SELECT users.id AS user_id, users.name,
               SUM(t.total_amount) AS sales, COUNT(t.id)::integer AS transactions
          FROM public.transactions AS t
          JOIN public.users AS users ON users.id = t.employee_id
         WHERE t.business_id = v_business_id
           AND t.branch_id = ANY(v_branch_ids)
           AND t.recorded_at >= v_today_start
           AND t.recorded_at < v_tomorrow_start
           AND t.status IN ('synced', 'verified', 'pending_verify')
           AND users.global_role = 'employee'
           AND users.is_active = true
           AND users.deleted_at IS NULL
           AND (v_role <> 'employee' OR t.employee_id = v_actor_id)
         GROUP BY users.id, users.name
         ORDER BY SUM(t.total_amount) DESC
         LIMIT 5
      ) AS ranked
    ), '[]'::jsonb),
    'bestAdmins', CASE WHEN v_role = 'owner' THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ranked.user_id, 'name', ranked.name,
        'sales', ranked.sales, 'transactions', ranked.transactions
      ) ORDER BY ranked.sales DESC, ranked.name)
      FROM (
        SELECT users.id AS user_id, users.name,
               SUM(t.total_amount) AS sales, COUNT(t.id)::integer AS transactions
          FROM public.transactions AS t
          JOIN public.users AS users ON users.id = t.employee_id
         WHERE t.business_id = v_business_id
           AND t.branch_id = ANY(v_branch_ids)
           AND t.recorded_at >= v_today_start
           AND t.recorded_at < v_tomorrow_start
           AND t.status IN ('synced', 'verified', 'pending_verify')
           AND users.global_role = 'admin'
           AND users.is_active = true
           AND users.deleted_at IS NULL
         GROUP BY users.id, users.name
         ORDER BY SUM(t.total_amount) DESC
         LIMIT 5
      ) AS ranked
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'bestStores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ranked.branch_id, 'name', ranked.name,
        'sales', ranked.sales, 'transactions', ranked.transactions
      ) ORDER BY ranked.sales DESC, ranked.name)
      FROM (
        SELECT branches.id AS branch_id, branches.name,
               COALESCE(SUM(t.total_amount), 0) AS sales,
               COUNT(t.id)::integer AS transactions
          FROM public.branches AS branches
          LEFT JOIN public.transactions AS t
            ON t.branch_id = branches.id
           AND t.business_id = v_business_id
           AND t.recorded_at >= v_today_start
           AND t.recorded_at < v_tomorrow_start
           AND t.status IN ('synced', 'verified', 'pending_verify')
           AND (v_role <> 'employee' OR t.employee_id = v_actor_id)
         WHERE branches.id = ANY(v_branch_ids)
         GROUP BY branches.id, branches.name
         ORDER BY COALESCE(SUM(t.total_amount), 0) DESC
         LIMIT 5
      ) AS ranked
    ), '[]'::jsonb),
    'lowSellingItems', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ranked.product_id, 'name', ranked.name, 'sku', ranked.sku,
        'qty', ranked.quantity, 'sales', ranked.sales
      ) ORDER BY ranked.quantity ASC, ranked.name)
      FROM (
        SELECT products.id AS product_id, products.name, products.sku,
               SUM(COALESCE(NULLIF(items.base_quantity, 0), items.quantity)) AS quantity,
               SUM(COALESCE(items.net_line_total, items.line_total)) AS sales
          FROM public.transaction_items AS items
          JOIN public.transactions AS t
            ON t.id = items.transaction_id
           AND t.business_id = v_business_id
          JOIN public.products AS products ON products.id = items.product_id
         WHERE items.business_id = v_business_id
           AND t.branch_id = ANY(v_branch_ids)
           AND t.recorded_at >= v_today_start
           AND t.recorded_at < v_tomorrow_start
           AND t.status IN ('synced', 'verified', 'pending_verify')
           AND (v_role <> 'employee' OR t.employee_id = v_actor_id)
         GROUP BY products.id, products.name, products.sku
         ORDER BY SUM(COALESCE(NULLIF(items.base_quantity, 0), items.quantity)) ASC
         LIMIT 5
      ) AS ranked
    ), '[]'::jsonb),
    'bestSellingItems', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ranked.product_id, 'name', ranked.name, 'sku', ranked.sku,
        'qty', ranked.quantity, 'sales', ranked.sales
      ) ORDER BY ranked.quantity DESC, ranked.name)
      FROM (
        SELECT products.id AS product_id, products.name, products.sku,
               SUM(COALESCE(NULLIF(items.base_quantity, 0), items.quantity)) AS quantity,
               SUM(COALESCE(items.net_line_total, items.line_total)) AS sales
          FROM public.transaction_items AS items
          JOIN public.transactions AS t
            ON t.id = items.transaction_id
           AND t.business_id = v_business_id
          JOIN public.products AS products ON products.id = items.product_id
         WHERE items.business_id = v_business_id
           AND t.branch_id = ANY(v_branch_ids)
           AND t.recorded_at >= v_today_start
           AND t.recorded_at < v_tomorrow_start
           AND t.status IN ('synced', 'verified', 'pending_verify')
           AND (v_role <> 'employee' OR t.employee_id = v_actor_id)
         GROUP BY products.id, products.name, products.sku
         ORDER BY SUM(COALESCE(NULLIF(items.base_quantity, 0), items.quantity)) DESC
         LIMIT 5
      ) AS ranked
    ), '[]'::jsonb),
    'mySalesToday', COALESCE((
      SELECT SUM(transactions.total_amount)
        FROM public.transactions AS transactions
       WHERE transactions.business_id = v_business_id
         AND transactions.branch_id = ANY(v_branch_ids)
         AND transactions.employee_id = v_actor_id
         AND transactions.recorded_at >= v_today_start
         AND transactions.recorded_at < v_tomorrow_start
         AND transactions.status IN ('synced', 'verified', 'pending_verify')
    ), 0),
    'myTransactionsToday', COALESCE((
      SELECT COUNT(*)::integer
        FROM public.transactions AS transactions
       WHERE transactions.business_id = v_business_id
         AND transactions.branch_id = ANY(v_branch_ids)
         AND transactions.employee_id = v_actor_id
         AND transactions.recorded_at >= v_today_start
         AND transactions.recorded_at < v_tomorrow_start
         AND transactions.status <> 'voided'
    ), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.desktop_overview_detailed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.desktop_overview_detailed(uuid) TO authenticated;
