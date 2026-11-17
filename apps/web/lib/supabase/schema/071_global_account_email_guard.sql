-- One email represents one Retivox account across all businesses and roles.
-- The normalized unique index from migration 070 is the final concurrency guard.
CREATE OR REPLACE FUNCTION public.retivox_account_email_in_use(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.users
     WHERE lower(trim(email)) = lower(trim(p_email))
  );
$$;

REVOKE ALL ON FUNCTION public.retivox_account_email_in_use(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retivox_account_email_in_use(text) TO service_role;
