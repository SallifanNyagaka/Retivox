-- Cash sales have no individual deposit reference. Remove the legacy
-- dashboard RPC validation and stop passing compatibility sentinels through
-- the online and offline wrappers. M-Pesa reference validation is unchanged.
DO $migration$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_get_functiondef(
    'public.dashboard_record_transaction(uuid,jsonb,text,numeric,text,text,text,text)'::regprocedure
  ) INTO v_definition;
  v_updated := regexp_replace(
    v_definition,
    $pattern$\s*IF p_payment_method = 'cash' AND length\(trim\(COALESCE\(p_cash_deposit_code, ''\)\)\) < 3 THEN\s+RAISE EXCEPTION 'Enter a valid cash deposit/reference code';\s+END IF;\s*$pattern$,
    E'\n',
    'i'
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'Expected legacy cash reference validation was not found';
  END IF;
  EXECUTE v_updated;

  SELECT pg_get_functiondef(
    'public.dashboard_record_transaction_v2(uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean)'::regprocedure
  ) INTO v_definition;
  v_updated := replace(
    v_definition,
    $sentinel$CASE WHEN v_base_method = 'cash' THEN 'INTERNAL-CASH-SALE' ELSE NULL END$sentinel$,
    'NULL'
  );
  v_updated := regexp_replace(
    v_updated,
    $cleanup$\s*UPDATE public\.payments AS payment SET cash_deposit_code = NULL\s+WHERE payment\.transaction_id = r\.transaction_id\s+AND payment\.business_id = public\.get_my_business_id\(\)\s+AND payment\.payment_method = 'cash';\s*$cleanup$,
    E'\n',
    'i'
  );
  IF position('INTERNAL-CASH-SALE' IN v_updated) > 0 THEN
    RAISE EXCEPTION 'Online dashboard wrapper still contains a cash compatibility sentinel';
  END IF;
  EXECUTE v_updated;

  SELECT pg_get_functiondef(
    'public.dashboard_record_transaction_offline_v2(uuid,jsonb,text,numeric,numeric,numeric,text,text,text,text,date,boolean,timestamptz,text)'::regprocedure
  ) INTO v_definition;
  v_updated := replace(
    v_definition,
    $sentinel$CASE WHEN p_payment_method='mpesa_manual' AND NOT (p_is_credit AND COALESCE(p_amount_paid,0)=0) THEN NULL ELSE 'INTERNAL-CASH-SALE' END$sentinel$,
    'NULL'
  );
  v_updated := regexp_replace(
    v_updated,
    $cleanup$\s*UPDATE public\.payments AS payment SET cash_deposit_code=NULL\s+WHERE payment\.transaction_id=r\.transaction_id AND payment\.business_id=v_business_id AND payment\.payment_method='cash';\s*$cleanup$,
    E'\n',
    'i'
  );
  IF position('INTERNAL-CASH-SALE' IN v_updated) > 0 THEN
    RAISE EXCEPTION 'Offline dashboard wrapper still contains a cash compatibility sentinel';
  END IF;
  EXECUTE v_updated;
END;
$migration$;
