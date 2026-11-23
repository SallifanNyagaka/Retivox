# Retivox database change workflow

The numbered SQL files in this directory are Retivox schema patches. They are
not in Supabase CLI's `supabase/migrations` directory, and applying them in the
Supabase SQL editor does not add entries to Supabase's migration registry.
Therefore, `list_migrations` is not a complete record of which Retivox patches
are present in a database.

## Production reconciliation (2026-11-13)

The connected `smartRetail` project reports three entries in its Supabase
migration registry: `allow_cash_sales_without_reference_codes`,
`qualify_cash_payment_cleanup`, and
`credit_profit_and_idempotent_receivable_payments` (the local patches 066–068).
Read-only catalog checks also confirmed the database objects introduced by
patches 069–071: `branch_cash_deposit_reviews`,
`manager_close_staff_account(uuid,text)`,
`retivox_account_email_in_use(text)`, and the normalized global email unique
index. Those objects exist even though 069–071 are absent from the registry.
This confirms a registry gap; it does not indicate those changes are missing.

The live project currently has four subscription plans and three subscription
rows. One subscription is marked active although its paid period has ended.
That row was not changed during reconciliation. Active platform Daraja settings
currently number zero; platform settings now require the Vault-backed settings
form after patch 072 is applied.

Patches 001–065 cannot be individually certified from the migration registry.
Do not mark them applied based on filenames or timestamps, and do not replay
them against production as a batch. Some are not safely repeatable. The live
catalog and function definitions must be compared with each patch before
changing the historical ledger.

Patches 072-077 have been applied to the connected production project. Patch 072 moves platform Daraja and email-provider credentials to Supabase Vault and adds platform forms. Patch 073 adds subscription grace enforcement and renewal notifications. Patch 074 adds owner-managed Daraja and Pesapal settings backed by Vault. Patch 075 blocks card, bank-transfer, and other payment methods from being recorded as settled until verified provider checkout flows are implemented. Patch 076 adds indexes for the new payment and notification foreign keys. Patch 077 lets platform developers configure the canonical web app URL in the console and exposes only that public value to the mobile app.

## Applying future patches

1. Add the next numbered SQL patch here and review it against the live schema.
2. Apply it once to the intended database using the approved deployment path.
3. Run read-only catalog checks for the new columns, constraints, functions,
   indexes, and RLS policies; run Supabase security/performance advisors when
   the patch changes database objects.
4. Record the database, patch number, date, and verification result in the
   release record. Do not claim the Supabase CLI migration registry is complete
   unless the patch was applied and recorded through that migration workflow.

Before switching this repository to `supabase db push`, create a proper
baseline from the reconciled production schema and validate it on a separate
database. Do not copy these patches into a CLI migration directory: that would
make a future push replay historical SQL against the existing production
schema.


- `078_subscription_licensing_and_price_history.sql` — applied to live Supabase project on 2026-11-13.
- `079_promotions_refunds_retention_and_setup_service.sql` — applied to live Supabase project on 2026-11-13.
- `080_subscription_retention_and_zero_price_promotions.sql` — applied to live Supabase project on 2026-11-13.
- `081_platform_license_adjustments.sql` — applied to live Supabase project on 2026-11-13.
- `082_split_payment_reconciliation_and_refunds.sql` — applied to live Supabase project on 2026-11-13; split-sale RPCs and refund ledger fields were confirmed in the live catalog.
- `083_security_advisor_hardening.sql` — applied to live Supabase project on 2026-11-13; fixed mutable search paths and switched the lot reconciliation view to invoker security.
- `085_business_daraja_stk_checkout.sql` — applied to live Supabase project on 2026-11-13; added business STK checkout tracking and a provider callback result RPC without replacing the existing sale finalizer.
- `086_daraja_checkout_start_validation.sql` — applied to live Supabase project on 2026-11-13; restricts checkout start to an unsubmitted POS payment intent.
- `087_daraja_provider_only_settlement.sql` — applied to live Supabase project on 2026-11-13; makes callback processing idempotent and prevents manual verification of STK payments.
- `088_platform_subscription_refunds.sql` — applied to live Supabase project on 2026-11-13; adds audited platform refund request, review, and provider-reference completion operations.
- `089_daraja_c2b_reconciliation.sql` — applied to live Supabase project on 2026-11-13; records incoming C2B receipts in an unmatched queue and adds an owner/admin branch-authorized exact-amount reconciliation operation.
- `090_revoke_trigger_function_rpc_access.sql` — applied to live Supabase project on 2026-11-13; removes direct API execution grants from six trigger-only functions after confirming they are attached to database triggers.
- `091_revoke_event_trigger_rpc_access.sql` — applied to live Supabase project on 2026-11-13; removes direct API execution grants from the PostgreSQL DDL event-trigger function.
- `092_platform_table_access_scoping.sql` — applied to live Supabase project on 2026-11-13; removes unused Data API grants from platform service tables and adds a read-only policy for active subscription plan catalog entries.
- `093_business_pesapal_checkout.sql` — applied to live Supabase project on 2026-11-13; adds merchant hosted checkout intents, IPN registration storage, and status-verified Pesapal settlement.
- `094_pesapal_status_handling.sql` — applied to live Supabase project on 2026-11-13; leaves invalid/unknown Pesapal statuses pending review and only rejects explicit provider failures or reversals.
- `095_platform_pesapal_subscriptions.sql` — applied to live Supabase project on 2026-11-16; adds a separate Vault-backed platform Pesapal account, subscription checkout tracking, provider-verified license activation, and reversal handling.
- `096_pesapal_subscription_callback_recovery.sql` — applied to live Supabase project on 2026-11-16; recovers provider callbacks that arrive before a checkout tracking ID is persisted, while still requiring the provider-returned merchant reference to match.
- `097_pesapal_refund_submission.sql` — applied to live Supabase project on 2026-11-16; tracks provider refund submission separately from confirmed completion and enforces Pesapal’s one-refund/mobile full-refund limits.
- `098_restrict_legacy_sale_rpc_execution.sql` — applied to live Supabase project on 2026-11-16; removes anonymous/PUBLIC execution from the legacy dashboard and employee sale writers while preserving authenticated execution. Confirmed both writer functions and their v2/split wrappers remain executable by `authenticated` and unavailable to `anon`.
- `099_restrict_financial_review_rpc_execution.sql` — applied to live Supabase project on 2026-11-16; removes anonymous/PUBLIC execution from payment verification and cash-deposit record/review RPCs while preserving authenticated calls. Live privilege checks confirmed the three RPCs are `anon=false`, `authenticated=true`.
- `100_restrict_owner_finance_rpc_execution.sql` — applied to live Supabase project on 2026-11-16; restricts transaction voids, owner expenses, recurring expense actions, and legacy cash-deposit/review operations to authenticated sessions. Live privilege checks confirmed all seven functions are `anon=false`, `authenticated=true`.
- `101_restrict_owner_admin_rpc_execution.sql` — applied to live Supabase project on 2026-11-16; restricts staff hard deletion and owner product create/update/activation RPCs to authenticated sessions. Live privilege checks confirmed all four functions are `anon=false`, `authenticated=true`.
- `102_restrict_inventory_workflow_rpc_execution.sql` — applied to live Supabase project on 2026-11-16; restricts stock adjustments, transfers, supplier-delivery approvals/edits, and inventory-loss workflows to authenticated sessions. Live privilege checks confirmed all 19 overloads are `anon=false`, `authenticated=true`.
- `103_scope_identity_lookup_rpc_access.sql` — applied to live Supabase project on 2026-11-16; identity/branch lookup RPCs now reject requests where the supplied user ID differs from `auth.uid()`. Live catalog checks confirmed all five functions include the self-scope guard and are unavailable to `anon`.
- `104_restrict_internal_security_definer_helpers.sql` — applied to live Supabase project on 2026-11-16; removes direct client execution from internal delivery-edit, pricing-approval, UOM assertion, snapshot, and cash-total helpers; scopes branch-denial audit writes to the signed-in actor. The live catalog confirms internal functions remain executable by the service role and the user-facing helpers retain authenticated access.
- `105_restrict_remaining_admin_and_delivery_writes.sql` — applied to live Supabase project on 2026-11-16; removes anonymous access to supplier-delivery acknowledgement, inventory-loss reporting, supplier updates, and login-review submission, and removes direct client access to the internal stock-cost repair helper.
- `106_restrict_dashboard_read_rpc_execution.sql` — applied to live Supabase project on 2026-11-16; scopes admin/employee inventory reports and dashboard stock, movement, and transaction metrics RPCs to authenticated sessions.
- `107_scope_owner_reports_and_product_helpers.sql` — applied to live Supabase project on 2026-11-16; restricts owner metrics and identity helpers to authenticated sessions, adds business-scope checks to product/UOM lookups, and removes client access to internal sale-price resolvers.
- `108_platform_pesapal_recurring_renewals.sql` — applied to live Supabase project on 2026-11-16; adds customer-authorized Pesapal monthly/yearly card renewal enrollment, verified recurring-IPN payment recording, owner cancellation tracking, and safe default-off behavior for legacy renewal flags.
- `109_pesapal_recurring_status_transitions.sql` — applied to live Supabase project on 2026-11-16; processes later status changes for the same recurring charge, including reversals, without treating a repeat notification as an unverified success.
- `110_enforce_plan_payment_entitlements.sql` — applied to live Supabase project on 2026-11-16; gates online Daraja and Pesapal payments against a package's `features.payment_methods` value while retaining Cash and Mobile manual as baseline options.
- `111_require_verified_provider_for_online_tenders.sql` — applied to live Supabase project on 2026-11-16; requires online payment rows to use the matching provider and blocks authenticated users from directly marking provider-backed tenders as verified.
- `112_integration_setup_pricing_and_promotions.sql` — applied to live Supabase project on 2026-11-16; adds audited per-business assisted-setup fee overrides, validates setup promotions, issues one-time setup fee credits only after eligible subscription payments verify, records setup redemptions, and adds the checked owner request RPC. Platform admins can track setup payment status and references.

Security review after patch 083 cleared the security-definer view and mutable
search-path findings. Patches 090–092 removed client grants from seven
trigger/event-trigger-only functions and seven service-managed platform tables;
the active subscription-plan catalog now has a read-only policy. The latest
Supabase advisor reports only two intentionally public `SECURITY DEFINER`
functions (`public_app_runtime_config` and approved `public_login_reviews`)
callable by `anon`; it reports 27 RLS-enabled tables without client policies
after migration 113, with live privilege checks confirming zero of those
tables grant access to `anon` or `authenticated`. The new recurring-charge
table is service-role-only. The advisor also reports leaked-password
protection disabled. Migrations 098–109 remove anonymous access from sensitive
application RPCs, scope identity and product lookups, keep internal mutation
helpers off the Data API, make recurring IPN status transitions idempotent,
gate provider tenders by the active subscription package, and require provider
callbacks to verify online payment rows. The Auth password-protection setting
remains an external dashboard configuration item. A prior application-wide function-ACL migration was
rejected by automatic review because its blast radius had not been approved;
the current advisor reports 105 authenticated `SECURITY DEFINER` RPCs,
which need function-level review rather than blanket revocation. The two
anonymous functions return public runtime configuration and approved public
login-review content. Live checks confirm the 27 tables without policies grant neither `anon` nor `authenticated` table access.

- 113_subscription_price_change_notices.sql — publishes independent effective dates per billing interval, gives existing subscribers a 30-day renewal notice when that interval's price rises or its currency changes, and sends deduplicated in-app notices to active business owners. Notice ledger is service-role-only.
- 114_self_scope_employee_branch_assertion.sql — binds the employee branch assertion and any denial audit entry to the authenticated employee identity.
- 115_preserve_pending_subscription_price_notices.sql — prevents a price edit for one billing interval from superseding another interval's still-pending 30-day notice.
- 116_trial_expiry_without_grace.sql — expires free trials immediately at the end date, gives only paid uncancelled subscriptions the seven-day grace period, and updates the write gate and notices to match.
- 117_subscription_price_notice_indexes.sql — adds partial indexes for eligible subscriptions and active business owners used by the price-notice trigger.
- 118_index_new_payment_fk_columns.sql — indexes foreign-key columns on assisted-setup pricing, promotions, and price-notice ledgers.
- 119_retain_daraja_callback_mismatches.sql — stores sanitized Daraja callback payloads in the service-only event ledger and records settlement mismatches without rolling back their audit trail.
- 120_sale_idempotency_and_retry_safety.sql — binds online sale retries to stable request IDs and immutable payloads, makes offline/PWA retry finalization idempotent, and retains database stock locks as the final availability check.
- 121_cash_sales_without_reference_on_offline_sync.sql — repairs the offline dashboard wrapper's cash argument while retaining idempotent sale retries. Applied to the live Supabase project on 2026-11-18.
- 122_remove_legacy_cash_reference_requirement.sql — removes the obsolete cash deposit/reference validation from the legacy dashboard transaction RPC and passes NULL directly through online/offline sale wrappers; M-Pesa reference validation remains intact. Applied to the live Supabase project on 2026-11-18.
- 123_daraja_buy_goods_till_separation.sql — separates Store/API shortcode from the customer-facing Buy Goods Till for platform and merchant STK settings, preserves existing Vault credentials, and makes final business callback failures terminal/idempotent.
- 124_business_payment_instructions.sql — stores tenant-scoped, non-secret customer payment instructions and an audited owner-only settings RPC.
- 125_business_payment_methods_access_indexes.sql — indexes the business payment settings audit-user foreign key and explicitly denies Data API access to the service-role-only configuration table.
- 126_manual_payment_evidence_and_settlement.sql — requires an evidence source and note before manual M-PESA settlement, reserves pending manual amounts in credit collection, filters receivable balances to verified funds, and makes owner verification atomic and auditable while preserving trusted Daraja C2B reconciliation.
- 127_business_payment_instructions_read_rpc.sql — returns only active, non-secret payment directions to authenticated members of their own business for checkout and account-scoped offline caching.
- 128_sale_payment_method_association.sql — atomically binds the selected manual M-PESA instruction profile and versioned, sanitized instructions snapshot to sale payment rows for Web, PWA and Flutter online/offline synchronization.
- 129_payment_method_version_history_access.sql — indexes the tenant foreign key on immutable instruction history and limits its explicit RLS policy to the trusted server role.
- 130_business_payment_attempt_status.sql — exposes a tenant-scoped, read-only payment status projection so clients can resume pending checkout progress without reading provider secrets or changing settlement state.
- 131_offline_inventory_and_payment_rpc_correction.sql — aligns the public payment-instructions RPC with its bigint source column and adds inaccessible idempotency receipts plus authenticated retry-safe wrappers for offline supplier deliveries and stock adjustments. Applied to the live Supabase project on 2026-11-23; verified the RPC return type, authenticated execution grants, and that anon/authenticated roles cannot read the receipt ledger.
- 132_employee_offline_sale_and_payment_settings_ambiguity_fix.sql — qualifies the employee offline sale payment update and owner payment-settings authorization columns to avoid PL/pgSQL output-variable ambiguity while preserving sale idempotency, timestamps and function access. Applied to the live Supabase project on 2026-11-23 after confirming both SQLSTATE 42702 errors in production logs.
- 133_business_payment_provider_plan_automation.sql — enforces online-provider plan entitlements in the database and removes provider configuration plus unshared Vault credentials after downgrade, expiry, cancellation, or plan-policy changes. Applied to the live Supabase project on 2026-11-23.
- 134_subscription_plan_change_cadence.sql — runs the existing subscription lifecycle processor every five minutes so verified renewals and scheduled plan downgrades apply close to their effective time.

