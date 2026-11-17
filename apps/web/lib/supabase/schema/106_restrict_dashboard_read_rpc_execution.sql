-- Dashboard report and catalogue RPCs are authenticated application APIs.
-- Keep signed-in client access while removing their default PUBLIC/anon grant.
REVOKE ALL ON FUNCTION public.admin_damage_report_products() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_damage_report_products() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_damage_report_products(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_damage_report_products(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_managed_inventory_loss_reports(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_managed_inventory_loss_reports(integer) TO authenticated;

REVOKE ALL ON FUNCTION public.dashboard_stock_metrics(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_stock_metrics(uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.dashboard_stock_movement_history(uuid[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_stock_movement_history(uuid[], integer, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.dashboard_transaction_metrics(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_transaction_metrics(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.employee_available_products(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_available_products(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.employee_available_products_normal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_available_products_normal(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.employee_damage_report_products(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_damage_report_products(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.employee_my_inventory_loss_reports(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_my_inventory_loss_reports(integer) TO authenticated;
