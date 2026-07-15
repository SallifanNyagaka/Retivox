/*
 * Owner-submitted login review approval workflow.
 *
 * Owners can submit only their own owner-facing review. Platform developers
 * approve it before it appears publicly on the owner login page.
 */

ALTER TABLE public.login_reviews
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.platform_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'login_reviews_status_valid'
       AND conrelid = 'public.login_reviews'::regclass
  ) THEN
    ALTER TABLE public.login_reviews
      ADD CONSTRAINT login_reviews_status_valid CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END;
$$;

UPDATE public.login_reviews
   SET status = 'approved',
       approved_at = COALESCE(approved_at, created_at)
 WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_login_reviews_submitted_by_created
  ON public.login_reviews (submitted_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_reviews_status_created
  ON public.login_reviews (status, created_at DESC);

DROP POLICY IF EXISTS "login_reviews_owner_manage" ON public.login_reviews;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'login_reviews'
       AND policyname = 'login_reviews_owner_select_own'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "login_reviews_owner_select_own" ON public.login_reviews
      FOR SELECT
      USING (
        public.get_my_global_role() = 'owner'
        AND submitted_by = auth.uid()
      )
    $policy$;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.public_login_reviews(
  p_role text DEFAULT NULL,
  p_limit integer DEFAULT 8
)
RETURNS TABLE(
  id uuid,
  role text,
  quote text,
  reviewer_name text,
  reviewer_title text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    login_reviews.id,
    login_reviews.role,
    login_reviews.quote,
    login_reviews.reviewer_name,
    login_reviews.reviewer_title
  FROM public.login_reviews
  WHERE login_reviews.is_active = true
    AND login_reviews.status = 'approved'
    AND (
      p_role IS NULL
      OR p_role = ''
      OR login_reviews.role = p_role
    )
  ORDER BY login_reviews.sort_order ASC, login_reviews.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20);
$$;

CREATE OR REPLACE FUNCTION public.owner_submit_login_review(
  p_quote text,
  p_reviewer_title text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_review_id uuid;
BEGIN
  SELECT *
    INTO v_actor
    FROM public.users
   WHERE id = auth.uid()
     AND global_role = 'owner'
     AND is_active = true;

  IF NOT FOUND OR v_actor.business_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NULLIF(trim(COALESCE(p_quote, '')), '') IS NULL OR length(trim(p_quote)) < 10 THEN
    RAISE EXCEPTION 'Review must be at least 10 characters';
  END IF;

  INSERT INTO public.login_reviews (
    role,
    quote,
    reviewer_name,
    reviewer_title,
    business_id,
    submitted_by,
    status,
    is_active,
    sort_order
  )
  VALUES (
    'owner',
    trim(p_quote),
    v_actor.name,
    COALESCE(NULLIF(trim(COALESCE(p_reviewer_title, '')), ''), 'Owner'),
    v_actor.business_id,
    v_actor.id,
    'pending',
    false,
    100
  )
  RETURNING id INTO v_review_id;

  INSERT INTO public.audit_logs (
    business_id,
    actor_id,
    entity_type,
    entity_id,
    action,
    old_value,
    new_value
  )
  VALUES (
    v_actor.business_id,
    v_actor.id,
    'login_review',
    v_review_id,
    'submitted_for_approval',
    NULL,
    jsonb_build_object('role', 'owner')
  );

  RETURN v_review_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_my_login_reviews(p_limit integer DEFAULT 10)
RETURNS TABLE(
  id uuid,
  role text,
  quote text,
  reviewer_name text,
  reviewer_title text,
  sort_order integer,
  is_active boolean,
  status text,
  review_note text,
  created_at timestamptz,
  approved_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    login_reviews.id,
    login_reviews.role,
    login_reviews.quote,
    login_reviews.reviewer_name,
    login_reviews.reviewer_title,
    login_reviews.sort_order,
    login_reviews.is_active,
    login_reviews.status,
    login_reviews.review_note,
    login_reviews.created_at,
    login_reviews.approved_at
  FROM public.login_reviews
  WHERE login_reviews.submitted_by = auth.uid()
    AND public.get_my_global_role() = 'owner'
  ORDER BY login_reviews.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.owner_submit_login_review(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_my_login_reviews(integer) TO authenticated;
