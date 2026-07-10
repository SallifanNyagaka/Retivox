/*
 * Recurring finance expenses for Retivox.
 *
 * Owners can store monthly expenses such as rent, salaries, electricity, and
 * internet. The system creates pending monthly instances that owners confirm,
 * edit, or skip. Only confirmed instances are copied into finance_expenses and
 * deducted from profit.
 */

CREATE TABLE IF NOT EXISTS public.finance_recurring_expense_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  category text NOT NULL,
  description text NOT NULL,
  default_amount numeric(12,2) NOT NULL,
  frequency text NOT NULL DEFAULT 'monthly',
  due_day integer NOT NULL DEFAULT 28,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_recurring_templates_amount_positive CHECK (default_amount > 0),
  CONSTRAINT finance_recurring_templates_frequency_valid CHECK (frequency IN ('monthly')),
  CONSTRAINT finance_recurring_templates_due_day_valid CHECK (due_day BETWEEN 1 AND 31),
  CONSTRAINT finance_recurring_templates_category_present CHECK (NULLIF(trim(category), '') IS NOT NULL),
  CONSTRAINT finance_recurring_templates_description_present CHECK (NULLIF(trim(description), '') IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.finance_recurring_expense_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.finance_recurring_expense_templates(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  category text NOT NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  finance_expense_id uuid REFERENCES public.finance_expenses(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.users(id),
  confirmed_by uuid REFERENCES public.users(id),
  confirmed_at timestamptz,
  skipped_by uuid REFERENCES public.users(id),
  skipped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_recurring_instances_amount_positive CHECK (amount > 0),
  CONSTRAINT finance_recurring_instances_status_valid CHECK (status IN ('pending', 'confirmed', 'skipped')),
  CONSTRAINT finance_recurring_instances_period_valid CHECK (period_end >= period_start),
  CONSTRAINT finance_recurring_instances_unique_period UNIQUE (template_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_finance_recurring_templates_business_active
  ON public.finance_recurring_expense_templates (business_id, is_active, due_day);

CREATE INDEX IF NOT EXISTS idx_finance_recurring_instances_business_due_status
  ON public.finance_recurring_expense_instances (business_id, due_on, status);

ALTER TABLE public.finance_recurring_expense_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_recurring_expense_instances ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'finance_recurring_expense_templates'
       AND policyname = 'finance_recurring_templates_owner_select'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "finance_recurring_templates_owner_select" ON public.finance_recurring_expense_templates
      FOR SELECT
      USING (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() = 'owner'
      )
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'finance_recurring_expense_instances'
       AND policyname = 'finance_recurring_instances_owner_select'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "finance_recurring_instances_owner_select" ON public.finance_recurring_expense_instances
      FOR SELECT
      USING (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() = 'owner'
      )
    $policy$;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_finance_recurring_templates_updated_at ON public.finance_recurring_expense_templates;
CREATE TRIGGER touch_finance_recurring_templates_updated_at
BEFORE UPDATE ON public.finance_recurring_expense_templates
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_finance_recurring_instances_updated_at ON public.finance_recurring_expense_instances;
CREATE TRIGGER touch_finance_recurring_instances_updated_at
BEFORE UPDATE ON public.finance_recurring_expense_instances
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.upsert_recurring_finance_expense_template(
  p_template_id uuid,
  p_branch_id uuid,
  p_category text,
  p_description text,
  p_default_amount numeric,
  p_due_day integer DEFAULT 28,
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_template_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_default_amount IS NULL OR p_default_amount <= 0 THEN
    RAISE EXCEPTION 'Recurring expense amount must be greater than zero';
  END IF;

  IF COALESCE(p_due_day, 28) < 1 OR COALESCE(p_due_day, 28) > 31 THEN
    RAISE EXCEPTION 'Due day must be between 1 and 31';
  END IF;

  IF NULLIF(trim(COALESCE(p_category, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Expense category is required';
  END IF;

  IF NULLIF(trim(COALESCE(p_description, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Expense description is required';
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.branches
     WHERE branches.id = p_branch_id
       AND branches.business_id = v_business_id
       AND branches.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  IF p_template_id IS NULL THEN
    INSERT INTO public.finance_recurring_expense_templates (
      business_id,
      branch_id,
      category,
      description,
      default_amount,
      frequency,
      due_day,
      is_active,
      created_by,
      updated_by
    )
    VALUES (
      v_business_id,
      p_branch_id,
      trim(p_category),
      trim(p_description),
      round(p_default_amount, 2),
      'monthly',
      COALESCE(p_due_day, 28),
      COALESCE(p_is_active, true),
      v_actor_id,
      v_actor_id
    )
    RETURNING id INTO v_template_id;
  ELSE
    UPDATE public.finance_recurring_expense_templates
       SET branch_id = p_branch_id,
           category = trim(p_category),
           description = trim(p_description),
           default_amount = round(p_default_amount, 2),
           due_day = COALESCE(p_due_day, 28),
           is_active = COALESCE(p_is_active, true),
           updated_by = v_actor_id
     WHERE id = p_template_id
       AND business_id = v_business_id
    RETURNING id INTO v_template_id;

    IF v_template_id IS NULL THEN
      RAISE EXCEPTION 'Recurring expense not found';
    END IF;
  END IF;

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
    v_business_id,
    v_actor_id,
    'finance_recurring_expense_template',
    v_template_id,
    CASE WHEN p_template_id IS NULL THEN 'created' ELSE 'updated' END,
    NULL,
    jsonb_build_object(
      'branch_id', p_branch_id,
      'category', trim(p_category),
      'description', trim(p_description),
      'default_amount', round(p_default_amount, 2),
      'due_day', COALESCE(p_due_day, 28),
      'is_active', COALESCE(p_is_active, true)
    )
  );

  RETURN v_template_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_recurring_finance_expense_instances(
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_period_start date;
  v_period_end date;
  v_inserted_count integer := 0;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_period_start := date_trunc('month', COALESCE(p_as_of, CURRENT_DATE))::date;
  v_period_end := (v_period_start + interval '1 month - 1 day')::date;

  INSERT INTO public.finance_recurring_expense_instances (
    template_id,
    business_id,
    branch_id,
    category,
    description,
    amount,
    period_start,
    period_end,
    due_on,
    status,
    created_by
  )
  SELECT
    templates.id,
    templates.business_id,
    templates.branch_id,
    templates.category,
    templates.description,
    templates.default_amount,
    v_period_start,
    v_period_end,
    LEAST(v_period_start + ((templates.due_day - 1) * interval '1 day'), v_period_end)::date,
    'pending',
    v_actor_id
  FROM public.finance_recurring_expense_templates AS templates
  WHERE templates.business_id = v_business_id
    AND templates.is_active = true
    AND templates.frequency = 'monthly'
  ON CONFLICT (template_id, period_start) DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  RETURN v_inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_recurring_finance_expense_instance(
  p_instance_id uuid,
  p_amount numeric DEFAULT NULL,
  p_incurred_on date DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_instance public.finance_recurring_expense_instances%ROWTYPE;
  v_expense_id uuid;
  v_amount numeric(12,2);
  v_description text;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT *
    INTO v_instance
    FROM public.finance_recurring_expense_instances
   WHERE id = p_instance_id
     AND business_id = v_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recurring expense instance not found';
  END IF;

  IF v_instance.status = 'confirmed' AND v_instance.finance_expense_id IS NOT NULL THEN
    RETURN v_instance.finance_expense_id;
  END IF;

  v_amount := round(COALESCE(p_amount, v_instance.amount), 2);
  v_description := COALESCE(NULLIF(trim(COALESCE(p_description, '')), ''), v_instance.description);

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Expense amount must be greater than zero';
  END IF;

  INSERT INTO public.finance_expenses (
    business_id,
    branch_id,
    category,
    description,
    amount,
    incurred_on,
    created_by
  )
  VALUES (
    v_business_id,
    v_instance.branch_id,
    v_instance.category,
    v_description,
    v_amount,
    COALESCE(p_incurred_on, v_instance.due_on),
    v_actor_id
  )
  RETURNING id INTO v_expense_id;

  UPDATE public.finance_recurring_expense_instances
     SET amount = v_amount,
         description = v_description,
         status = 'confirmed',
         finance_expense_id = v_expense_id,
         confirmed_by = v_actor_id,
         confirmed_at = now()
   WHERE id = v_instance.id;

  RETURN v_expense_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.skip_recurring_finance_expense_instance(
  p_instance_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.finance_recurring_expense_instances
     SET status = 'skipped',
         skipped_by = v_actor_id,
         skipped_at = now()
   WHERE id = p_instance_id
     AND business_id = v_business_id
     AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending recurring expense not found';
  END IF;
END;
$$;
