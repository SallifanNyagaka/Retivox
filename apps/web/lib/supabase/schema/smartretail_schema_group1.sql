/*
 * SmartRetail Database Schema - Group 1: Core Tenancy, Users, and Roles
 * 
 * This is Group 1 of the database schema.
 * It creates the core tenancy, user and role tables.
 * Every table includes created_at with a default timestamp.
 * UUIDs are used for all primary keys using gen_random_uuid().
 * business_id is on every table for multi-tenancy isolation.
 */

-- Stores the retail businesses/organizations using SmartRetail
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE, -- Used in URLs for business identification
  country CHAR(2) NOT NULL, -- ISO country code (e.g., US, CA, GB)
  currency CHAR(3) NOT NULL, -- ISO currency code (e.g., USD, CAD, GBP)
  timezone TEXT NOT NULL,
  subscription_plan TEXT NOT NULL DEFAULT 'trial',
  subscription_status TEXT NOT NULL DEFAULT 'active',
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Stores all users across all businesses
-- Each user has a global role but can have branch-specific roles via user_branch_roles
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  global_role TEXT NOT NULL, -- Valid values: owner, admin, employee
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, email) -- Email must be unique per business
);

-- Stores physical retail locations (stores, warehouses) for each business
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  branch_type TEXT NOT NULL, -- Valid values: warehouse, store
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Maps users to branches with branch-specific roles
-- Allows flexible role assignment per user per branch
CREATE TABLE user_branch_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- Valid values: owner, admin, employee
  assigned_by UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, branch_id) -- One role per user per branch
);

-- Tracks employee transfers between branches for audit and approval workflows
CREATE TABLE employee_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_branch_id UUID NOT NULL REFERENCES branches(id),
  to_branch_id UUID NOT NULL REFERENCES branches(id),
  approved_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending', -- Valid values: pending, approved, rejected
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);

-- Immutable audit log for all system actions across the business
-- Used for compliance, debugging, and user action tracking
-- Note: audit_logs are insert-only - no updates or deletes allowed
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL, -- The user who performed the action
  entity_type TEXT NOT NULL, -- e.g., transaction, product, stock_transfer
  entity_id UUID NOT NULL, -- The id of the affected record
  action TEXT NOT NULL, -- e.g., created, updated, approved, rejected
  old_value JSONB, -- State before the action
  new_value JSONB, -- State after the action
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================

-- Fast lookups of all users in a business
CREATE INDEX idx_users_business_id ON users(business_id);

-- Fast email lookups for login and duplicate prevention
CREATE INDEX idx_users_email ON users(email);

-- Fast lookups of all branches in a business
CREATE INDEX idx_branches_business_id ON branches(business_id);

-- Fast lookups of all roles assigned to a user
CREATE INDEX idx_user_branch_roles_user_id ON user_branch_roles(user_id);

-- Fast lookups of all users assigned to a branch
CREATE INDEX idx_user_branch_roles_branch_id ON user_branch_roles(branch_id);

-- Fast audit log lookups by business for compliance and debugging
CREATE INDEX idx_audit_logs_business_id ON audit_logs(business_id);

-- Fast audit log lookups by actor for user action tracking
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);

-- Fast audit log lookups by date for time-range queries
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
