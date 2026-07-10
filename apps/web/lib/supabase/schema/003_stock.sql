-- SmartRetail Database Schema Group 3: Stock Management

-- Tracks live stock levels for each product at each branch
-- This is the source of truth for stock levels and is updated on every sale and transfer
CREATE TABLE branch_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quantity_on_hand INTEGER NOT NULL DEFAULT 0,
  quantity_reserved INTEGER NOT NULL DEFAULT 0, -- Stock in transit not yet received
  low_stock_threshold INTEGER NOT NULL DEFAULT 10,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(branch_id, product_id), -- One stock record per product per branch
  CHECK (quantity_on_hand >= 0),
  CHECK (quantity_reserved >= 0)
);

-- Header records for stock movements between branches within the same business
CREATE TABLE stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_branch_id UUID NOT NULL REFERENCES branches(id),
  to_branch_id UUID NOT NULL REFERENCES branches(id),
  initiated_by UUID NOT NULL REFERENCES users(id),
  received_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'initiated', -- Status values: initiated, in_transit, partially_received, received, disputed
  notes TEXT,
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at TIMESTAMPTZ,
  CHECK (from_branch_id != to_branch_id)
);

-- Line items detailing the products and quantities in each stock transfer
CREATE TABLE stock_transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quantity_sent INTEGER NOT NULL,
  quantity_received INTEGER,
  quantity_discrepancy INTEGER, -- Calculated as quantity_sent minus quantity_received
  discrepancy_notes TEXT,
  CHECK (quantity_sent > 0),
  CHECK (quantity_received >= 0)
);

-- Records stock deliveries arriving from external suppliers
CREATE TABLE supplier_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  to_branch_id UUID NOT NULL REFERENCES branches(id),
  received_by UUID NOT NULL REFERENCES users(id),
  supplier_name TEXT NOT NULL,
  reference_code TEXT, -- Supplier invoice or delivery note number
  status TEXT NOT NULL DEFAULT 'pending', -- Status values: pending, received, disputed
  delivered_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Line items for each supplier delivery with quantities and costs
CREATE TABLE supplier_delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES supplier_deliveries(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quantity_expected INTEGER,
  quantity_received INTEGER NOT NULL,
  quantity_discrepancy INTEGER,
  unit_cost NUMERIC(10,2), -- Cost price from supplier used for profit calculations
  notes TEXT,
  CHECK (quantity_received >= 0)
);

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================

-- Fast lookup of all stock in a branch
CREATE INDEX idx_branch_stock_branch_id ON branch_stock(branch_id);

-- Fast lookup of all stock across a business
CREATE INDEX idx_branch_stock_business_id ON branch_stock(business_id);

-- Fast lookup of specific product stock at a branch
CREATE INDEX idx_branch_stock_branch_product ON branch_stock(branch_id, product_id);

-- Fast lookup of products below low stock threshold
CREATE INDEX idx_branch_stock_quantity_on_hand ON branch_stock(quantity_on_hand);

-- Fast lookup of all stock transfers in a business
CREATE INDEX idx_stock_transfers_business_id ON stock_transfers(business_id);

-- Fast lookup of transfers from a specific branch
CREATE INDEX idx_stock_transfers_from_branch_id ON stock_transfers(from_branch_id);

-- Fast lookup of transfers to a specific branch
CREATE INDEX idx_stock_transfers_to_branch_id ON stock_transfers(to_branch_id);

-- Fast lookup of in-transit transfers for status monitoring
CREATE INDEX idx_stock_transfers_status ON stock_transfers(status);

-- Fast lookup of all items in a transfer
CREATE INDEX idx_stock_transfer_items_transfer_id ON stock_transfer_items(transfer_id);

-- Fast lookup of all supplier deliveries in a business
CREATE INDEX idx_supplier_deliveries_business_id ON supplier_deliveries(business_id);

-- Fast lookup of deliveries to a specific branch
CREATE INDEX idx_supplier_deliveries_to_branch_id ON supplier_deliveries(to_branch_id);

-- Fast lookup of all items in a supplier delivery
CREATE INDEX idx_supplier_delivery_items_delivery_id ON supplier_delivery_items(delivery_id);