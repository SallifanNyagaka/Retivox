/**
 * Adds soft-delete metadata to core operational records.
 *
 * We intentionally avoid hard-deleting users, products, and branches because
 * historical transactions, transfers, stock movement, and audit logs must stay
 * traceable in a production retail system.
 */

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS delete_reason text;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS delete_reason text;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS delete_reason text;

CREATE INDEX IF NOT EXISTS idx_users_business_deleted_at
  ON public.users (business_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_products_business_deleted_at
  ON public.products (business_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_branches_business_deleted_at
  ON public.branches (business_id, deleted_at);

COMMIT;
