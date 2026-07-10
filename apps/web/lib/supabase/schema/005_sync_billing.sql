-- SmartRetail Database Schema Group 5: Sync, Notifications and SaaS Billing

-- Device sessions table tracks every device that has logged into the system.
-- This table is used for security auditing and detecting suspicious logins.
CREATE TABLE IF NOT EXISTS device_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL, -- Hash of device properties used to identify the device
  platform TEXT NOT NULL, -- Values: ios, android, web
  app_version TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, device_fingerprint) -- One session record per user per device
);

-- Fast lookup of sessions per user
CREATE INDEX IF NOT EXISTS idx_device_sessions_user_id ON device_sessions (user_id);

-- Fast lookup of device sessions per business
CREATE INDEX IF NOT EXISTS idx_device_sessions_business_id ON device_sessions (business_id);

-- Offline transaction queue waiting to be synced to the server.
-- Records are processed in order of created_locally_at to maintain correct transaction sequence.
CREATE TABLE IF NOT EXISTS sync_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_session_id UUID NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, -- Values: transaction, stock_transfer, payment
  local_id TEXT NOT NULL, -- Matches the local_id on the transaction for deduplication
  payload JSONB NOT NULL, -- Full record to be synced to the server
  status TEXT NOT NULL DEFAULT 'pending', -- Values: pending, processing, synced, failed, conflict
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT, -- Stores the last error message if sync failed
  created_locally_at TIMESTAMPTZ NOT NULL, -- Timestamp from the device when record was created offline
  synced_at TIMESTAMPTZ
);

-- Composite index for processing pending queue items fast
CREATE INDEX IF NOT EXISTS idx_sync_queue_business_status ON sync_queue (business_id, status);

-- Fast user-specific queue lookups
CREATE INDEX IF NOT EXISTS idx_sync_queue_user_id ON sync_queue (user_id);

-- Ordered queue processing by device timestamp
CREATE INDEX IF NOT EXISTS idx_sync_queue_created_locally_at ON sync_queue (created_locally_at);

-- In-app and push notifications for all users.
-- Notifications are created automatically by database triggers and edge functions.
CREATE TABLE IF NOT EXISTS notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- Values: payment_pending, price_change_request, stock_alert, employee_registered, transfer_received, sync_conflict
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB, -- Contextual data like transaction_id or transfer_id for deep linking
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast retrieval of notifications per user
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id ON notifications (recipient_id);

-- Business-level notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_business_id ON notifications (business_id);

-- Fast fetching of unread notifications
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications (is_read);

-- SaaS billing subscription per business.
-- One subscription per business enforced by unique constraint on business_id.
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  plan TEXT NOT NULL DEFAULT 'trial', -- Values: trial, starter, growth, enterprise
  status TEXT NOT NULL DEFAULT 'active', -- Values: active, past_due, cancelled, expired
  branch_count INTEGER NOT NULL DEFAULT 1, -- Number of active branches the business is paying for
  monthly_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'KES',
  payment_provider TEXT, -- Values: stripe, pesapal, manual
  provider_subscription_id TEXT, -- Subscription ID from the payment provider
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast subscription lookup by business
CREATE INDEX IF NOT EXISTS idx_subscriptions_business_id ON subscriptions (business_id);

-- Billing status checks
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);

-- Billing history per business.
CREATE TABLE IF NOT EXISTS subscription_invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'KES',
  status TEXT NOT NULL DEFAULT 'pending', -- Values: pending, paid, failed, refunded
  provider_invoice_id TEXT, -- Invoice ID from the payment provider
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

-- Fast invoice lookups per subscription
CREATE INDEX IF NOT EXISTS idx_subscription_invoices_subscription_id ON subscription_invoices (subscription_id);

-- Fast invoice lookups per business
CREATE INDEX IF NOT EXISTS idx_subscription_invoices_business_id ON subscription_invoices (business_id);