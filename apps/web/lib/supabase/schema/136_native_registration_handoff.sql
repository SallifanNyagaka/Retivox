-- Configure the registration route and support short-lived, one-use native
-- sessions after web-based account creation. Handoff rows are service-only.

ALTER TABLE public.platform_runtime_settings
  ADD COLUMN IF NOT EXISTS account_registration_path text NOT NULL DEFAULT '/register';

ALTER TABLE public.platform_runtime_settings
  DROP CONSTRAINT IF EXISTS platform_runtime_settings_registration_path_check;
ALTER TABLE public.platform_runtime_settings
  ADD CONSTRAINT platform_runtime_settings_registration_path_check
  CHECK (account_registration_path ~ '^/[A-Za-z0-9/_-]*$');

DROP FUNCTION IF EXISTS public.public_app_runtime_config();
CREATE FUNCTION public.public_app_runtime_config()
RETURNS TABLE(web_app_url text, account_registration_url text, updated_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT settings.web_app_url,
         regexp_replace(settings.web_app_url, '/+$', '') || settings.account_registration_path,
         settings.updated_at
    FROM public.platform_runtime_settings AS settings
   WHERE settings.id = true;
$$;
REVOKE ALL ON FUNCTION public.public_app_runtime_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_app_runtime_config() TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.platform_get_runtime_settings();
CREATE FUNCTION public.platform_get_runtime_settings()
RETURNS TABLE(web_app_url text, account_registration_path text, updated_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT settings.web_app_url, settings.account_registration_path, settings.updated_at
    FROM public.platform_runtime_settings AS settings
   WHERE settings.id = true;
$$;
REVOKE ALL ON FUNCTION public.platform_get_runtime_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_get_runtime_settings() TO service_role;

DROP FUNCTION IF EXISTS public.platform_save_runtime_settings(text, uuid);
CREATE FUNCTION public.platform_save_runtime_settings(
  p_web_app_url text,
  p_account_registration_path text,
  p_updated_by uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_url text := trim(COALESCE(p_web_app_url, ''));
  v_path text := trim(COALESCE(p_account_registration_path, ''));
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_users
     WHERE id = p_updated_by AND is_active = true AND role = 'developer'
  ) THEN
    RAISE EXCEPTION 'Only an active platform developer may update runtime settings';
  END IF;
  IF v_url !~ '^https?://[^/]+/?$'
     OR (v_url NOT LIKE 'https://%' AND v_url !~ '^http://(localhost|127[.]0[.]0[.]1)(:[0-9]+)?/?$') THEN
    RAISE EXCEPTION 'Enter a secure HTTPS application URL';
  END IF;
  IF v_path !~ '^/[A-Za-z0-9/_-]*$' OR v_path LIKE '%//%' THEN
    RAISE EXCEPTION 'Enter a valid same-site account registration path';
  END IF;

  INSERT INTO public.platform_runtime_settings
    (id, web_app_url, account_registration_path, updated_by, updated_at)
  VALUES (true, regexp_replace(v_url, '/+$', ''), v_path, p_updated_by, now())
  ON CONFLICT (id) DO UPDATE
    SET web_app_url = EXCLUDED.web_app_url,
        account_registration_path = EXCLUDED.account_registration_path,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_save_runtime_settings(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_save_runtime_settings(text, text, uuid) TO service_role;

-- Keep older platform instances able to save the canonical URL during rollout
-- without resetting a developer's selected registration path.
CREATE FUNCTION public.platform_save_runtime_settings(
  p_web_app_url text,
  p_updated_by uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_path text;
BEGIN
  SELECT settings.account_registration_path INTO v_path
    FROM public.platform_runtime_settings AS settings
   WHERE settings.id = true;
  RETURN public.platform_save_runtime_settings(p_web_app_url, COALESCE(v_path, '/register'), p_updated_by);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_save_runtime_settings(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_save_runtime_settings(text, uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.native_app_auth_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '3 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.native_app_auth_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.native_app_auth_handoffs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.native_app_auth_handoffs TO service_role;

CREATE OR REPLACE FUNCTION public.consume_native_app_auth_handoff(
  p_code_hash text,
  p_code_challenge text
)
RETURNS TABLE(user_id uuid, refresh_token text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  DELETE FROM public.native_app_auth_handoffs AS handoff
   WHERE handoff.id = (
     SELECT candidate.id
       FROM public.native_app_auth_handoffs AS candidate
      WHERE candidate.code_hash = p_code_hash
        AND candidate.code_challenge = p_code_challenge
        AND candidate.expires_at > now()
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING handoff.user_id, handoff.refresh_token;
$$;
REVOKE ALL ON FUNCTION public.consume_native_app_auth_handoff(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_native_app_auth_handoff(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
