/*
 * Deleted branch dashboard scope for Retivox.
 *
 * Once a branch is deleted, it should disappear from operational dashboards.
 * Historical rows remain stored for audit/accounting, but owner analytics only
 * summarizes transactions/payments that belong to non-deleted branches.
 */

CREATE OR REPLACE FUNCTION public.owner_analytics_summary(
  p_range_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_actor_id uuid;
  v_range_days integer;
  v_start_date date;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_range_days := LEAST(GREATEST(COALESCE(p_range_days, 30), 1), 365);
  v_start_date := CURRENT_DATE - (v_range_days - 1);

  RETURN jsonb_build_object(
    'revenueByDay',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'date', to_char(day_value::date, 'YYYY-MM-DD'),
            'total', total_amount
          )
          ORDER BY day_value DESC
        )
        FROM (
          SELECT
            day_value,
            COALESCE(SUM(payments.amount), 0) AS total_amount
          FROM generate_series(v_start_date, CURRENT_DATE, interval '1 day') AS days(day_value)
          LEFT JOIN payments
            ON payments.business_id = v_business_id
           AND payments.status = 'verified'
           AND payments.payment_at >= day_value
           AND payments.payment_at < day_value + interval '1 day'
          LEFT JOIN transactions
            ON transactions.id = payments.transaction_id
           AND transactions.business_id = payments.business_id
          LEFT JOIN branches
            ON branches.id = transactions.branch_id
           AND branches.business_id = transactions.business_id
           AND branches.deleted_at IS NULL
          WHERE payments.id IS NULL OR branches.id IS NOT NULL
          GROUP BY day_value
        ) AS daily_revenue
      ),
      '[]'::jsonb
    ),
    'revenueByBranch',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'branchName', branch_name,
            'total', total_amount
          )
          ORDER BY total_amount DESC
        )
        FROM (
          SELECT
            branches.name AS branch_name,
            SUM(payments.amount) AS total_amount
          FROM payments
          JOIN transactions
            ON transactions.id = payments.transaction_id
           AND transactions.business_id = payments.business_id
          JOIN branches
            ON branches.id = transactions.branch_id
           AND branches.business_id = transactions.business_id
           AND branches.deleted_at IS NULL
          WHERE payments.business_id = v_business_id
            AND payments.status = 'verified'
            AND payments.payment_at >= v_start_date::timestamptz
          GROUP BY branches.name
        ) AS branch_revenue
      ),
      '[]'::jsonb
    ),
    'topProducts',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'productName', product_name,
            'totalQty', total_qty,
            'totalRevenue', total_revenue
          )
          ORDER BY total_qty DESC
        )
        FROM (
          SELECT
            products.name AS product_name,
            SUM(transaction_items.quantity)::integer AS total_qty,
            SUM(transaction_items.line_total) AS total_revenue
          FROM transaction_items
          JOIN transactions
            ON transactions.id = transaction_items.transaction_id
           AND transactions.business_id = transaction_items.business_id
          JOIN branches
            ON branches.id = transactions.branch_id
           AND branches.business_id = transactions.business_id
           AND branches.deleted_at IS NULL
          JOIN products
            ON products.id = transaction_items.product_id
           AND products.business_id = transaction_items.business_id
          WHERE transaction_items.business_id = v_business_id
            AND transactions.recorded_at >= v_start_date::timestamptz
          GROUP BY products.name
          ORDER BY total_qty DESC
          LIMIT 5
        ) AS product_sales
      ),
      '[]'::jsonb
    ),
    'paymentMethods',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'method', method,
            'count', payment_count,
            'total', total_amount
          )
          ORDER BY total_amount DESC
        )
        FROM (
          SELECT
            COALESCE(payments.payment_method, 'Unknown') AS method,
            COUNT(*)::integer AS payment_count,
            SUM(payments.amount) AS total_amount
          FROM payments
          JOIN transactions
            ON transactions.id = payments.transaction_id
           AND transactions.business_id = payments.business_id
          JOIN branches
            ON branches.id = transactions.branch_id
           AND branches.business_id = transactions.business_id
           AND branches.deleted_at IS NULL
          WHERE payments.business_id = v_business_id
            AND payments.payment_at >= v_start_date::timestamptz
          GROUP BY payments.payment_method
        ) AS payment_method_totals
      ),
      '[]'::jsonb
    ),
    'transactionCount',
    (
      SELECT COUNT(*)::integer
      FROM transactions
      JOIN branches
        ON branches.id = transactions.branch_id
       AND branches.business_id = transactions.business_id
       AND branches.deleted_at IS NULL
      WHERE transactions.business_id = v_business_id
        AND transactions.recorded_at >= v_start_date::timestamptz
    )
  );
END;
$$;
