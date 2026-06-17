/*
  SmartRetail Zod schemas

  This file contains all shared Zod validation schemas used across both the
  web and mobile applications. Every schema has an exported inferred
  TypeScript type for use in the app code and API clients.
*/

import { z } from "zod";

// Schema for creating a new business in the SmartRetail platform.
export const createBusinessSchema = z.object({
  name: z.string().min(2).max(100),
  country: z.string().regex(/^[A-Z]{2}$/, "Country must be 2 uppercase letters"),
  currency: z.string().regex(/^[A-Z]{3}$/, "Currency must be 3 uppercase letters"),
  timezone: z.string().min(3),
});

// Schema for creating a new branch for a business.
export const createBranchSchema = z.object({
  name: z.string().min(2).max(100),
  location: z.string().min(3),
  branchType: z.enum(["warehouse", "store"]),
});

// Schema for creating a new product in the catalog.
export const createProductSchema = z.object({
  name: z.string().min(2).max(100),
  sku: z.string().regex(/^[a-zA-Z0-9]+$/, "SKU must be alphanumeric").max(20),
  category: z.string().min(2),
  unit: z.string().min(1),
  description: z.string().max(500).optional(),
});

// Schema for setting product pricing values.
export const setPricingSchema = z
  .object({
    basePrice: z.number().positive(),
    minPrice: z.number().positive(),
    maxPrice: z.number().positive(),
  })
  .refine((data) => data.minPrice < data.basePrice, {
    message: "Minimum price must be less than base price",
    path: ["minPrice"],
  })
  .refine((data) => data.maxPrice > data.basePrice, {
    message: "Maximum price must be greater than base price",
    path: ["maxPrice"],
  });

// Schema for branch-level price overrides.
export const branchPriceSchema = z.object({
  sellingPrice: z.number().positive(),
  // min/max bound validation happens server-side against ProductPricing
});

// Schema used when recording a transaction from mobile or web POS.
export const recordTransactionSchema = z.object({
  branchId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
  paymentMethod: z.enum(["mpesa_stk", "mpesa_manual", "cash", "card"]),
  localId: z.string().uuid(),
  // Generated on device for offline deduplication
  recordedAt: z.string().datetime(),
  customerId: z.string().uuid().optional(),
});

// Schema for submitting a manual MPESA payment confirmation.
export const manualPaymentSchema = z.object({
  mpesaRefCode: z
    .string()
    .regex(/^[A-Z0-9]{8,20}$/, "MPESA reference code must be uppercase alphanumeric and 8-20 characters"),
  // Safaricom confirmation code
  amount: z.number().positive(),
  paymentAt: z.string().datetime(),
});

// Schema for recording a cash deposit payment reference.
export const cashDepositSchema = z.object({
  cashDepositCode: z
    .string()
    .min(6)
    .max(30),
  // Bank deposit reference code uploaded by employee
  amount: z.number().positive(),
});

// Schema for creating a stock transfer between branches.
export const stockTransferSchema = z
  .object({
    fromBranchId: z.string().uuid(),
    toBranchId: z.string().uuid(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantitySent: z.number().int().positive(),
        })
      )
      .min(1),
    notes: z.string().max(500).optional(),
  })
  .refine((data) => data.fromBranchId !== data.toBranchId, {
    message: "Source and destination branches must be different",
    path: ["toBranchId"],
  });

// Schema used when receiving stock for a transfer.
export const receiveStockSchema = z.object({
  transferId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantityReceived: z.number().int().nonnegative(),
        discrepancyNotes: z.string().optional(),
      })
    )
    .min(1),
});

// Schema for registering a new user in SmartRetail.
export const registerUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z
    .string()
    .min(10)
    .max(15)
    .regex(/^[0-9]+$/, "Phone number must contain digits only"),
  // Covers Kenyan and international numeric phone formats
  password: z
    .string()
    .min(8)
    .regex(
      /(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
      "Password must include at least one uppercase letter, one lowercase letter, and one number"
    ),
  globalRole: z.enum(["owner", "admin", "employee"]),
  branchId: z.string().uuid().optional(),
  // Required for employees and admins
});

// Schema for login credentials.
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Export inferred TypeScript input types for all schemas.
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type SetPricingInput = z.infer<typeof setPricingSchema>;
export type BranchPriceInput = z.infer<typeof branchPriceSchema>;
export type RecordTransactionInput = z.infer<typeof recordTransactionSchema>;
export type ManualPaymentInput = z.infer<typeof manualPaymentSchema>;
export type CashDepositInput = z.infer<typeof cashDepositSchema>;
export type StockTransferInput = z.infer<typeof stockTransferSchema>;
export type ReceiveStockInput = z.infer<typeof receiveStockSchema>;
export type RegisterUserInput = z.infer<typeof registerUserSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
