-- Keep the legacy sale writers callable by signed-in clients that use the
-- authenticated Supabase role, but remove the default PUBLIC/anon exposure.
-- Current UI flows call the authenticated v2/split wrappers; those wrappers
-- invoke these writers under their own database ownership.
REVOKE ALL ON FUNCTION public.dashboard_record_transaction(
  uuid, jsonb, text, numeric, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_record_transaction(
  uuid, jsonb, text, numeric, text, text, text, text
) TO authenticated;

REVOKE ALL ON FUNCTION public.employee_record_transaction(
  jsonb, text, numeric, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_record_transaction(
  jsonb, text, numeric, text, text, text, text
) TO authenticated;
