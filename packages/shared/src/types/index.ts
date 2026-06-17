// Enums
export enum GlobalRole {
  Owner = "owner",
  Admin = "admin",
  Employee = "employee",
}

export enum BranchType {
  Warehouse = "warehouse",
  Store = "store",
}

export enum TransactionStatus {
  PendingSync = "pending_sync",
  Synced = "synced",
  PendingVerify = "pending_verify",
  Verified = "verified",
  Rejected = "rejected",
  Flagged = "flagged",
  Voided = "voided",
}

export enum PaymentMethod {
  MpesaStk = "mpesa_stk",
  MpesaManual = "mpesa_manual",
  Cash = "cash",
  Card = "card",
}

export enum PaymentStatus {
  Pending = "pending",
  PendingVerify = "pending_verify",
  Verified = "verified",
  Rejected = "rejected",
}

export enum StockTransferStatus {
  Initiated = "initiated",
  InTransit = "in_transit",
  PartiallyReceived = "partially_received",
  Received = "received",
  Disputed = "disputed",
}

export enum PriceChangeStatus {
  Requested = "requested",
  PendingApproval = "pending_approval",
  Approved = "approved",
  Rejected = "rejected",
}

export enum SyncStatus {
  Pending = "pending",
  Syncing = "syncing",
  Synced = "synced",
  Conflict = "conflict",
  Failed = "failed",
}

// Types
export type Business = {
  id: string;
  name: string;
  slug: string;
  country: string;
  currency: string;
  timezone: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  createdAt: string;
};

export type User = {
  id: string;
  businessId: string;
  name: string;
  email: string;
  phone: string;
  globalRole: GlobalRole;
  isActive: boolean;
  lastLoginAt: string;
  createdAt: string;
};

export type Branch = {
  id: string;
  businessId: string;
  name: string;
  location: string;
  branchType: BranchType;
  isActive: boolean;
  createdAt: string;
};

export type UserBranchRole = {
  id: string;
  userId: string;
  branchId: string;
  role: GlobalRole;
  assignedBy: string;
  assignedAt: string;
};

export type Product = {
  id: string;
  businessId: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
};

export type ProductPricing = {
  id: string;
  productId: string;
  businessId: string;
  basePrice: number;
  minPrice: number;
  maxPrice: number;
  setBy: string;
  effectiveFrom: string;
  createdAt: string;
};

export type BranchProductPrice = {
  id: string;
  productId: string;
  branchId: string;
  businessId: string;
  sellingPrice: number;
  status: PriceChangeStatus;
  requestedBy: string;
  approvedBy?: string;
  requestedAt: string;
  approvedAt?: string;
};

export type BranchStock = {
  id: string;
  branchId: string;
  productId: string;
  businessId: string;
  quantityOnHand: number;
  quantityReserved: number;
  lowStockThreshold: number;
  lastUpdatedAt: string;
};

export type Transaction = {
  id: string;
  businessId: string;
  branchId: string;
  employeeId: string;
  customerId?: string;
  status: TransactionStatus;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  origin: string;
  syncStatus: SyncStatus;
  localId: string;
  recordedAt: string;
  syncedAt?: string;
  createdAt: string;
};

export type TransactionItem = {
  id: string;
  transactionId: string;
  productId: string;
  quantity: number;
  unitPriceAtSale: number;
  lineTotal: number;
  stockStatus: string;
};

export type Payment = {
  id: string;
  transactionId: string;
  businessId: string;
  paymentMethod: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  mpesaRefCode?: string;
  mpesaCheckoutId?: string;
  paybillNumber?: string;
  accountReference?: string;
  cashDepositCode?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  paymentAt: string;
};

export type Customer = {
  id: string;
  businessId: string;
  name: string;
  phone?: string;
  email?: string;
  totalVisits: number;
  totalSpent: number;
  firstPurchaseAt?: string;
  lastPurchaseAt?: string;
};

export type StockTransfer = {
  id: string;
  businessId: string;
  fromBranchId: string;
  toBranchId: string;
  initiatedBy: string;
  receivedBy?: string;
  status: StockTransferStatus;
  notes?: string;
  initiatedAt: string;
  receivedAt?: string;
};

export type StockTransferItem = {
  id: string;
  transferId: string;
  productId: string;
  quantitySent: number;
  quantityReceived?: number;
  quantityDiscrepancy?: number;
  discrepancyNotes?: string;
};

export type AuditLog = {
  id: string;
  businessId: string;
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  oldValue?: any;
  newValue?: any;
  createdAt: string;
};

export type Notification = {
  id: string;
  businessId: string;
  recipientId: string;
  type: string;
  title: string;
  body: string;
  metadata?: any;
  isRead: boolean;
  createdAt: string;
};
