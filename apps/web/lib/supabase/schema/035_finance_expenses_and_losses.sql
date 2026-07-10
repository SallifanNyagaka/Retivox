/*
 * Owner finance expenses and inventory losses for Retivox.
 *
 * Gross profit remains based on stamped sale revenue/cost. Owner-only finance
 * records reduce that into net profit through operating expenses and inventory
 * losses such as breakage, spoilage, theft, or markdown damage.
 */

CREATE TABLE IF NOT EXISTS public.finance_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  category text NOT NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  incurred_on date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_expenses_amount_positive CHECK (amount > 0),
  CONSTRAINT finance_expenses_category_present CHECK (NULLIF(trim(category), '') IS NOT NULL),
  CONSTRAINT finance_expenses_description_present CHECK (NULLIF(trim(description), '') IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.inventory_loss_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  uom_id uuid NOT NULL REFERENCES public.units_of_measure(id) ON DELETE RESTRICT,
  loss_type text NOT NULL,
  reason text NOT NULL,
  quantity_in_uom numeric(12,4) NOT NULL,
  base_quantity numeric(12,4) NOT NULL,
  unit_cost_at_loss numeric(12,4) NOT NULL DEFAULT 0,
  gross_cost numeric(12,2) NOT NULL DEFAULT 0,
  recoverable_amount numeric(12,2) NOT NULL DEFAULT 0,
  net_loss numeric(12,2) NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_loss_events_loss_type_valid CHECK (loss_type IN ('breakage', 'spoilage', 'theft', 'markdown_damage', 'other')),
  CONSTRAINT inventory_loss_events_quantities_positive CHECK (quantity_in_uom > 0 AND base_quantity > 0),
  CONSTRAINT inventory_loss_events_costs_nonnegative CHECK (
    unit_cost_at_loss >= 0
    AND gross_cost >= 0
    AND recoverable_amount >= 0
    AND net_loss >= 0
  ),
  CONSTRAINT inventory_loss_events_reason_present CHECK (NULLIF(trim(reason), '') IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.inventory_recovery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loss_event_id uuid NOT NULL REFERENCES public.inventory_loss_events(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  uom_id uuid NOT NULL REFERENCES public.units_of_measure(id) ON DELETE RESTRICT,
  label text NOT NULL,
  quantity_in_uom numeric(12,4) NOT NULL,
  base_quantity numeric(12,4) NOT NULL,
  remaining_base_quantity numeric(12,4) NOT NULL,
  sale_price_per_uom numeric(12,2) NOT NULL,
  expected_recoverable_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_recovery_items_quantities_positive CHECK (
    quantity_in_uom > 0
    AND base_quantity > 0
    AND remaining_base_quantity >= 0
  ),
  CONSTRAINT inventory_recovery_items_price_positive CHECK (sale_price_per_uom > 0),
  CONSTRAINT inventory_recovery_items_recoverable_nonnegative CHECK (expected_recoverable_amount >= 0),
  CONSTRAINT inventory_recovery_items_label_present CHECK (NULLIF(trim(label), '') IS NOT NULL)
);

ALTER TABLE public.inventory_recovery_items
  ADD COLUMN IF NOT EXISTS expected_recoverable_amount numeric(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_finance_expenses_business_incurred
  ON public.finance_expenses (business_id, incurred_on DESC);

CREATE INDEX IF NOT EXISTS idx_finance_expenses_branch_incurred
  ON public.finance_expenses (business_id, branch_id, incurred_on DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_loss_events_business_created
  ON public.inventory_loss_events (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_loss_events_branch_product
  ON public.inventory_loss_events (business_id, branch_id, product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_recovery_items_available
  ON public.inventory_recovery_items (business_id, branch_id, product_id, remaining_base_quantity);

ALTER TABLE public.finance_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_loss_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_recovery_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'finance_expenses'
       AND policyname = 'finance_expenses_owner_select'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "finance_expenses_owner_select" ON public.finance_expenses
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
       AND tablename = 'inventory_loss_events'
       AND policyname = 'inventory_loss_events_owner_select'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "inventory_loss_events_owner_select" ON public.inventory_loss_events
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
       AND tablename = 'inventory_recovery_items'
       AND policyname = 'inventory_recovery_items_owner_select'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "inventory_recovery_items_owner_select" ON public.inventory_recovery_items
      FOR SELECT
      USING (
        business_id = public.get_my_business_id()
        AND public.get_my_global_role() = 'owner'
      )
    $policy$;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_owner_finance_expense(
  p_branch_id uuid,
  p_category text,
  p_description text,
  p_amount numeric,
  p_incurred_on date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_expense_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Expense amount must be greater than zero';
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
    p_branch_id,
    trim(p_category),
    trim(p_description),
    round(p_amount, 2),
    COALESCE(p_incurred_on, CURRENT_DATE),
    v_actor_id
  )
  RETURNING id INTO v_expense_id;

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
    'finance_expense',
    v_expense_id,
    'created',
    NULL,
    jsonb_build_object(
      'branch_id', p_branch_id,
      'category', trim(p_category),
      'description', trim(p_description),
      'amount', round(p_amount, 2),
      'incurred_on', COALESCE(p_incurred_on, CURRENT_DATE)
    )
  );

  RETURN v_expense_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_inventory_loss_event(
  p_branch_id uuid,
  p_product_id uuid,
  p_uom_id uuid,
  p_quantity_in_uom numeric,
  p_loss_type text,
  p_reason text,
  p_recoverable_amount numeric DEFAULT 0,
  p_recovery_sale_price_per_uom numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_uom public.units_of_measure%ROWTYPE;
  v_stock public.branch_stock%ROWTYPE;
  v_base_quantity numeric(12,4);
  v_gross_cost numeric(12,2);
  v_recoverable_amount numeric(12,2);
  v_net_loss numeric(12,2);
  v_loss_id uuid;
  v_recovery_id uuid;
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();

  IF v_actor_id IS NULL OR v_business_id IS NULL OR public.get_my_global_role() <> 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_quantity_in_uom IS NULL OR p_quantity_in_uom <= 0 THEN
    RAISE EXCEPTION 'Loss quantity must be greater than zero';
  END IF;

  IF p_loss_type NOT IN ('breakage', 'spoilage', 'theft', 'markdown_damage', 'other') THEN
    RAISE EXCEPTION 'Invalid loss type';
  END IF;

  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Loss reason is required';
  END IF;

  v_uom := public.assert_product_uom_link(v_business_id, p_product_id, p_uom_id);
  v_base_quantity := round(p_quantity_in_uom * v_uom.conversion_factor, 4);

  IF v_base_quantity <= 0 OR v_base_quantity <> floor(v_base_quantity) THEN
    RAISE EXCEPTION 'Loss quantity must convert to a whole base unit';
  END IF;

  SELECT *
    INTO v_stock
    FROM public.branch_stock
   WHERE business_id = v_business_id
     AND branch_id = p_branch_id
     AND product_id = p_product_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock record not found';
  END IF;

  IF (v_stock.base_quantity_on_hand - COALESCE(v_stock.base_quantity_reserved, 0)) < v_base_quantity THEN
    RAISE EXCEPTION 'Insufficient available stock for this loss';
  END IF;

  v_gross_cost := round(v_base_quantity * COALESCE(v_stock.average_base_unit_cost, 0), 2);
  v_recoverable_amount := CASE
    WHEN COALESCE(p_recovery_sale_price_per_uom, 0) > 0 THEN round(p_quantity_in_uom * p_recovery_sale_price_per_uom, 2)
    ELSE round(GREATEST(COALESCE(p_recoverable_amount, 0), 0), 2)
  END;
  v_net_loss := round(GREATEST(v_gross_cost - v_recoverable_amount, 0), 2);

  UPDATE public.branch_stock
     SET base_quantity_on_hand = round(base_quantity_on_hand - v_base_quantity, 4),
         quantity_on_hand = floor(base_quantity_on_hand - v_base_quantity)::integer,
         last_updated_at = now()
   WHERE id = v_stock.id;

  INSERT INTO public.inventory_loss_events (
    business_id,
    branch_id,
    product_id,
    uom_id,
    loss_type,
    reason,
    quantity_in_uom,
    base_quantity,
    unit_cost_at_loss,
    gross_cost,
    recoverable_amount,
    net_loss,
    created_by
  )
  VALUES (
    v_business_id,
    p_branch_id,
    p_product_id,
    p_uom_id,
    p_loss_type,
    trim(p_reason),
    p_quantity_in_uom,
    v_base_quantity,
    COALESCE(v_stock.average_base_unit_cost, 0),
    v_gross_cost,
    v_recoverable_amount,
    v_net_loss,
    v_actor_id
  )
  RETURNING id INTO v_loss_id;

  IF COALESCE(p_recovery_sale_price_per_uom, 0) > 0 THEN
    INSERT INTO public.inventory_recovery_items (
      loss_event_id,
      business_id,
      branch_id,
      product_id,
      uom_id,
      label,
      quantity_in_uom,
      base_quantity,
      remaining_base_quantity,
      sale_price_per_uom,
      expected_recoverable_amount,
      created_by
    )
    VALUES (
      v_loss_id,
      v_business_id,
      p_branch_id,
      p_product_id,
      p_uom_id,
      trim(p_reason),
      p_quantity_in_uom,
      v_base_quantity,
      v_base_quantity,
      round(p_recovery_sale_price_per_uom, 2),
      v_recoverable_amount,
      v_actor_id
    )
    RETURNING id INTO v_recovery_id;
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
    'inventory_loss',
    v_loss_id,
    'recorded',
    jsonb_build_object(
      'stock_id', v_stock.id,
      'old_base_quantity_on_hand', v_stock.base_quantity_on_hand
    ),
    jsonb_build_object(
      'branch_id', p_branch_id,
      'product_id', p_product_id,
      'uom_id', p_uom_id,
      'loss_type', p_loss_type,
      'quantity_in_uom', p_quantity_in_uom,
      'base_quantity', v_base_quantity,
      'gross_cost', v_gross_cost,
      'recoverable_amount', v_recoverable_amount,
      'recovery_sale_price_per_uom', p_recovery_sale_price_per_uom,
      'recovery_item_id', v_recovery_id,
      'net_loss', v_net_loss,
      'new_base_quantity_on_hand', round(v_stock.base_quantity_on_hand - v_base_quantity, 4)
    )
  );

  RETURN v_loss_id;
END;
$$;

ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS recovery_item_id uuid REFERENCES public.inventory_recovery_items(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.employee_available_products_normal(p_branch_id uuid)
RETURNS TABLE(
  product_id uuid,
  name text,
  sku text,
  category text,
  unit text,
  selling_price numeric,
  pricing_method text,
  rounding_rule text,
  pricing_options jsonb,
  uom_options jsonb,
  quantity_on_hand integer,
  quantity_reserved integer,
  base_quantity_on_hand numeric,
  base_quantity_reserved numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped_products AS (
    SELECT
      products.id AS product_id,
      products.name,
      products.sku,
      products.category,
      products.unit,
      branch_stock.quantity_on_hand,
      branch_stock.quantity_reserved,
      branch_stock.base_quantity_on_hand,
      branch_stock.base_quantity_reserved
    FROM public.branch_stock
    JOIN public.products
      ON products.id = branch_stock.product_id
     AND products.business_id = branch_stock.business_id
    WHERE branch_stock.business_id = public.get_my_business_id()
      AND branch_stock.branch_id = p_branch_id
      AND products.is_active = true
      AND products.deleted_at IS NULL
      AND (branch_stock.base_quantity_on_hand - branch_stock.base_quantity_reserved) > 0
  ),
  resolved_models AS (
    SELECT
      scoped_products.*,
      product_pricing_models.id AS pricing_model_id,
      product_pricing_models.pricing_method,
      product_pricing_models.rounding_rule
    FROM scoped_products
    LEFT JOIN LATERAL (
      SELECT *
        FROM public.product_pricing_models
       WHERE product_pricing_models.business_id = public.get_my_business_id()
         AND product_pricing_models.product_id = scoped_products.product_id
         AND product_pricing_models.status = 'approved'
         AND (product_pricing_models.branch_id = p_branch_id OR product_pricing_models.branch_id IS NULL)
       ORDER BY
         CASE WHEN product_pricing_models.branch_id = p_branch_id THEN 0 ELSE 1 END,
         CASE product_pricing_models.pricing_method
           WHEN 'assisted_pack' THEN 0
           WHEN 'manual_quantity' THEN 1
           ELSE 2
         END,
         product_pricing_models.approved_at DESC NULLS LAST,
         product_pricing_models.created_at DESC
       LIMIT 1
    ) AS product_pricing_models ON true
  )
  SELECT
    resolved_models.product_id,
    resolved_models.name,
    resolved_models.sku,
    resolved_models.category,
    resolved_models.unit,
    COALESCE(
      (
        SELECT product_price_points.price
          FROM public.product_price_points
         WHERE product_price_points.pricing_model_id = resolved_models.pricing_model_id
           AND product_price_points.business_id = public.get_my_business_id()
           AND product_price_points.product_id = resolved_models.product_id
         ORDER BY
           CASE
             WHEN product_price_points.uom_id = public.get_product_default_sale_uom_id(public.get_my_business_id(), resolved_models.product_id) THEN 0
             ELSE 1
           END,
           product_price_points.base_quantity ASC
         LIMIT 1
      ),
      (
        SELECT product_pricing.base_price
          FROM public.product_pricing
         WHERE product_pricing.business_id = public.get_my_business_id()
           AND product_pricing.product_id = resolved_models.product_id
         ORDER BY product_pricing.effective_from DESC
         LIMIT 1
      ),
      0
    ) AS selling_price,
    CASE
      WHEN resolved_models.pricing_method = 'assisted_pack'
       AND COALESCE(resolved_models.rounding_rule, 'none') = 'none'
       AND NOT EXISTS (
         SELECT 1
           FROM public.product_price_points
          WHERE product_price_points.pricing_model_id = resolved_models.pricing_model_id
            AND product_price_points.business_id = public.get_my_business_id()
            AND product_price_points.product_id = resolved_models.product_id
            AND product_price_points.quantity_in_uom <> 1
       )
      THEN 'fixed_price'
      ELSE COALESCE(resolved_models.pricing_method, 'fixed_price')
    END AS pricing_method,
    COALESCE(resolved_models.rounding_rule, 'nearest_5') AS rounding_rule,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'quantity', product_price_points.quantity_in_uom,
            'baseQuantity', product_price_points.base_quantity,
            'price', product_price_points.price,
            'maxDiscountAmount', product_price_points.max_discount_amount,
            'uomId', product_price_points.uom_id
          )
          ORDER BY
            product_price_points.uom_id NULLS LAST,
            product_price_points.base_quantity ASC
        )
          FROM public.product_price_points
         WHERE product_price_points.pricing_model_id = resolved_models.pricing_model_id
           AND product_price_points.business_id = public.get_my_business_id()
           AND product_price_points.product_id = resolved_models.product_id
      ),
      '[]'::jsonb
    ) AS pricing_options,
    public.get_product_uom_options_json(public.get_my_business_id(), resolved_models.product_id) AS uom_options,
    resolved_models.quantity_on_hand,
    resolved_models.quantity_reserved,
    resolved_models.base_quantity_on_hand,
    resolved_models.base_quantity_reserved
  FROM resolved_models
  WHERE jsonb_array_length(public.get_product_uom_options_json(public.get_my_business_id(), resolved_models.product_id)) > 0
    AND (
      (
        resolved_models.pricing_method IN ('assisted_pack', 'manual_quantity')
        AND EXISTS (
          SELECT 1
            FROM public.product_price_points
           WHERE product_price_points.pricing_model_id = resolved_models.pricing_model_id
             AND product_price_points.business_id = public.get_my_business_id()
             AND product_price_points.product_id = resolved_models.product_id
        )
      )
      OR (
        COALESCE(resolved_models.pricing_method, 'fixed_price') = 'fixed_price'
        AND EXISTS (
          SELECT 1
            FROM public.product_pricing
           WHERE product_pricing.business_id = public.get_my_business_id()
             AND product_pricing.product_id = resolved_models.product_id
        )
      )
    );
$$;

DROP FUNCTION IF EXISTS public.employee_available_products(uuid);

CREATE OR REPLACE FUNCTION public.employee_available_products(p_branch_id uuid)
RETURNS TABLE(
  product_id uuid,
  name text,
  sku text,
  category text,
  unit text,
  selling_price numeric,
  pricing_method text,
  rounding_rule text,
  pricing_options jsonb,
  uom_options jsonb,
  quantity_on_hand integer,
  quantity_reserved integer,
  base_quantity_on_hand numeric,
  base_quantity_reserved numeric,
  recovery_item_id uuid,
  stock_source text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH normal_products AS (
    SELECT *
      FROM public.employee_available_products_normal(p_branch_id)
  ),
  recovery_products AS (
    SELECT
      products.id AS product_id,
      (products.name || ' - discounted recovery')::text AS name,
      products.sku,
      products.category,
      units_of_measure.name AS unit,
      inventory_recovery_items.sale_price_per_uom AS selling_price,
      'fixed_price'::text AS pricing_method,
      'none'::text AS rounding_rule,
      jsonb_build_array(
        jsonb_build_object(
          'quantity', 1,
          'baseQuantity', units_of_measure.conversion_factor,
          'price', inventory_recovery_items.sale_price_per_uom,
          'maxDiscountAmount', 0,
          'uomId', inventory_recovery_items.uom_id
        )
      ) AS pricing_options,
      jsonb_build_array(
        jsonb_build_object(
          'id', units_of_measure.id,
          'name', units_of_measure.name,
          'abbreviation', units_of_measure.abbreviation,
          'conversionFactor', units_of_measure.conversion_factor,
          'isBaseUnit', units_of_measure.is_base_unit,
          'isBaseUom', units_of_measure.conversion_factor = 1,
          'isDefaultSaleUom', true,
          'isDefaultPurchaseUom', false
        )
      ) AS uom_options,
      floor(inventory_recovery_items.remaining_base_quantity)::integer AS quantity_on_hand,
      0::integer AS quantity_reserved,
      inventory_recovery_items.remaining_base_quantity AS base_quantity_on_hand,
      0::numeric AS base_quantity_reserved,
      inventory_recovery_items.id AS recovery_item_id,
      'recovery'::text AS stock_source
    FROM public.inventory_recovery_items
    JOIN public.products
      ON products.id = inventory_recovery_items.product_id
     AND products.business_id = inventory_recovery_items.business_id
    JOIN public.units_of_measure
      ON units_of_measure.id = inventory_recovery_items.uom_id
     AND units_of_measure.business_id = inventory_recovery_items.business_id
    WHERE inventory_recovery_items.business_id = public.get_my_business_id()
      AND inventory_recovery_items.branch_id = p_branch_id
      AND inventory_recovery_items.remaining_base_quantity > 0
      AND products.is_active = true
      AND products.deleted_at IS NULL
  )
  SELECT
    normal_products.product_id,
    normal_products.name,
    normal_products.sku,
    normal_products.category,
    normal_products.unit,
    normal_products.selling_price,
    normal_products.pricing_method,
    normal_products.rounding_rule,
    normal_products.pricing_options,
    normal_products.uom_options,
    normal_products.quantity_on_hand,
    normal_products.quantity_reserved,
    normal_products.base_quantity_on_hand,
    normal_products.base_quantity_reserved,
    NULL::uuid AS recovery_item_id,
    'normal'::text AS stock_source
  FROM normal_products
  UNION ALL
  SELECT *
    FROM recovery_products
  ORDER BY name ASC;
$$;

DROP FUNCTION IF EXISTS public.employee_record_transaction(jsonb, text, numeric, text, text, text, text);

CREATE OR REPLACE FUNCTION public.employee_record_transaction(
  p_items jsonb,
  p_payment_method text,
  p_discount_amount numeric DEFAULT 0,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_mpesa_ref_code text DEFAULT NULL,
  p_cash_deposit_code text DEFAULT NULL
)
RETURNS TABLE(
  transaction_id uuid,
  status text,
  recorded_at timestamptz,
  total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_business_id uuid;
  v_branch_id uuid;
  v_branch public.branches%ROWTYPE;
  v_customer_id uuid;
  v_transaction_id uuid;
  v_item record;
  v_stock public.branch_stock%ROWTYPE;
  v_recovery public.inventory_recovery_items%ROWTYPE;
  v_resolved_price record;
  v_line_total numeric(10,2);
  v_unit_price numeric(10,2);
  v_unit_cost_at_sale numeric(12,4);
  v_line_cost numeric(12,2);
  v_subtotal numeric(10,2) := 0;
  v_discountable_subtotal numeric(10,2) := 0;
  v_discount_amount numeric(10,2) := COALESCE(p_discount_amount, 0);
  v_max_discount_amount numeric(10,2) := 0;
  v_line_max_discount_amount numeric(10,2) := 0;
  v_total_amount numeric(10,2);
  v_available_base_quantity numeric(12,4);
  v_base_quantity numeric(12,4);
  v_legacy_quantity integer;
  v_uom public.units_of_measure%ROWTYPE;
  v_payment_status text := 'pending_verify';
  v_recorded_at timestamptz := now();
BEGIN
  v_actor_id := auth.uid();
  v_business_id := public.get_my_business_id();
  v_branch_id := public.get_employee_branch_id(v_actor_id);

  IF v_actor_id IS NULL OR v_business_id IS NULL OR v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_employee_at_branch(v_actor_id, v_branch_id);

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one product';
  END IF;

  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'Record up to 50 line items at a time';
  END IF;

  IF p_payment_method NOT IN ('mpesa_manual', 'cash') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  IF p_payment_method = 'mpesa_manual' AND length(trim(COALESCE(p_mpesa_ref_code, ''))) < 5 THEN
    RAISE EXCEPTION 'Enter a valid M-Pesa reference code';
  END IF;

  IF p_payment_method = 'cash' AND length(trim(COALESCE(p_cash_deposit_code, ''))) < 3 THEN
    RAISE EXCEPTION 'Enter a valid cash deposit/reference code';
  END IF;

  SELECT *
    INTO v_branch
    FROM public.branches
   WHERE id = v_branch_id
     AND business_id = v_business_id
     AND is_active = true
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  IF NULLIF(trim(COALESCE(p_customer_phone, '')), '') IS NOT NULL THEN
    SELECT customers.id
      INTO v_customer_id
      FROM public.customers
     WHERE customers.business_id = v_business_id
       AND customers.phone = trim(p_customer_phone)
     LIMIT 1;

    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers (
        business_id,
        name,
        phone,
        first_purchase_at,
        last_purchase_at
      )
      VALUES (
        v_business_id,
        COALESCE(NULLIF(trim(COALESCE(p_customer_name, '')), ''), 'Walk-in customer'),
        trim(p_customer_phone),
        v_recorded_at,
        v_recorded_at
      )
      RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  INSERT INTO public.transactions (
    business_id,
    branch_id,
    employee_id,
    customer_id,
    status,
    subtotal,
    discount_amount,
    total_amount,
    origin,
    recorded_at,
    synced_at,
    sync_status
  )
  VALUES (
    v_business_id,
    v_branch_id,
    v_actor_id,
    v_customer_id,
    'pending_verify',
    0,
    0,
    0,
    'online',
    v_recorded_at,
    v_recorded_at,
    'synced'
  )
  RETURNING id INTO v_transaction_id;

  FOR v_item IN
    SELECT
      (item_value->>'productId')::uuid AS product_id,
      COALESCE(NULLIF(item_value->>'uomId', '')::uuid, public.get_product_default_sale_uom_id(v_business_id, (item_value->>'productId')::uuid)) AS uom_id,
      NULLIF(item_value->>'recoveryItemId', '')::uuid AS recovery_item_id,
      SUM((item_value->>'quantity')::numeric) AS quantity_in_uom
    FROM jsonb_array_elements(p_items) AS item_value
    GROUP BY
      (item_value->>'productId')::uuid,
      COALESCE(NULLIF(item_value->>'uomId', '')::uuid, public.get_product_default_sale_uom_id(v_business_id, (item_value->>'productId')::uuid)),
      NULLIF(item_value->>'recoveryItemId', '')::uuid
  LOOP
    IF v_item.product_id IS NULL OR v_item.uom_id IS NULL OR v_item.quantity_in_uom IS NULL OR v_item.quantity_in_uom <= 0 THEN
      RAISE EXCEPTION 'Each product quantity must be greater than zero';
    END IF;

    v_uom := public.assert_product_uom_link(v_business_id, v_item.product_id, v_item.uom_id);
    v_base_quantity := round(v_item.quantity_in_uom * v_uom.conversion_factor, 4);

    IF v_base_quantity <= 0 OR v_base_quantity <> floor(v_base_quantity) THEN
      RAISE EXCEPTION 'Sale quantity must convert to a whole base unit';
    END IF;

    v_legacy_quantity := floor(v_base_quantity)::integer;

    IF v_item.recovery_item_id IS NOT NULL THEN
      SELECT *
        INTO v_recovery
        FROM public.inventory_recovery_items
       WHERE id = v_item.recovery_item_id
         AND business_id = v_business_id
         AND branch_id = v_branch_id
         AND product_id = v_item.product_id
         AND uom_id = v_item.uom_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Recovery stock not found';
      END IF;

      IF v_recovery.remaining_base_quantity < v_base_quantity THEN
        RAISE EXCEPTION 'Insufficient recovery stock. Available base quantity: %', GREATEST(v_recovery.remaining_base_quantity, 0);
      END IF;

      v_line_total := round(v_item.quantity_in_uom * v_recovery.sale_price_per_uom, 2);
      v_unit_price := round(v_line_total / v_base_quantity, 2);
      v_unit_cost_at_sale := round(v_recovery.sale_price_per_uom / v_uom.conversion_factor, 4);
      v_line_cost := v_line_total;
      v_subtotal := round(v_subtotal + v_line_total, 2);

      INSERT INTO public.transaction_items (
        transaction_id,
        product_id,
        business_id,
        quantity,
        unit_price_at_sale,
        line_total,
        stock_status,
        uom_id,
        quantity_in_uom,
        base_quantity,
        unit_cost_at_sale,
        line_cost,
        net_line_total,
        gross_profit,
        recovery_item_id
      )
      VALUES (
        v_transaction_id,
        v_item.product_id,
        v_business_id,
        v_legacy_quantity,
        v_unit_price,
        v_line_total,
        'deducted',
        v_item.uom_id,
        v_item.quantity_in_uom,
        v_base_quantity,
        v_unit_cost_at_sale,
        v_line_cost,
        v_line_total,
        0,
        v_item.recovery_item_id
      );

      UPDATE public.inventory_recovery_items
         SET remaining_base_quantity = round(remaining_base_quantity - v_base_quantity, 4)
       WHERE id = v_recovery.id;
    ELSE
      IF NOT EXISTS (
        SELECT 1
          FROM public.product_uom_links
         WHERE business_id = v_business_id
           AND product_id = v_item.product_id
           AND uom_id = v_item.uom_id
           AND is_sale_uom = true
      ) THEN
        RAISE EXCEPTION 'Selected unit is not available for sales';
      END IF;

      SELECT branch_stock.*
        INTO v_stock
        FROM public.branch_stock
        JOIN public.products
          ON products.id = branch_stock.product_id
         AND products.business_id = branch_stock.business_id
       WHERE branch_stock.business_id = v_business_id
         AND branch_stock.branch_id = v_branch_id
         AND branch_stock.product_id = v_item.product_id
         AND products.is_active = true
         AND products.deleted_at IS NULL
       FOR UPDATE OF branch_stock;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'One or more products are not available at your branch';
      END IF;

      v_available_base_quantity := v_stock.base_quantity_on_hand - v_stock.base_quantity_reserved;

      IF v_available_base_quantity < v_base_quantity THEN
        RAISE EXCEPTION 'Insufficient stock. Available base quantity: %', GREATEST(v_available_base_quantity, 0);
      END IF;

      SELECT *
        INTO v_resolved_price
        FROM public.resolve_product_sale_price(v_business_id, v_branch_id, v_item.product_id, v_legacy_quantity, v_item.uom_id)
        LIMIT 1;

      IF v_resolved_price.line_total IS NULL OR v_resolved_price.line_total <= 0 THEN
        RAISE EXCEPTION 'Unable to resolve an approved price for one or more products';
      END IF;

      v_line_max_discount_amount := public.resolve_product_sale_discount(
        v_business_id,
        v_branch_id,
        v_item.product_id,
        v_legacy_quantity,
        v_item.uom_id
      );

      v_line_total := round(v_resolved_price.line_total, 2);
      v_unit_price := round(v_resolved_price.unit_price, 2);
      v_unit_cost_at_sale := COALESCE(v_stock.average_base_unit_cost, 0);
      v_line_cost := round(v_base_quantity * v_unit_cost_at_sale, 2);
      v_subtotal := round(v_subtotal + v_line_total, 2);
      v_discountable_subtotal := round(v_discountable_subtotal + v_line_total, 2);
      v_max_discount_amount := round(v_max_discount_amount + COALESCE(v_line_max_discount_amount, 0), 2);

      INSERT INTO public.transaction_items (
        transaction_id,
        product_id,
        business_id,
        quantity,
        unit_price_at_sale,
        line_total,
        stock_status,
        uom_id,
        quantity_in_uom,
        base_quantity,
        unit_cost_at_sale,
        line_cost,
        net_line_total,
        gross_profit
      )
      VALUES (
        v_transaction_id,
        v_item.product_id,
        v_business_id,
        v_legacy_quantity,
        v_unit_price,
        v_line_total,
        'deducted',
        v_item.uom_id,
        v_item.quantity_in_uom,
        v_base_quantity,
        v_unit_cost_at_sale,
        v_line_cost,
        v_line_total,
        round(v_line_total - v_line_cost, 2)
      );

      UPDATE public.branch_stock
         SET base_quantity_on_hand = base_quantity_on_hand - v_base_quantity,
             quantity_on_hand = floor(base_quantity_on_hand - v_base_quantity)::integer,
             last_updated_at = now()
       WHERE id = v_stock.id;
    END IF;
  END LOOP;

  IF v_subtotal <= 0 THEN
    RAISE EXCEPTION 'Transaction total must be greater than zero';
  END IF;

  IF v_discount_amount < 0 THEN
    RAISE EXCEPTION 'Discount cannot be negative';
  END IF;

  IF v_discount_amount > v_max_discount_amount THEN
    RAISE EXCEPTION 'Discount exceeds the maximum allowed for these items. Maximum allowed: %', v_max_discount_amount;
  END IF;

  v_total_amount := round(v_subtotal - v_discount_amount, 2);

  UPDATE public.transaction_items
     SET line_discount_amount = CASE
           WHEN recovery_item_id IS NULL AND v_discountable_subtotal > 0 THEN round(line_total / v_discountable_subtotal * v_discount_amount, 2)
           ELSE 0
         END,
         net_line_total = CASE
           WHEN recovery_item_id IS NULL AND v_discountable_subtotal > 0 THEN round(line_total - (line_total / v_discountable_subtotal * v_discount_amount), 2)
           ELSE line_total
         END,
         gross_profit = CASE
           WHEN recovery_item_id IS NULL AND v_discountable_subtotal > 0 THEN round(line_total - (line_total / v_discountable_subtotal * v_discount_amount) - line_cost, 2)
           ELSE round(line_total - line_cost, 2)
         END
   WHERE transaction_id = v_transaction_id
     AND business_id = v_business_id;

  UPDATE public.transactions
     SET subtotal = v_subtotal,
         discount_amount = v_discount_amount,
         total_amount = v_total_amount
   WHERE id = v_transaction_id;

  INSERT INTO public.payments (
    transaction_id,
    business_id,
    payment_method,
    amount,
    status,
    mpesa_ref_code,
    cash_deposit_code,
    payment_at
  )
  VALUES (
    v_transaction_id,
    v_business_id,
    p_payment_method,
    v_total_amount,
    v_payment_status,
    CASE WHEN p_payment_method = 'mpesa_manual' THEN trim(p_mpesa_ref_code) ELSE NULL END,
    CASE WHEN p_payment_method = 'cash' THEN trim(p_cash_deposit_code) ELSE NULL END,
    v_recorded_at
  );

  IF v_customer_id IS NOT NULL THEN
    UPDATE public.customers
       SET total_visits = total_visits + 1,
           total_spent = total_spent + v_total_amount,
           last_purchase_at = v_recorded_at
     WHERE id = v_customer_id
       AND business_id = v_business_id;
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
    'transaction',
    v_transaction_id,
    'created',
    NULL,
    jsonb_build_object(
      'effective_role', 'employee',
      'branch_id', v_branch_id,
      'subtotal', v_subtotal,
      'discount_amount', v_discount_amount,
      'max_discount_amount', v_max_discount_amount,
      'total_amount', v_total_amount,
      'payment_method', p_payment_method,
      'payment_status', v_payment_status,
      'pricing_source', 'uom_specific_product_pricing_and_recovery_stock',
      'quantity_mode', 'uom_to_base',
      'profit_mode', 'weighted_average_base_cost'
    )
  );

  RETURN QUERY
  SELECT
    v_transaction_id AS transaction_id,
    'pending_verify'::text AS status,
    v_recorded_at AS recorded_at,
    v_total_amount AS total_amount;
END;
$$;
