-- Financial write/review APIs are invoked from signed-in dashboard actions.
-- Remove inherited PUBLIC/anonymous access while keeping authenticated calls.
REVOKE ALL ON FUNCTION public.owner_verify_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_verify_payment(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_branch_cash_deposit_v2(uuid, date, numeric, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_branch_cash_deposit_v2(uuid, date, numeric, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.review_branch_cash_deposit_v2(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_branch_cash_deposit_v2(uuid, text, text, uuid) TO authenticated;
