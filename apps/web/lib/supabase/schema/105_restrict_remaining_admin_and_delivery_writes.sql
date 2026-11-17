-- Close remaining anonymous access to write RPCs used by signed-in delivery,
-- inventory-loss, supplier, and account-review workflows.
REVOKE ALL ON FUNCTION public.dashboard_acknowledge_supplier_delivery(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_acknowledge_supplier_delivery(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_report_inventory_loss(uuid, uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_report_inventory_loss(uuid, uuid, uuid, numeric, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.upsert_business_supplier(uuid, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_business_supplier(uuid, text, text, text, text, text, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_submit_login_review(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_submit_login_review(text, text) TO authenticated;

-- This average-cost repair helper is only called inside trusted delivery-edit
-- workflows; it must not be exposed as a direct Data API operation.
REVOKE ALL ON FUNCTION public.recalculate_branch_stock_average_cost(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
