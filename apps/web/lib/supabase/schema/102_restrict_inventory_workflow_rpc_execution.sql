-- Stock, transfer, supplier-delivery, and inventory-loss mutations are
-- dashboard operations. Keep authenticated use and remove PUBLIC/anon access.
REVOKE ALL ON FUNCTION public.dashboard_adjust_stock(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_adjust_stock(uuid, integer, text) TO authenticated;
REVOKE ALL ON FUNCTION public.dashboard_approve_stock_transfer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_approve_stock_transfer(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.dashboard_approve_supplier_delivery(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_approve_supplier_delivery(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.dashboard_initiate_stock_transfer(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_initiate_stock_transfer(uuid, uuid, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.dashboard_mark_stock_transfer_received(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_mark_stock_transfer_received(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.dashboard_request_supplier_delivery_edit(uuid, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_request_supplier_delivery_edit(uuid, text, text, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.dashboard_review_supplier_delivery_edit_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_review_supplier_delivery_edit_request(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.dashboard_update_low_stock_threshold(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_update_low_stock_threshold(uuid, uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.owner_adjust_stock(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_adjust_stock(uuid, integer, text) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_approve_employee_transfer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_approve_employee_transfer(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_approve_stock_transfer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_approve_stock_transfer(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_initiate_stock_transfer(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_initiate_stock_transfer(uuid, uuid, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_mark_stock_transfer_received(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_mark_stock_transfer_received(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.employee_report_inventory_loss(uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_report_inventory_loss(uuid, uuid, numeric, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_approve_employee_inventory_loss_report(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_approve_employee_inventory_loss_report(uuid, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_reject_employee_inventory_loss_report(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_reject_employee_inventory_loss_report(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_update_employee_inventory_loss_report(uuid, numeric, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_update_employee_inventory_loss_report(uuid, numeric, text, text, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_inventory_loss_event(uuid, uuid, uuid, numeric, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_inventory_loss_event(uuid, uuid, uuid, numeric, text, text, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.record_inventory_loss_event(uuid, uuid, uuid, numeric, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_inventory_loss_event(uuid, uuid, uuid, numeric, text, text, numeric, numeric) TO authenticated;
