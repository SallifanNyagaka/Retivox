/*
  SmartRetail Row Level Security (RLS) Policies

  SECURITY ARCHITECTURE:
  - RLS is enforced at the PostgreSQL engine level for maximum security
  - Every table is isolated by business_id to ensure multi-tenant data separation
  - Policies use auth.uid() to identify the current user
  - Helper functions determine business_id and role context for policy evaluation
  - SECURITY DEFINER functions run with elevated privileges to access auth context
  - STABLE functions are optimized for query planning within transactions
*/

/* ============================================================================
   HELPER FUNCTIONS - These must be created first before RLS policies
   ============================================================================ */

-- Helper: get_my_business_id()
-- PURPOSE: Safely retrieve the current user's business_id from the users table
-- SECURITY: Marked SECURITY DEFINER to access user data via auth.uid()
-- PERFORMANCE: Marked STABLE because result won't change during a transaction
CREATE FUNCTION public.get_my_business_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT business_id FROM public.users WHERE id = auth.uid();
$$;

-- Helper: get_my_global_role()
-- PURPOSE: Safely retrieve the current user's global_role from the users table
-- SECURITY: Marked SECURITY DEFINER to access user data via auth.uid()
-- PERFORMANCE: Marked STABLE because result won't change during a transaction
CREATE FUNCTION public.get_my_global_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT global_role FROM public.users WHERE id = auth.uid();
$$;

/* ============================================================================
   ENABLE RLS ON ALL TABLES
   ============================================================================ */

-- Enable RLS on businesses table
-- Isolates business data by tenant, enforced at database engine level
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

-- Enable RLS on users table
-- Ensures users can only access other users within their business context
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Enable RLS on branches table
-- Restricts branch visibility and modifications by business tenant
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

-- Enable RLS on user_branch_roles table
-- Controls role assignments and access control within business branches
ALTER TABLE public.user_branch_roles ENABLE ROW LEVEL SECURITY;

-- Enable RLS on employee_transfers table
-- Isolates employee transfer records by business tenant
ALTER TABLE public.employee_transfers ENABLE ROW LEVEL SECURITY;

-- Enable RLS on audit_logs table
-- Ensures audit trails are immutable and properly scoped by business
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Enable RLS on products table
-- Restricts product catalog access by business tenant
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Enable RLS on product_pricing table
-- Isolates pricing data by business tenant
ALTER TABLE public.product_pricing ENABLE ROW LEVEL SECURITY;

-- Enable RLS on branch_product_prices table
-- Restricts branch-specific pricing by business tenant
ALTER TABLE public.branch_product_prices ENABLE ROW LEVEL SECURITY;

-- Enable RLS on price_change_requests table
-- Controls price change request visibility and modifications by business
ALTER TABLE public.price_change_requests ENABLE ROW LEVEL SECURITY;

-- Enable RLS on branch_stock table
-- Isolates inventory data by business tenant
ALTER TABLE public.branch_stock ENABLE ROW LEVEL SECURITY;

-- Enable RLS on stock_transfers table
-- Controls stock transfer visibility and modifications by business
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

-- Enable RLS on stock_transfer_items table
-- Isolates stock transfer line items by business tenant
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;

-- Enable RLS on supplier_deliveries table
-- Restricts supplier delivery records by business tenant
ALTER TABLE public.supplier_deliveries ENABLE ROW LEVEL SECURITY;

-- Enable RLS on supplier_delivery_items table
-- Isolates delivery line items by business tenant
ALTER TABLE public.supplier_delivery_items ENABLE ROW LEVEL SECURITY;

-- Enable RLS on customers table
-- Restricts customer data by business tenant
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Enable RLS on transactions table
-- Controls transaction visibility based on role and branch assignment
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Enable RLS on transaction_items table
-- Isolates transaction line items by business tenant
ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;

-- Enable RLS on payments table
-- Restricts payment records by business tenant
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Enable RLS on device_sessions table
-- Isolates device sessions by business tenant
ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;

-- Enable RLS on sync_queue table
-- Restricts sync queue visibility to individual users
ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;

-- Enable RLS on notifications table
-- Ensures notifications are only visible to their recipient
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Enable RLS on subscriptions table
-- Restricts subscription data to business owners only
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Enable RLS on subscription_invoices table
-- Isolates subscription invoices by business tenant
ALTER TABLE public.subscription_invoices ENABLE ROW LEVEL SECURITY;

/* ============================================================================
   BUSINESSES TABLE POLICIES
   ============================================================================ */

-- POLICY: businesses_select
-- Allows users to view their own business record only
-- Rationale: Each user should only see data relevant to their business
CREATE POLICY "businesses_select" ON public.businesses
  FOR SELECT
  USING (id = get_my_business_id());

-- POLICY: businesses_insert
-- Allows anyone to create a business (supports registration flow)
-- Rationale: New users must be able to register and create their business
CREATE POLICY "businesses_insert" ON public.businesses
  FOR INSERT
  WITH CHECK (TRUE);

-- POLICY: businesses_update
-- Only business owner can update their business record
-- Rationale: Prevents unauthorized modifications to business settings
CREATE POLICY "businesses_update" ON public.businesses
  FOR UPDATE
  USING (id = get_my_business_id() AND get_my_global_role() = 'owner')
  WITH CHECK (id = get_my_business_id() AND get_my_global_role() = 'owner');

-- POLICY: businesses_delete
-- Only business owner can delete the business
-- Rationale: Prevents accidental or unauthorized business deletion
CREATE POLICY "businesses_delete" ON public.businesses
  FOR DELETE
  USING (id = get_my_business_id() AND get_my_global_role() = 'owner');

/* ============================================================================
   USERS TABLE POLICIES
   ============================================================================ */

-- POLICY: users_select
-- Users can only view other users within their business
-- Rationale: Prevents cross-tenant user data leakage
CREATE POLICY "users_select" ON public.users
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: users_insert
-- Owner and admin can create new users in their business
-- Rationale: Controls who can add users to the tenant organization
CREATE POLICY "users_insert" ON public.users
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: users_update
-- Owner can update any user; users can update themselves
-- Rationale: Owner has full control; users have autonomy for personal info
CREATE POLICY "users_update" ON public.users
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND (get_my_global_role() = 'owner' OR id = auth.uid())
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND (get_my_global_role() = 'owner' OR id = auth.uid())
  );

-- POLICY: users_delete
-- Only owner can delete users
-- Rationale: Prevents unauthorized user removal
CREATE POLICY "users_delete" ON public.users
  FOR DELETE
  USING (business_id = get_my_business_id() AND get_my_global_role() = 'owner');

/* ============================================================================
   BRANCHES TABLE POLICIES
   ============================================================================ */

-- POLICY: branches_select
-- All users in the business can view branches
-- Rationale: All employees need visibility of branch structure
CREATE POLICY "branches_select" ON public.branches
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: branches_insert
-- Only owner can create new branches
-- Rationale: Branch creation is a major structural change
CREATE POLICY "branches_insert" ON public.branches
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

-- POLICY: branches_update
-- Only owner can update branch details
-- Rationale: Prevents accidental modification of branch configuration
CREATE POLICY "branches_update" ON public.branches
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

-- POLICY: branches_delete
-- Only owner can delete branches
-- Rationale: Structural changes should only be made by owner
CREATE POLICY "branches_delete" ON public.branches
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ============================================================================
   USER_BRANCH_ROLES TABLE POLICIES
   ============================================================================ */

-- POLICY: user_branch_roles_select
-- Users can view role assignments within their business
-- Rationale: Employees need to know organizational structure
CREATE POLICY "user_branch_roles_select" ON public.user_branch_roles
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: user_branch_roles_insert
-- Owner and admin can assign users to branch roles
-- Rationale: Restricts access control management to authority figures
CREATE POLICY "user_branch_roles_insert" ON public.user_branch_roles
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: user_branch_roles_update
-- Only owner can modify role assignments
-- Rationale: Prevents privilege escalation by non-owners
CREATE POLICY "user_branch_roles_update" ON public.user_branch_roles
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

-- POLICY: user_branch_roles_delete
-- Only owner can remove role assignments
-- Rationale: Prevents unauthorized removal of user access
CREATE POLICY "user_branch_roles_delete" ON public.user_branch_roles
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ============================================================================
   EMPLOYEE_TRANSFERS TABLE POLICIES
   ============================================================================ */

-- POLICY: employee_transfers_select
-- All users in business can view employee transfers
-- Rationale: Employees and managers need to see transfer history
CREATE POLICY "employee_transfers_select" ON public.employee_transfers
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: employee_transfers_insert
-- Owner and admin can create transfer records
-- Rationale: Prevents arbitrary employee transfer logging
CREATE POLICY "employee_transfers_insert" ON public.employee_transfers
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: employee_transfers_update
-- Owner and admin can modify transfer records
-- Rationale: Allows correction of transfer data by authorized personnel
CREATE POLICY "employee_transfers_update" ON public.employee_transfers
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: employee_transfers_delete
-- Only owner can delete transfer records
-- Rationale: Prevents erasure of employee history
CREATE POLICY "employee_transfers_delete" ON public.employee_transfers
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ============================================================================
   AUDIT_LOGS TABLE POLICIES - IMMUTABLE
   ============================================================================ */

-- POLICY: audit_logs_select
-- Owner and admin can read audit logs for their business
-- Rationale: Only authority figures should review system audit trail
CREATE POLICY "audit_logs_select" ON public.audit_logs
  FOR SELECT
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: audit_logs_insert
-- All authenticated users can create audit log entries
-- Rationale: System must record all user actions for compliance
CREATE POLICY "audit_logs_insert" ON public.audit_logs
  FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- NOTE: No UPDATE policy on audit_logs
-- Rationale: Audit logs are immutable for compliance and integrity

-- NOTE: No DELETE policy on audit_logs
-- Rationale: Audit logs are immutable and should never be deleted

/* ============================================================================
   PRODUCTS TABLE POLICIES
   ============================================================================ */

-- POLICY: products_select
-- All users in business can view products
-- Rationale: Employees need access to product catalog
CREATE POLICY "products_select" ON public.products
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: products_insert
-- Owner and admin can add new products
-- Rationale: Prevents unauthorized product catalog modifications
CREATE POLICY "products_insert" ON public.products
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: products_update
-- Owner and admin can modify product details
-- Rationale: Ensures only authorized personnel update product information
CREATE POLICY "products_update" ON public.products
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: products_delete
-- Only owner can delete products
-- Rationale: Product deletion is a critical operation
CREATE POLICY "products_delete" ON public.products
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ============================================================================
   TRANSACTIONS TABLE POLICIES - ROLE-BASED VISIBILITY
   ============================================================================ */

-- POLICY: transactions_select
-- Owner sees all transactions in business; admin sees their branches; 
-- employees see only their own transactions
-- Rationale: Implements hierarchical access control based on role
CREATE POLICY "transactions_select" ON public.transactions
  FOR SELECT
  USING (
    business_id = get_my_business_id() AND (
      get_my_global_role() = 'owner' OR
      (
        get_my_global_role() = 'admin' 
        AND branch_id IN (
          SELECT branch_id FROM public.user_branch_roles 
          WHERE user_id = auth.uid() AND business_id = get_my_business_id()
        )
      ) OR
      employee_id = auth.uid()
    )
  );

-- POLICY: transactions_insert
-- All authenticated users in business can create transactions
-- Rationale: Frontline employees need to process transactions
CREATE POLICY "transactions_insert" ON public.transactions
  FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- POLICY: transactions_update
-- Only owner and admin can modify transactions
-- Rationale: Prevents unauthorized transaction alterations
CREATE POLICY "transactions_update" ON public.transactions
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: transactions_delete
-- Only owner can delete transactions
-- Rationale: Transaction deletion requires highest privilege level
CREATE POLICY "transactions_delete" ON public.transactions
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ============================================================================
   PAYMENTS TABLE POLICIES
   ============================================================================ */

-- POLICY: payments_select
-- Users can view payments for their business
-- Rationale: All relevant staff need access to payment records
CREATE POLICY "payments_select" ON public.payments
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: payments_insert
-- Authenticated users can create payment records in their business
-- Rationale: Payment recording must be accessible to authorized staff
CREATE POLICY "payments_insert" ON public.payments
  FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- POLICY: payments_update
-- Only owner and admin can modify payments (for verification)
-- Rationale: Payment verification should only be done by authority
CREATE POLICY "payments_update" ON public.payments
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- NOTE: No DELETE policy on payments
-- Rationale: Payments should not be deleted for accounting integrity

/* ============================================================================
   NOTIFICATIONS TABLE POLICIES - RECIPIENT-SPECIFIC
   ============================================================================ */

-- POLICY: notifications_select
-- Users can only view their own notifications
-- Rationale: Notifications are personal and should never cross recipient boundaries
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT
  USING (recipient_id = auth.uid());

-- POLICY: notifications_insert
-- Authenticated users can create notifications for their business
-- Rationale: System must allow notification creation for business events
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- POLICY: notifications_update
-- Users can only mark their own notifications as read
-- Rationale: Preserves privacy while allowing users to manage their notifications
CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- NOTE: No DELETE policy on notifications
-- Rationale: Notifications should be retained for audit purposes

/* ============================================================================
   SUBSCRIPTIONS TABLE POLICIES - OWNER ONLY
   ============================================================================ */

-- POLICY: subscriptions_select
-- Only business owner can view subscription details
-- Rationale: Subscription data is sensitive and should only be visible to owner
CREATE POLICY "subscriptions_select" ON public.subscriptions
  FOR SELECT
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

-- POLICY: subscriptions_insert
-- Only owner can create subscription records
-- Rationale: Subscription management is an owner responsibility
CREATE POLICY "subscriptions_insert" ON public.subscriptions
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

-- POLICY: subscriptions_update
-- Only owner can modify subscription details
-- Rationale: Prevents unauthorized changes to billing setup
CREATE POLICY "subscriptions_update" ON public.subscriptions
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

-- NOTE: No DELETE policy on subscriptions
-- Rationale: Subscriptions should be archived rather than deleted

/* ============================================================================
   SYNC_QUEUE TABLE POLICIES - USER-SPECIFIC
   ============================================================================ */

-- POLICY: sync_queue_select
-- Users can only view their own sync queue
-- Rationale: Prevents users from seeing other users' pending sync operations
CREATE POLICY "sync_queue_select" ON public.sync_queue
  FOR SELECT
  USING (user_id = auth.uid());

-- POLICY: sync_queue_insert
-- All authenticated users can add items to their sync queue
-- Rationale: Users must be able to queue their own sync operations
CREATE POLICY "sync_queue_insert" ON public.sync_queue
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- POLICY: sync_queue_update
-- All authenticated users can update their sync queue (for status updates)
-- Rationale: Users need to update sync status of their own operations
CREATE POLICY "sync_queue_update" ON public.sync_queue
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- POLICY: sync_queue_delete
-- Only owner and admin can delete sync queue items
-- Rationale: Prevents users from erasing audit trail of sync operations
CREATE POLICY "sync_queue_delete" ON public.sync_queue
  FOR DELETE
  USING (get_my_global_role() IN ('owner', 'admin'));

/* ============================================================================
   STANDARD BUSINESS-ISOLATED TABLES
   ============================================================================
   
   The following tables use standard isolation patterns:
   - SELECT: business_id = get_my_business_id()
   - INSERT: business_id = get_my_business_id()
   - UPDATE: get_my_global_role() IN ('owner', 'admin') AND business_id = get_my_business_id()
   - DELETE: get_my_global_role() = 'owner' AND business_id = get_my_business_id()
   
   Tables included: product_pricing, branch_product_prices, price_change_requests,
   branch_stock, stock_transfers, stock_transfer_items, supplier_deliveries,
   supplier_delivery_items, customers, transaction_items, device_sessions,
   subscription_invoices
   
   ============================================================================ */

/* ---- PRODUCT_PRICING TABLE ---- */

-- POLICY: product_pricing_select
-- All users can view product pricing in their business
CREATE POLICY "product_pricing_select" ON public.product_pricing
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: product_pricing_insert
-- Only owner and admin can create product price boundary records
CREATE POLICY "product_pricing_insert" ON public.product_pricing
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id()
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: product_pricing_update
-- Only owner and admin can modify pricing
CREATE POLICY "product_pricing_update" ON public.product_pricing
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: product_pricing_delete
-- Only owner can delete pricing records
CREATE POLICY "product_pricing_delete" ON public.product_pricing
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ---- BRANCH_PRODUCT_PRICES TABLE ---- */

-- POLICY: branch_product_prices_select
-- All users can view branch-specific pricing
CREATE POLICY "branch_product_prices_select" ON public.branch_product_prices
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: branch_product_prices_insert
-- Users in business can create branch pricing
CREATE POLICY "branch_product_prices_insert" ON public.branch_product_prices
  FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- POLICY: branch_product_prices_update
-- Only owner and admin can modify branch pricing
CREATE POLICY "branch_product_prices_update" ON public.branch_product_prices
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: branch_product_prices_delete
-- Only owner can delete branch pricing
CREATE POLICY "branch_product_prices_delete" ON public.branch_product_prices
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ---- PRICE_CHANGE_REQUESTS TABLE ---- */

-- POLICY: price_change_requests_select
-- All users can view price change requests
CREATE POLICY "price_change_requests_select" ON public.price_change_requests
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: price_change_requests_insert
-- Users in business can create requests
CREATE POLICY "price_change_requests_insert" ON public.price_change_requests
  FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- POLICY: price_change_requests_update
-- Only owner and admin can approve/modify requests
CREATE POLICY "price_change_requests_update" ON public.price_change_requests
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: price_change_requests_delete
-- Only owner can delete requests
CREATE POLICY "price_change_requests_delete" ON public.price_change_requests
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ---- BRANCH_STOCK TABLE ---- */

-- POLICY: branch_stock_select
-- All users can view branch stock levels
CREATE POLICY "branch_stock_select" ON public.branch_stock
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: branch_stock_insert
-- Only owner and admin can create stock records
CREATE POLICY "branch_stock_insert" ON public.branch_stock
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id()
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: branch_stock_update
-- Only owner and admin can modify stock levels
CREATE POLICY "branch_stock_update" ON public.branch_stock
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: branch_stock_delete
-- Only owner can delete stock records
CREATE POLICY "branch_stock_delete" ON public.branch_stock
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ---- STOCK_TRANSFERS TABLE ---- */

-- POLICY: stock_transfers_select
-- All users can view stock transfers in business
CREATE POLICY "stock_transfers_select" ON public.stock_transfers
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: stock_transfers_insert
-- Only owner and admin can create stock transfers
CREATE POLICY "stock_transfers_insert" ON public.stock_transfers
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id()
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: stock_transfers_update
-- Only owner and admin can modify transfers
CREATE POLICY "stock_transfers_update" ON public.stock_transfers
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: stock_transfers_delete
-- Only owner can delete transfers
CREATE POLICY "stock_transfers_delete" ON public.stock_transfers
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ---- STOCK_TRANSFER_ITEMS TABLE ---- */

-- POLICY: stock_transfer_items_select
-- All users can view transfer line items
CREATE POLICY "stock_transfer_items_select" ON public.stock_transfer_items
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: stock_transfer_items_insert
-- Only owner and admin can create transfer items
CREATE POLICY "stock_transfer_items_insert" ON public.stock_transfer_items
  FOR INSERT
  WITH CHECK (
    business_id = get_my_business_id()
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: stock_transfer_items_update
-- Only owner and admin can modify transfer items
CREATE POLICY "stock_transfer_items_update" ON public.stock_transfer_items
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: stock_transfer_items_delete
-- Only owner can delete transfer items
CREATE POLICY "stock_transfer_items_delete" ON public.stock_transfer_items
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ---- SUPPLIER_DELIVERIES TABLE ---- */

-- POLICY: supplier_deliveries_select
-- All users can view supplier deliveries
CREATE POLICY "supplier_deliveries_select" ON public.supplier_deliveries
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: supplier_deliveries_insert
-- Users in business can create delivery records
CREATE POLICY "supplier_deliveries_insert" ON public.supplier_deliveries
  FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- POLICY: supplier_deliveries_update
-- Only owner and admin can modify deliveries
CREATE POLICY "supplier_deliveries_update" ON public.supplier_deliveries
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: supplier_deliveries_delete
-- Only owner can delete deliveries
CREATE POLICY "supplier_deliveries_delete" ON public.supplier_deliveries
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ---- SUPPLIER_DELIVERY_ITEMS TABLE ---- */

-- POLICY: supplier_delivery_items_select
-- All users can view delivery line items
CREATE POLICY "supplier_delivery_items_select" ON public.supplier_delivery_items
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: supplier_delivery_items_insert
-- Users in business can create delivery items
CREATE POLICY "supplier_delivery_items_insert" ON public.supplier_delivery_items
  FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- POLICY: supplier_delivery_items_update
-- Only owner and admin can modify delivery items
CREATE POLICY "supplier_delivery_items_update" ON public.supplier_delivery_items
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: supplier_delivery_items_delete
-- Only owner can delete delivery items
CREATE POLICY "supplier_delivery_items_delete" ON public.supplier_delivery_items
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ---- CUSTOMERS TABLE ---- */

-- POLICY: customers_select
-- All users can view customers in their business
CREATE POLICY "customers_select" ON public.customers
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: customers_insert
-- Users in business can create customer records
CREATE POLICY "customers_insert" ON public.customers
  FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- POLICY: customers_update
-- Only owner and admin can modify customer data
CREATE POLICY "customers_update" ON public.customers
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: customers_delete
-- Only owner can delete customers
CREATE POLICY "customers_delete" ON public.customers
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ---- TRANSACTION_ITEMS TABLE ---- */

-- POLICY: transaction_items_select
-- All users can view transaction line items
CREATE POLICY "transaction_items_select" ON public.transaction_items
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: transaction_items_insert
-- Users in business can create transaction items
CREATE POLICY "transaction_items_insert" ON public.transaction_items
  FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- POLICY: transaction_items_update
-- Only owner and admin can modify transaction items
CREATE POLICY "transaction_items_update" ON public.transaction_items
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: transaction_items_delete
-- Only owner can delete transaction items
CREATE POLICY "transaction_items_delete" ON public.transaction_items
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ---- DEVICE_SESSIONS TABLE ---- */

-- POLICY: device_sessions_select
-- All users can view device sessions in their business
CREATE POLICY "device_sessions_select" ON public.device_sessions
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: device_sessions_insert
-- Users in business can create device session records
CREATE POLICY "device_sessions_insert" ON public.device_sessions
  FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- POLICY: device_sessions_update
-- Only owner and admin can modify device sessions
CREATE POLICY "device_sessions_update" ON public.device_sessions
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: device_sessions_delete
-- Only owner can delete device sessions
CREATE POLICY "device_sessions_delete" ON public.device_sessions
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );

/* ---- SUBSCRIPTION_INVOICES TABLE ---- */

-- POLICY: subscription_invoices_select
-- All users can view subscription invoices in their business
CREATE POLICY "subscription_invoices_select" ON public.subscription_invoices
  FOR SELECT
  USING (business_id = get_my_business_id());

-- POLICY: subscription_invoices_insert
-- Users in business can create invoice records
CREATE POLICY "subscription_invoices_insert" ON public.subscription_invoices
  FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- POLICY: subscription_invoices_update
-- Only owner and admin can modify invoices
CREATE POLICY "subscription_invoices_update" ON public.subscription_invoices
  FOR UPDATE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    business_id = get_my_business_id() 
    AND get_my_global_role() IN ('owner', 'admin')
  );

-- POLICY: subscription_invoices_delete
-- Only owner can delete invoices
CREATE POLICY "subscription_invoices_delete" ON public.subscription_invoices
  FOR DELETE
  USING (
    business_id = get_my_business_id() 
    AND get_my_global_role() = 'owner'
  );
