/*
 * Daraja PayBill STK Push payment method.
 *
 * Subscription payment requests distinguish automated STK Push from manual
 * M-Pesa reference submissions so reports and support screens are clear.
 */

ALTER TABLE public.subscription_payment_requests
  DROP CONSTRAINT IF EXISTS subscription_payment_requests_method_valid;

ALTER TABLE public.subscription_payment_requests
  ADD CONSTRAINT subscription_payment_requests_method_valid
  CHECK (payment_method IN ('mpesa_stk', 'mpesa_manual', 'bank_transfer', 'cash_deposit', 'other'));

UPDATE public.subscription_payment_requests
   SET payment_method = 'mpesa_stk'
 WHERE provider = 'daraja'
   AND provider_checkout_request_id IS NOT NULL
   AND payment_method = 'mpesa_manual';

ALTER TABLE public.subscription_payment_requests
  ADD COLUMN IF NOT EXISTS provider_receipt_number text,
  ADD COLUMN IF NOT EXISTS provider_paid_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS provider_phone_number text;

CREATE INDEX IF NOT EXISTS idx_subscription_payment_requests_provider_receipt
  ON public.subscription_payment_requests (provider_receipt_number);

DROP FUNCTION IF EXISTS public.owner_my_subscription_payment_requests(integer);

CREATE OR REPLACE FUNCTION public.owner_my_subscription_payment_requests(p_limit integer DEFAULT 10)
RETURNS TABLE(
  id uuid,
  amount numeric,
  currency char(3),
  payment_method text,
  reference_code text,
  payer_phone text,
  status text,
  review_note text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  provider_checkout_request_id text,
  provider_receipt_number text,
  provider_paid_amount numeric,
  provider_phone_number text,
  provider_result_description text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    payment_requests.id,
    payment_requests.amount,
    payment_requests.currency,
    payment_requests.payment_method,
    payment_requests.reference_code,
    payment_requests.payer_phone,
    payment_requests.status,
    payment_requests.review_note,
    payment_requests.submitted_at,
    payment_requests.reviewed_at,
    payment_requests.provider_checkout_request_id,
    payment_requests.provider_receipt_number,
    payment_requests.provider_paid_amount,
    payment_requests.provider_phone_number,
    payment_requests.provider_result_description
  FROM public.subscription_payment_requests AS payment_requests
  WHERE payment_requests.business_id = public.get_my_business_id()
    AND public.get_my_global_role() = 'owner'
  ORDER BY payment_requests.submitted_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;
