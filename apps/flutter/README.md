# Retivox Flutter POS

The Flutter app is the first desktop step toward a shared Windows/mobile POS. The signed-in role controls the left-side dashboard navigation. Available views include cached branches, stock, products, transaction receipts, owner/admin transfers, suppliers, employees, damage reports, owner analytics and finance summaries, the owner's admin directory and audit log, account settings, and local POS sales. Views are encrypted and cached per account for offline access.

Analytics uses the same owner-only summary RPC as the web dashboard, with 7-, 30-, and 90-day ranges. Finance summaries use verified sales, stamped item costs, operating expenses, and inventory losses with today/week/month and active-branch filters. Owners can create, activate, and deactivate branches; record expenses and inventory losses; review employee damage reports; reconcile cash deposits; manage recurring expense templates/reminders; verify or reject pending transaction payments; and void transactions. Owners/admins can initiate and receive stock transfers, record supplier deliveries, adjust authorized branch stock and thresholds, and manage suppliers; owners can approve transfers and pending supplier deliveries, while authorized branch admins acknowledge approved deliveries. Owners can create products with multiple purchase/sale units, add business units while creating or editing a product, configure fixed, assisted-pack, or manual-quantity prices with discounts and branch scopes, and edit product details and assignments. Replaced pricing models are inactivated so their price-point history remains available. Admins/employees can submit damage reports. These write operations require an online session and use authenticated Supabase RPCs or role-scoped RLS. Transfer and transaction details include their line items and payment information. Owners can edit business profile details; all users can edit personal name/phone and change passwords, and have a locally persisted dark appearance preference.

Owner admin creation/invites, branch-access changes, admin activation, and confirmation-protected branch soft-deletion use authenticated server API routes; permanent user removal remains in the web dashboard. Branch deletion retains historical records while disabling access, clearing live/recovery stock, and closing pending damage reports. Subscription plan viewing, manual payment references, and M-Pesa STK initiation are available to owners. STK requires Daraja credentials configured only on the deployed web server and is not available offline. The API routes must be deployed with the web app before these desktop workflows can connect. Transaction status, branch, date, and text filters and audit actor/action/entity filters are applied by the server before 200-row pagination; when offline, the cached page can still be filtered locally. A Windows scheduled task retries queued sales every five minutes while the same Windows account is signed in; it requires a valid saved Supabase session and does nothing after sign-out. Supplier delivery entry currently uses existing active suppliers and stocked products with purchase units; received deliveries can be edited by owners or submitted by admins for owner review. No live Supabase write workflows have been exercised in this environment.

## Windows setup

Create a `.env` file next to `retivox_client.exe` with the Supabase project URL and publishable client key:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
RETIVOX_WEB_API_URL=https://your-deployed-retivox-web-app.example
```

For local development, the app reads `.env` next to the executable. Flutter build-time `--dart-define` values and process environment variables are supported as fallbacks. `RETIVOX_WEB_API_URL` is the origin of the deployed Retivox Next.js app and is required for owner admin management and subscription display/STK payments. Deploy the new `apps/web/app/api/desktop` routes first; the web deployment also needs its existing server-side `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_APP_URL` configuration, plus server-side Daraja settings for STK payments. Never put a Supabase service-role key or Daraja credentials in the app.

Apply the current Supabase schema, including `apps/web/lib/supabase/schema/019_stock_delivery_approval_workflow.sql`, `020_uom_system.sql`, `021_product_pricing_models.sql`, `023_uom_aware_stock_and_sales.sql`, `024_pricing_models_and_price_point_discounts.sql`, `034_supplier_delivery_edit_workflow.sql`, `035_finance_expenses_and_losses.sql`, `036_recurring_finance_expenses.sql`, `040_employee_inventory_loss_reports.sql`, `042_admin_inventory_loss_reports.sql`, `043_deleted_branch_dashboard_scope.sql`, `046_subscription_payment_requests.sql`, `047_platform_console_and_daraja.sql`, `049_platform_operations_console.sql`, `050_daraja_paybill_prompt_method.sql`, `052_cash_deposit_reconciliation.sql`, `053_supplier_directory_and_rankings.sql`, and `057_subscription_lifecycle.sql` for the finance and dashboard workflows. Apply `054_mobile_offline_transaction_timestamp.sql` and `058_offline_dashboard_transaction_sync.sql` before testing employee or owner/admin offline sale synchronization. Confirm the transfer, stock, and UOM migrations (including `013_dashboard_transfer_access_rpc.sql`, `014_stock_section_admin_capabilities.sql`, and `027_uom_aware_stock_transfers.sql`) are also applied.

## Offline sales

1. Sign in online and set a six-digit offline PIN. The app saves the account profile, branch assignments, POS catalog, and opened dashboard views encrypted on this computer.
2. Select a saved branch. Product and stock data must have been loaded online at least once before that branch can sell offline.
3. Sales are queued in the local SQLite database before synchronization is attempted. Reconnect triggers sync, with additional retries while the app is open and when it resumes.
4. A server rejection stays visible as **Needs correction**. Correct the quantities or cancel the unsynced sale; it is never reported as synced unless the server confirms it.
5. Offline PIN access remains until the user signs out. Account or permission revocation is only detected when the computer reconnects.

Security-sensitive changes such as approvals and user/permission management require an online connection. Cached views are scoped to the signed-in account; stock, transfers, finance, and transaction history are constrained to the applicable branch/role scope, and employee transaction history is filtered to that employee. Audit data can contain sensitive before-and-after values; sign out on shared devices.

The background task runs only in the current Windows user's interactive session. It uses the app's encrypted local queue and secure Supabase session, and a per-account SQLite lease prevents competing app processes from syncing the same queue concurrently. To register or remove the task for an installed app:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\Retivox\manage_background_sync.ps1" -ExecutablePath "$env:LOCALAPPDATA\Programs\Retivox\retivox_client.exe"
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\Retivox\manage_background_sync.ps1" -Remove
```

The script is at `apps/flutter/windows/manage_background_sync.ps1`. The owner admin/subscription APIs still require a deployed web app with the desktop API routes and the installed `.env` must point `RETIVOX_WEB_API_URL` to that deployment.

## Validation

```powershell
flutter analyze
flutter test
flutter build windows
```
