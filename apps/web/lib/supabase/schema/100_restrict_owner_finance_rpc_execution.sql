-- Restrict owner finance writes to authenticated dashboard sessions. Each
-- function performs its own owner/branch authorization checks after sign-in.
REVOKE ALL ON FUNCTION public.owner_void_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_void_transaction(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.record_owner_finance_expense(uuid, text, text, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_owner_finance_expense(uuid, text, text, numeric, date) TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_recurring_finance_expense_template(uuid, uuid, text, text, numeric, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_recurring_finance_expense_template(uuid, uuid, text, text, numeric, integer, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_recurring_finance_expense_instance(uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_recurring_finance_expense_instance(uuid, numeric, date, text) TO authenticated;

REVOKE ALL ON FUNCTION public.skip_recurring_finance_expense_instance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.skip_recurring_finance_expense_instance(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.record_branch_cash_deposit(uuid, date, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_branch_cash_deposit(uuid, date, numeric, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.owner_review_branch_cash_deposit(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_review_branch_cash_deposit(uuid, text, text) TO authenticated;
