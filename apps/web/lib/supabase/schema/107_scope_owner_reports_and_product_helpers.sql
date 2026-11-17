-- Owner/employee summary RPCs are application data, not public APIs.
REVOKE ALL ON FUNCTION public.owner_analytics_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_analytics_summary(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_audit_filter_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_audit_filter_options() TO authenticated;
REVOKE ALL ON FUNCTION public.owner_branch_transaction_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_branch_transaction_counts() TO authenticated;
REVOKE ALL ON FUNCTION public.owner_employee_transaction_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_employee_transaction_counts() TO authenticated;
REVOKE ALL ON FUNCTION public.owner_my_login_reviews(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_my_login_reviews(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_pending_employee_inventory_loss_reports(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_pending_employee_inventory_loss_reports(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_transaction_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_transaction_metrics() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_business_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_business_id() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_global_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_global_role() TO authenticated;

-- Product/UOM helpers receive an explicit business ID; ensure authenticated
-- callers cannot use those parameters to inspect another tenant's catalogue.
CREATE OR REPLACE FUNCTION public.get_product_default_purchase_conversion_factor(p_business_id uuid,p_product_id uuid)
RETURNS numeric LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT CASE WHEN auth.uid() IS NOT NULL AND p_business_id IS DISTINCT FROM public.get_my_business_id() THEN NULL::numeric
  ELSE COALESCE(
    (SELECT u.conversion_factor FROM public.product_uom_links l JOIN public.units_of_measure u
       ON u.id=l.uom_id AND u.business_id=l.business_id
      WHERE l.business_id=p_business_id AND l.product_id=p_product_id AND l.is_purchase_uom=true AND u.is_active=true
      ORDER BY l.is_default_purchase_uom DESC,u.conversion_factor DESC,l.is_base_uom DESC LIMIT 1),
    (SELECT u.conversion_factor FROM public.product_uom_links l JOIN public.units_of_measure u
       ON u.id=l.uom_id AND u.business_id=l.business_id
      WHERE l.business_id=p_business_id AND l.product_id=p_product_id AND u.is_active=true
      ORDER BY l.is_base_uom DESC,u.conversion_factor ASC LIMIT 1),1)
  END;
$$;
CREATE OR REPLACE FUNCTION public.get_product_default_purchase_uom_id(p_business_id uuid,p_product_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT CASE WHEN auth.uid() IS NOT NULL AND p_business_id IS DISTINCT FROM public.get_my_business_id() THEN NULL::uuid
  ELSE (SELECT l.uom_id FROM public.product_uom_links l JOIN public.units_of_measure u
      ON u.id=l.uom_id AND u.business_id=l.business_id
     WHERE l.business_id=p_business_id AND l.product_id=p_product_id AND l.is_purchase_uom=true AND u.is_active=true
     ORDER BY l.is_default_purchase_uom DESC,u.conversion_factor DESC,l.is_base_uom DESC LIMIT 1)
  END;
$$;
CREATE OR REPLACE FUNCTION public.get_product_default_sale_uom_id(p_business_id uuid,p_product_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT CASE WHEN auth.uid() IS NOT NULL AND p_business_id IS DISTINCT FROM public.get_my_business_id() THEN NULL::uuid
  ELSE (SELECT l.uom_id FROM public.product_uom_links l JOIN public.units_of_measure u
      ON u.id=l.uom_id AND u.business_id=l.business_id
     WHERE l.business_id=p_business_id AND l.product_id=p_product_id AND l.is_sale_uom=true AND u.is_active=true
     ORDER BY l.is_default_sale_uom DESC,l.is_base_uom DESC,u.conversion_factor ASC LIMIT 1)
  END;
$$;
CREATE OR REPLACE FUNCTION public.get_product_uom_options_json(p_business_id uuid,p_product_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT CASE WHEN auth.uid() IS NOT NULL AND p_business_id IS DISTINCT FROM public.get_my_business_id() THEN '[]'::jsonb
  ELSE COALESCE(jsonb_agg(jsonb_build_object(
    'id',u.id,'name',u.name,'abbreviation',u.abbreviation,'conversionFactor',u.conversion_factor,
    'isBaseUnit',u.is_base_unit,'isBaseUom',l.is_base_uom,'isPurchaseUom',l.is_purchase_uom,
    'isSaleUom',l.is_sale_uom,'isDefaultSaleUom',l.is_default_sale_uom,
    'isDefaultPurchaseUom',l.is_default_purchase_uom
  ) ORDER BY l.is_default_sale_uom DESC,l.is_base_uom DESC,u.conversion_factor ASC),'[]'::jsonb) END
  FROM public.product_uom_links l JOIN public.units_of_measure u
    ON u.id=l.uom_id AND u.business_id=l.business_id
  WHERE l.business_id=p_business_id AND l.product_id=p_product_id AND l.is_sale_uom=true AND u.is_active=true;
$$;
REVOKE ALL ON FUNCTION public.get_product_default_purchase_conversion_factor(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_product_default_purchase_conversion_factor(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_product_default_purchase_uom_id(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_product_default_purchase_uom_id(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_product_default_sale_uom_id(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_product_default_sale_uom_id(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_product_uom_options_json(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_product_uom_options_json(uuid,uuid) TO authenticated;

-- Sale-price resolvers are internal to authenticated SECURITY DEFINER sale
-- writers and have no direct client call; keep them off the Data API.
REVOKE ALL ON FUNCTION public.resolve_product_sale_discount(uuid,uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.resolve_product_sale_price(uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.resolve_product_sale_price(uuid,uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.convert_from_base_units(numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.convert_from_base_units(numeric,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.convert_to_base_units(numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.convert_to_base_units(numeric,uuid) TO authenticated;
