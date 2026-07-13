/*
 * Role-specific login reviews for Retivox.
 *
 * These reviews are public marketing content displayed before authentication.
 * They are separated by role so owners, admins, and employees see testimonials
 * from people with matching day-to-day responsibilities.
 */

CREATE TABLE IF NOT EXISTS public.login_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  quote text NOT NULL,
  reviewer_name text NOT NULL,
  reviewer_title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT login_reviews_role_valid CHECK (role IN ('owner', 'admin', 'employee')),
  CONSTRAINT login_reviews_quote_present CHECK (NULLIF(trim(quote), '') IS NOT NULL),
  CONSTRAINT login_reviews_reviewer_name_present CHECK (NULLIF(trim(reviewer_name), '') IS NOT NULL),
  CONSTRAINT login_reviews_reviewer_title_present CHECK (NULLIF(trim(reviewer_title), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_login_reviews_role_active_sort
  ON public.login_reviews (role, is_active, sort_order, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_login_reviews_role_quote_unique
  ON public.login_reviews (role, quote);

DROP TRIGGER IF EXISTS touch_login_reviews_updated_at ON public.login_reviews;
CREATE TRIGGER touch_login_reviews_updated_at
BEFORE UPDATE ON public.login_reviews
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.login_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'login_reviews'
       AND policyname = 'login_reviews_owner_manage'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "login_reviews_owner_manage" ON public.login_reviews
      FOR ALL
      USING (public.get_my_global_role() = 'owner')
      WITH CHECK (public.get_my_global_role() = 'owner')
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
    AND (
      p_role IS NULL
      OR p_role = ''
      OR login_reviews.role = p_role
    )
  ORDER BY login_reviews.sort_order ASC, login_reviews.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20);
$$;

GRANT EXECUTE ON FUNCTION public.public_login_reviews(text, integer) TO anon, authenticated;

INSERT INTO public.login_reviews (role, quote, reviewer_name, reviewer_title, sort_order)
VALUES
  ('owner', 'Retivox gives me one clean view of every branch without waiting for end-of-day calls.', 'James Kamau', 'Owner, Kamau Enterprises', 10),
  ('owner', 'I can see stock, sales, and cash movement from anywhere. It changed how fast we make decisions.', 'Sarah Wanjiku', 'Owner, Wanjiku Holdings', 20),
  ('admin', 'The admin dashboard helps me spot low stock and follow branch performance before small issues become expensive.', 'Mercy Achieng', 'Branch Admin, Green Basket Stores', 10),
  ('admin', 'Approvals, deliveries, and employee activity are easier to track because everything is in one place.', 'Brian Otieno', 'Operations Admin, RetailHub Kenya', 20),
  ('employee', 'Recording sales is quick, and damaged stock reporting is clear enough for busy counter work.', 'Faith Njeri', 'Sales Associate, Metro Mart', 10),
  ('employee', 'I always know what stock is available to sell, including owner-approved damaged items.', 'Peter Mwangi', 'Store Employee, QuickPick Retail', 20)
ON CONFLICT DO NOTHING;
