-- SmartRetail Database Schema Group 2: Products and Pricing

-- Stores the shared product catalog for each business
-- Products are defined at the business level and can be sold across branches
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, sku) -- SKU must be unique per business
);

-- Defines owner-set price boundaries for each product
-- These bounds are enforced at both application and database level
-- Admins cannot set a selling price outside these bounds
CREATE TABLE product_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  base_price NUMERIC(10,2) NOT NULL,
  min_price NUMERIC(10,2) NOT NULL,
  max_price NUMERIC(10,2) NOT NULL,
  set_by UUID NOT NULL REFERENCES users(id),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Minimum price must always be less than base price
  CONSTRAINT chk_min_price CHECK (min_price < base_price),
  -- Maximum price must always be greater than base price
  CONSTRAINT chk_max_price CHECK (max_price > base_price)
);

-- Stores the actual selling price for each product at each branch
-- Allows different prices per branch while maintaining business-wide product catalog
-- Status values: approved, pending_approval, rejected
CREATE TABLE branch_product_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  selling_price NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  requested_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  UNIQUE(product_id, branch_id) -- One price per product per branch
);

-- Audit trail for all price change requests
-- Tracks the full lifecycle of price changes for compliance and debugging
-- Status values: pending_approval, approved, rejected
CREATE TABLE price_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_product_price_id UUID NOT NULL REFERENCES branch_product_prices(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  old_price NUMERIC(10,2),
  new_price NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'pending_approval',
  rejection_reason TEXT,
  requested_by UUID NOT NULL REFERENCES users(id),
  reviewed_by UUID REFERENCES users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================

-- Fast lookup of all products in a business
CREATE INDEX idx_products_business_id ON products(business_id);

-- Fast lookup of active products in a business for product selection
CREATE INDEX idx_products_business_id_is_active ON products(business_id, is_active);

-- Fast lookup of pricing for a specific product
CREATE INDEX idx_product_pricing_product_id ON product_pricing(product_id);

-- Fast lookup of all pricing in a business
CREATE INDEX idx_product_pricing_business_id ON product_pricing(business_id);

-- Fast lookup of all product prices in a branch
CREATE INDEX idx_branch_product_prices_branch_id ON branch_product_prices(branch_id);

-- Fast lookup of specific product price at a branch
CREATE INDEX idx_branch_product_prices_product_branch ON branch_product_prices(product_id, branch_id);

-- Fast lookup of all price change requests in a business
CREATE INDEX idx_price_change_requests_business_id ON price_change_requests(business_id);

-- Fast lookup of pending price change requests for approval workflows
CREATE INDEX idx_price_change_requests_status ON price_change_requests(status);