-- The function is attached to PostgreSQL's DDL event trigger and is not an API RPC.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
