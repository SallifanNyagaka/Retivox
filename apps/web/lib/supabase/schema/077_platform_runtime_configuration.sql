-- Public, non-secret runtime configuration for native clients.
CREATE TABLE IF NOT EXISTS public.platform_runtime_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  web_app_url text NOT NULL,
  updated_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (web_app_url ~ '^https?://[^/]+/?$')
);

ALTER TABLE public.platform_runtime_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_runtime_settings FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_app_runtime_config()
RETURNS TABLE(web_app_url text, updated_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT settings.web_app_url, settings.updated_at
    FROM public.platform_runtime_settings AS settings
   WHERE settings.id = true;
$$;
REVOKE ALL ON FUNCTION public.public_app_runtime_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_app_runtime_config() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_save_runtime_settings(
  p_web_app_url text,
  p_updated_by uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_url text := trim(COALESCE(p_web_app_url, ''));
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

  INSERT INTO public.platform_runtime_settings (id, web_app_url, updated_by, updated_at)
  VALUES (true, regexp_replace(v_url, '/+$', ''), p_updated_by, now())
  ON CONFLICT (id) DO UPDATE
    SET web_app_url = EXCLUDED.web_app_url,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_save_runtime_settings(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_save_runtime_settings(text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_get_runtime_settings()
RETURNS TABLE(web_app_url text, updated_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT settings.web_app_url, settings.updated_at
    FROM public.platform_runtime_settings AS settings
   WHERE settings.id = true;
$$;
REVOKE ALL ON FUNCTION public.platform_get_runtime_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_get_runtime_settings() TO service_role;
