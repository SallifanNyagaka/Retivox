-- Protect high-impact owner operations from anonymous RPC invocation while
-- preserving signed-in dashboard access and the functions' internal role checks.
REVOKE ALL ON FUNCTION public.owner_hard_delete_staff_user(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_hard_delete_staff_user(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.owner_create_product(text, text, text, text, text, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_create_product(text, text, text, text, text, numeric, numeric, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.owner_update_product(uuid, text, text, text, text, text, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_update_product(uuid, text, text, text, text, text, numeric, numeric, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.owner_toggle_product_status(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_toggle_product_status(uuid, boolean) TO authenticated;
