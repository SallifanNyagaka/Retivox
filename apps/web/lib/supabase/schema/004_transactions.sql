-- SmartRetail Database Schema Group 4: Transactions and Payments

-- Customers table: customer records per business for purchase tracking
-- Customers do not need accounts yet — they are recorded per transaction for tracking purposes
-- total_visits and total_spent are denormalized for dashboard performance
CREATE TABLE customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
    name text NOT NULL,
    phone text,
    email text,
    total_visits integer NOT NULL DEFAULT 0,
    total_spent numeric(10,2) NOT NULL DEFAULT 0,
    first_purchase_at timestamptz,
    last_purchase_at timestamptz
);

-- Index on customers(business_id) for fast lookups by business
CREATE INDEX idx_customers_business_id ON customers(business_id);

-- Index on customers(phone) for customer lookup by phone
CREATE INDEX idx_customers_phone ON customers(phone);

-- Transactions table: the main sale record
CREATE TABLE transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
    branch_id uuid REFERENCES branches,
    employee_id uuid REFERENCES users,
    customer_id uuid REFERENCES customers,
    status text NOT NULL DEFAULT 'synced', -- status values: pending_sync, synced, pending_verify, verified, rejected, flagged, voided
    subtotal numeric(10,2) NOT NULL DEFAULT 0,
    discount_amount numeric(10,2) NOT NULL DEFAULT 0,
    total_amount numeric(10,2) NOT NULL DEFAULT 0,
    origin text NOT NULL DEFAULT 'online', -- origin values: online, offline
    recorded_at timestamptz NOT NULL DEFAULT now(),
    synced_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    local_id text UNIQUE, -- this is the device-generated UUID used for offline deduplication, unique prevents duplicate syncs
    sync_status text NOT NULL DEFAULT 'synced', -- values: pending, syncing, synced, conflict, failed
    CHECK (total_amount >= 0),
    CHECK (discount_amount >= 0),
    CHECK (subtotal >= 0)
);

-- Index on transactions(business_id) for multi-tenant queries
CREATE INDEX idx_transactions_business_id ON transactions(business_id);

-- Index on transactions(branch_id) for branch-specific queries
CREATE INDEX idx_transactions_branch_id ON transactions(branch_id);

-- Index on transactions(employee_id) for employee performance reports
CREATE INDEX idx_transactions_employee_id ON transactions(employee_id);

-- Index on transactions(status) for fetching pending verifications fast
CREATE INDEX idx_transactions_status ON transactions(status);

-- Index on transactions(sync_status) for fetching unsynced transactions
CREATE INDEX idx_transactions_sync_status ON transactions(sync_status);

-- Index on transactions(recorded_at) for date range revenue queries
CREATE INDEX idx_transactions_recorded_at ON transactions(recorded_at);

-- Index on transactions(local_id) for deduplication on sync
CREATE INDEX idx_transactions_local_id ON transactions(local_id);

-- Transaction_items table: line items for each transaction
CREATE TABLE transaction_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id uuid NOT NULL REFERENCES transactions ON DELETE CASCADE,
    product_id uuid REFERENCES products,
    business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
    quantity integer NOT NULL,
    unit_price_at_sale numeric(10,2) NOT NULL, -- this is the price at the time of sale, never updated even if product price changes later
    line_total numeric(10,2) NOT NULL,
    stock_status text NOT NULL DEFAULT 'deducted', -- values: deducted, pending, failed
    CHECK (quantity > 0),
    CHECK (unit_price_at_sale >= 0),
    CHECK (line_total >= 0)
);

-- Index on transaction_items(transaction_id) for fetching items per transaction
CREATE INDEX idx_transaction_items_transaction_id ON transaction_items(transaction_id);

-- Index on transaction_items(product_id) for product sales reports
CREATE INDEX idx_transaction_items_product_id ON transaction_items(product_id);

-- Payments table: payment records linked to transactions
CREATE TABLE payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id uuid NOT NULL REFERENCES transactions ON DELETE CASCADE,
    business_id uuid NOT NULL REFERENCES businesses ON DELETE CASCADE,
    payment_method text NOT NULL, -- values: mpesa_stk, mpesa_manual, cash, card
    amount numeric(10,2) NOT NULL,
    status text NOT NULL DEFAULT 'pending', -- values: pending, pending_verify, verified, rejected
    mpesa_ref_code text, -- this is the Safaricom confirmation code
    mpesa_checkout_id text, -- this is the STK Push request ID from Daraja API
    paybill_number text,
    account_reference text, -- this is the system generated reference the customer enters when paying via paybill directly
    cash_deposit_code text, -- this is the bank deposit reference uploaded by employee for cash payments
    verified_by uuid REFERENCES users,
    verified_at timestamptz,
    payment_at timestamptz NOT NULL DEFAULT now(),
    CHECK (amount > 0)
);

-- Index on payments(transaction_id) for payments per transaction
CREATE INDEX idx_payments_transaction_id ON payments(transaction_id);

-- Index on payments(business_id) for multi-tenant queries
CREATE INDEX idx_payments_business_id ON payments(business_id);

-- Index on payments(status) for fetching pending payments fast
CREATE INDEX idx_payments_status ON payments(status);

-- Index on payments(payment_method) for payment method breakdown reports
CREATE INDEX idx_payments_payment_method ON payments(payment_method);