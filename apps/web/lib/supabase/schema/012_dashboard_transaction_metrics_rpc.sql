/*
 * Shared dashboard transaction metrics for Retivox.
 *
 * Metrics are scoped by branch IDs supplied by the application after resolving
 * contextual branch access. This keeps list pages fast and avoids client-side
 * reductions over large transaction sets.
 */

CREATE OR REPLACE FUNCTION public.dashboard_transaction_metrics(p_branch_ids uuid[])
RETURNS TABLE(
  "totalToday" numeric,
  "totalThisWeek" numeric,
  "pendingVerifications" integer,
  "rejectedCount" integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped_transactions AS (
    SELECT transactions.id,
           transactions.total_amount,
           transactions.status,
           transactions.recorded_at
      FROM public.transactions
     WHERE transactions.business_id = public.get_my_business_id()
       AND transactions.branch_id = ANY(p_branch_ids)
  )
  SELECT
    COALESCE(SUM(total_amount) FILTER (
      WHERE recorded_at >= date_trunc('day', now())
        AND status IN ('synced', 'verified', 'pending_verify')
    ), 0)::numeric AS "totalToday",
    COALESCE(SUM(total_amount) FILTER (
      WHERE recorded_at >= date_trunc('week', now())
        AND status IN ('synced', 'verified', 'pending_verify')
    ), 0)::numeric AS "totalThisWeek",
    COUNT(*) FILTER (WHERE status = 'pending_verify')::integer AS "pendingVerifications",
    COUNT(*) FILTER (WHERE status = 'rejected')::integer AS "rejectedCount"
  FROM scoped_transactions;
$$;

CREATE INDEX IF NOT EXISTS idx_transactions_business_branch_recorded_at
  ON public.transactions (business_id, branch_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_business_branch_status
  ON public.transactions (business_id, branch_id, status);

CREATE INDEX IF NOT EXISTS idx_payments_business_method_transaction
  ON public.payments (business_id, payment_method, transaction_id);
