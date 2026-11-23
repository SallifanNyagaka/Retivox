import 'dart:async';

import '../../presentation/models/overview_snapshot.dart';

import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../core/auth/offline_account_vault.dart';
import '../../core/auth/retivox_user.dart';
import '../../core/network/web_api_client.dart';
import '../../core/network/backend_health_check.dart';
import 'barcode_similarity.dart';

class DashboardSnapshot {
  const DashboardSnapshot({
    required this.section,
    required this.rows,
    required this.updatedAt,
    required this.isCached,
  });

  final String section;
  final List<Map<String, dynamic>> rows;
  final DateTime? updatedAt;
  final bool isCached;
}

class BusinessPaymentSettingsSnapshot {
  const BusinessPaymentSettingsSnapshot({
    required this.providers,
    required this.methods,
    this.manualPaymentOptions = const [],
    required this.updatedAt,
    required this.isCached,
  });

  final List<Map<String, dynamic>> providers;
  final Map<String, dynamic> methods;
  final List<Map<String, dynamic>> manualPaymentOptions;
  final DateTime? updatedAt;
  final bool isCached;

  Map<String, Object?> toJson() => {
    'providers': providers,
    'methods': methods,
    'manualPaymentOptions': manualPaymentOptions,
    'updatedAt': updatedAt?.toIso8601String(),
  };

  factory BusinessPaymentSettingsSnapshot.fromJson(
    Map<String, dynamic> json, {
    required bool isCached,
  }) {
    final providers = (json['providers'] as List? ?? const [])
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
    final methods = json['methods'] is Map
        ? Map<String, dynamic>.from(json['methods'] as Map)
        : <String, dynamic>{
            'cash': true,
            'mobile_manual': true,
            'daraja_prompt_entitled': false,
            'pesapal_checkout_entitled': false,
            'daraja_prompt': false,
            'pesapal_checkout': false,
          };
    final manualPaymentOptions =
        (json['manualPaymentOptions'] as List? ?? const [])
            .whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .toList();
    return BusinessPaymentSettingsSnapshot(
      providers: providers,
      methods: methods,
      manualPaymentOptions: manualPaymentOptions,
      updatedAt: DateTime.tryParse(json['updatedAt']?.toString() ?? '')
          ?.toLocal(),
      isCached: isCached,
    );
  }
}

class TransferOptionsSnapshot {
  const TransferOptionsSnapshot({
    required this.branches,
    required this.stockRows,
    required this.updatedAt,
    required this.isCached,
    this.products = const [],
  });

  final List<Map<String, dynamic>> branches;
  final List<Map<String, dynamic>> stockRows;
  final List<Map<String, dynamic>> products;
  final DateTime? updatedAt;
  final bool isCached;
}

class ProductOptionsSnapshot {
  const ProductOptionsSnapshot({
    required this.units,
    this.branches = const [],
    this.product,
  });

  final List<Map<String, dynamic>> units;
  final List<Map<String, dynamic>> branches;
  final Map<String, dynamic>? product;
}

class ProductPricePointInput {
  const ProductPricePointInput({
    required this.uomId,
    required this.quantity,
    required this.price,
    this.maxDiscountAmount = 0,
  });

  final String uomId;
  final double quantity;
  final double price;
  final double maxDiscountAmount;
}

class DamageReportOptionsSnapshot {
  const DamageReportOptionsSnapshot({required this.rows});

  final List<Map<String, dynamic>> rows;
}

class DashboardRepository {
  DashboardRepository({
    required this.vault,
    required this.client,
    required this.backendHealthCheck,
    this.webApiClient,
  });

  final OfflineAccountVault vault;
  final SupabaseClient? client;
  final BackendHealthCheck backendHealthCheck;
  final WebApiClient? webApiClient;
  bool _isSyncingDashboardAction = false;

  // Existing methods …

  /// Loads the overview data used on the dashboard.
  /// Returns cached data when offline or when the network request fails.
  Future<bool> isBackendReachable() async {
    return client != null && backendHealthCheck.isConfigured
        ? backendHealthCheck.isReachable()
        : false;
  }

  static const _businessPaymentSettingsCacheKey =
      'dashboard:payment-provider-settings';
  static const _businessPaymentInstructionsCacheKey =
      'dashboard:business-payment-instructions';

  /// Loads public merchant payment instructions from the authenticated
  /// business-scoped RPC and falls back to the per-account encrypted cache.
  Future<List<Map<String, dynamic>>> loadBusinessPaymentInstructions(
    RetivoxUser user,
  ) async {
    final supabase = client;
    if (supabase != null && await isBackendReachable()) {
      try {
        final raw = await supabase.rpc('business_public_payment_methods');
        final methods = (raw as List? ?? const [])
            .whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .where((row) => row['is_active'] != false)
            .toList();
        await vault.cacheValue(user, _businessPaymentInstructionsCacheKey, {
          'methods': methods,
          'updatedAt': DateTime.now().toUtc().toIso8601String(),
        });
        return methods;
      } catch (error) {
        final cached = await vault.readCachedValue<Map<String, dynamic>>(
          user,
          _businessPaymentInstructionsCacheKey,
        );
        if (cached != null && _isNetworkError(error)) {
          return _manualPaymentMethodsFromCache(cached);
        }
        if (cached == null && _isNetworkError(error)) return const [];
        rethrow;
      }
    }

    final cached = await vault.readCachedValue<Map<String, dynamic>>(
      user,
      _businessPaymentInstructionsCacheKey,
    );
    return cached == null ? const [] : _manualPaymentMethodsFromCache(cached);
  }

  List<Map<String, dynamic>> _manualPaymentMethodsFromCache(
    Map<String, dynamic> cached,
  ) => (cached['methods'] as List? ?? const [])
      .whereType<Map>()
      .map((row) => Map<String, dynamic>.from(row))
      .where((row) => row['is_active'] != false)
      .toList();

  Future<BusinessPaymentSettingsSnapshot> loadBusinessPaymentSettings(
    RetivoxUser user,
  ) async {
    if (user.role != RetivoxRole.owner) {
      throw const DashboardRepositoryException(
        'Only the business owner can configure payment providers.',
      );
    }

    final api = webApiClient;
    if (api != null && await isBackendReachable()) {
      try {
        final response = await api.get('/api/desktop/payment-settings');
        final raw = response['data'];
        if (raw is! Map) {
          throw const DashboardRepositoryException(
            'The server returned invalid payment settings.',
          );
        }
        final data = Map<String, dynamic>.from(raw);
        data['updatedAt'] = DateTime.now().toUtc().toIso8601String();
        await vault.cacheValue(user, _businessPaymentSettingsCacheKey, data);
        return BusinessPaymentSettingsSnapshot.fromJson(data, isCached: false);
      } catch (error) {
        final cached = await vault.readCachedValue<Map<String, dynamic>>(
          user,
          _businessPaymentSettingsCacheKey,
        );
        final canUseCache = error is WebApiException
            ? error.allowCachedFallback
            : _isNetworkError(error);
        if (cached != null && canUseCache) {
          return BusinessPaymentSettingsSnapshot.fromJson(
            cached,
            isCached: true,
          );
        }
        rethrow;
      }
    }

    final cached = await vault.readCachedValue<Map<String, dynamic>>(
      user,
      _businessPaymentSettingsCacheKey,
    );
    if (cached != null) {
      return BusinessPaymentSettingsSnapshot.fromJson(cached, isCached: true);
    }
    return BusinessPaymentSettingsSnapshot(
      providers: const [],
      methods: const {
        'cash': true,
        'mobile_manual': true,
        'daraja_prompt_entitled': false,
        'pesapal_checkout_entitled': false,
        'daraja_prompt': false,
        'pesapal_checkout': false,
      },
      updatedAt: null,
      isCached: true,
    );
  }

  Future<void> saveBusinessPaymentProvider(
    RetivoxUser user,
    Map<String, Object?> settings,
  ) async {
    if (user.role != RetivoxRole.owner) {
      throw const DashboardRepositoryException(
        'Only the business owner can configure payment providers.',
      );
    }
    if (!await isBackendReachable()) {
      throw const DashboardRepositoryException(
        'Payment provider credentials can only be saved while online. Cash and Mobile manual remain available offline.',
      );
    }
    final api = webApiClient;
    if (api == null) {
      throw const DashboardRepositoryException(
        'Configure RETIVOX_WEB_API_URL before saving provider settings.',
      );
    }
    await api.post('/api/desktop/payment-settings', {
      'action': 'save',
      ...settings,
    });
    await loadBusinessPaymentSettings(user);
  }

  Future<void> saveBusinessManualPaymentMethod(
    RetivoxUser user,
    Map<String, Object?> settings,
  ) async {
    if (user.role != RetivoxRole.owner) {
      throw const DashboardRepositoryException(
        'Only the business owner can configure payment methods.',
      );
    }
    if (!await isBackendReachable()) {
      throw const DashboardRepositoryException(
        'Payment instructions can only be changed while online.',
      );
    }
    final api = webApiClient;
    if (api == null) {
      throw const DashboardRepositoryException(
        'Configure RETIVOX_WEB_API_URL before saving payment instructions.',
      );
    }
    await api.post('/api/desktop/payment-settings', {
      'action': 'save_method',
      ...settings,
    });
    await loadBusinessPaymentSettings(user);
    await loadBusinessPaymentInstructions(user);
  }

  Future<String> runBusinessPaymentProviderAction(
    RetivoxUser user, {
    required String action,
    String? provider,
  }) async {
    if (user.role != RetivoxRole.owner) {
      throw const DashboardRepositoryException(
        'Only the business owner can configure payment providers.',
      );
    }
    if (!await isBackendReachable()) {
      throw const DashboardRepositoryException(
        'Provider testing and callback registration require an online connection.',
      );
    }
    final api = webApiClient;
    if (api == null) {
      throw const DashboardRepositoryException(
        'Configure RETIVOX_WEB_API_URL before managing provider callbacks.',
      );
    }
    final response = await api.post('/api/desktop/payment-settings', {
      'action': action,
      if (provider != null) 'provider': provider,
    });
    return response['message']?.toString() ??
        'Payment provider action completed.';
  }

  Future<void> startBusinessSalePrompt({
    required RetivoxUser user,
    required String paymentId,
    required String phone,
  }) async {
    if (!await isBackendReachable()) {
      throw const DashboardRepositoryException(
        'M-PESA prompts require a live Retivox connection. No prompt was started.',
      );
    }
    final api = webApiClient;
    if (api == null) {
      throw const DashboardRepositoryException(
        'Configure RETIVOX_WEB_API_URL before starting M-PESA prompts.',
      );
    }
    await api.post('/api/desktop/business-payment-checkout', {
      'paymentId': paymentId,
      'phone': phone,
    });
  }

  Future<OverviewSnapshot> loadOverview(RetivoxUser user) async {
    if (!await isBackendReachable()) {
      final cached = await _cachedOverview(user);
      if (cached != null) return cached.copyWith(isCached: true);
      throw const DashboardRepositoryException(
        'No saved overview is available on this computer yet.',
      );
    }
    try {
      final supabase = await _requireOnlineRole(user, RetivoxRole.values);
      final raw = await supabase.rpc(
        'desktop_overview_detailed',
        params: {'business_id': user.businessId},
      );
      final overviewData = Map<String, dynamic>.from(
        raw as Map<String, dynamic>,
      );
      if (user.role == RetivoxRole.owner) {
        final receivables = await supabase
            .from('receivable_account_balances')
            .select('balance_due')
            .eq('business_id', user.businessId)
            .gt('balance_due', 0);
        overviewData['totalLent'] = (receivables as List).fold<double>(
          0,
          (total, row) =>
              total +
              (double.tryParse((row as Map)['balance_due']?.toString() ?? '') ??
                  0),
        );
        final now = DateTime.now();
        final today = DateTime(now.year, now.month, now.day);
        final dueThrough = today.add(const Duration(days: 2));
        final creditDueAlerts = await supabase
            .from('receivable_account_balances')
            .select(
              'id, customer_name, customer_phone, due_date, balance_due, account_status, branch_name',
            )
            .eq('business_id', user.businessId)
            .gt('balance_due', 0)
            .lte('due_date', dueThrough.toIso8601String().substring(0, 10))
            .order('due_date')
            .range(0, 99);
        overviewData['creditDueAlerts'] = creditDueAlerts;
        final localNow = DateTime.now();
        final todayStart = DateTime(
          localNow.year,
          localNow.month,
          localNow.day,
        ).toUtc().toIso8601String();
        final payments = await supabase
            .from('payments')
            .select(
              'payment_method, amount, status, transactions!inner(branch_id, status)',
            )
            .eq('business_id', user.businessId)
            .gte('payment_at', todayStart)
            .neq('status', 'rejected');
        final byMethod = <String, double>{};
        for (final payment in payments as List) {
          final transaction = payment['transactions'];
          if (transaction is Map &&
              ['voided', 'rejected'].contains(transaction['status']))
            continue;
          final method = payment['payment_method']?.toString() ?? 'other';
          byMethod[method] =
              (byMethod[method] ?? 0) +
              (double.tryParse(payment['amount']?.toString() ?? '') ?? 0);
        }
        overviewData['paymentMethodsToday'] = byMethod;
      }
      final snapshot = OverviewSnapshot.fromJson(overviewData)
          .copyWith(updatedAt: DateTime.now(), isCached: false);
      await vault.cacheValue(user, 'dashboard:overview', snapshot.toJson());
      return snapshot;
    } catch (error) {
      if (!_isNetworkError(error)) rethrow;
      final cached = await _cachedOverview(user);
      if (cached != null) return cached.copyWith(isCached: true);
      rethrow;
    }
  }

  Future<OverviewSnapshot?> _cachedOverview(RetivoxUser user) async {
    final cached = await vault.readCachedValue<Map<String, dynamic>>(
      user,
      'dashboard:overview',
    );
    return cached == null
        ? null
        : OverviewSnapshot.fromJson(cached).copyWith(isCached: true);
  }

  Future<List<Map<String, dynamic>>> loadAdminBranchOptions(
    RetivoxUser user, {
    bool includeInactive = false,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    var query = supabase
        .from('branches')
        .select('id, name, is_active')
        .eq('business_id', user.businessId)
        .isFilter('deleted_at', null);
    if (!includeInactive) query = query.eq('is_active', true);
    return _normalizeRows(await query.order('name'));
  }

  Future<void> createAdmin({
    required RetivoxUser user,
    required String name,
    required String email,
    required String phone,
    required String password,
    required List<String> branchIds,
  }) async {
    await _requireOnlineRole(user, [RetivoxRole.owner]);
    await _postAdminAction({
      'action': 'create',
      'name': name.trim(),
      'email': email.trim(),
      'phone': phone.trim(),
      'password': password,
      'branchIds': branchIds,
    });
  }

  Future<void> inviteAdmin({
    required RetivoxUser user,
    required String email,
  }) async {
    await _requireOnlineRole(user, [RetivoxRole.owner]);
    await _postAdminAction({'action': 'invite', 'email': email.trim()});
  }

  Future<void> updateAdminBranches({
    required RetivoxUser user,
    required String adminId,
    required List<String> branchIds,
  }) async {
    await _requireOnlineRole(user, [RetivoxRole.owner]);
    await _postAdminAction({
      'action': 'update_branches',
      'userId': adminId,
      'branchIds': branchIds,
    });
  }

  Future<void> setAdminActive({
    required RetivoxUser user,
    required String adminId,
    required bool isActive,
  }) async {
    await _requireOnlineRole(user, [RetivoxRole.owner]);
    await _postAdminAction({
      'action': 'set_active',
      'userId': adminId,
      'isActive': isActive,
    });
  }

  Future<Map<String, dynamic>> loadSubscription(RetivoxUser user) async {
    await _requireOnlineRole(user, [RetivoxRole.owner]);
    final api = webApiClient;
    if (api == null) {
      throw const DashboardRepositoryException(
        'The secure Retivox web API is not configured for this installation.',
      );
    }
    try {
      final response = await api.get('/api/desktop/subscriptions');
      final data = response['data'];
      if (data is! Map<String, dynamic>) {
        throw const DashboardRepositoryException(
          'The subscription service returned invalid data.',
        );
      }
      return data;
    } on WebApiException catch (error) {
      throw DashboardRepositoryException(error.message);
    }
  }

  Future<void> submitSubscriptionPayment({
    required RetivoxUser user,
    required String planKey,
    required String billingInterval,
    required String paymentMethod,
    required String referenceCode,
    String? payerPhone,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    if (!RegExp(r'^[a-z][a-z0-9_]{1,39}$').hasMatch(planKey) ||
        !['monthly', 'yearly', 'lifetime'].contains(billingInterval) ||
        ![
          'mpesa_manual',
          'bank_transfer',
          'cash_deposit',
          'other',
        ].contains(paymentMethod) ||
        referenceCode.trim().length < 3 ||
        referenceCode.trim().length > 80) {
      throw const DashboardRepositoryException(
        'Enter a valid plan, billing period, payment method, and reference.',
      );
    }
    try {
      await supabase.rpc(
        'owner_submit_subscription_payment_v2',
        params: {
          'p_plan_key': planKey,
          'p_billing_interval': billingInterval,
          'p_reference_code': referenceCode.trim(),
          'p_payment_method': paymentMethod,
          'p_payer_phone': payerPhone?.trim().isEmpty == true
              ? null
              : payerPhone?.trim(),
        },
      );
    } on PostgrestException catch (error) {
      throw DashboardRepositoryException(error.message);
    }
  }

  Future<void> initiateSubscriptionStkPush({
    required RetivoxUser user,
    required String phone,
    required String planKey,
    required String billingInterval,
  }) async {
    await _requireOnlineRole(user, [RetivoxRole.owner]);
    await _postSubscriptionAction({
      'action': 'stk',
      'phone': phone.trim(),
      'planKey': planKey,
      'billingInterval': billingInterval,
    });
  }

  Future<void> _postSubscriptionAction(Map<String, Object?> body) async {
    final api = webApiClient;
    if (api == null) {
      throw const DashboardRepositoryException(
        'The secure Retivox web API is not configured for this installation.',
      );
    }
    try {
      await api.post('/api/desktop/subscriptions', body);
    } on WebApiException catch (error) {
      throw DashboardRepositoryException(error.message);
    }
  }

  Future<void> _postAdminAction(Map<String, Object?> body) async {
    final api = webApiClient;
    if (api == null) {
      throw const DashboardRepositoryException(
        'The secure Retivox web API is not configured for this installation.',
      );
    }
    try {
      await api.post('/api/desktop/admins', body);
    } on WebApiException catch (error) {
      throw DashboardRepositoryException(error.message);
    }
  }

  Future<TransferOptionsSnapshot> loadTransferOptions(RetivoxUser user) async {
    if (user.role == RetivoxRole.employee) {
      throw const DashboardRepositoryException(
        'Transfers are only available to owners and administrators.',
      );
    }

    const cacheKey = 'dashboard:transfer-options';
    final supabase = client;
    if (supabase != null) {
      try {
        final authUser = await supabase.auth.getUser().timeout(
          const Duration(seconds: 8),
        );
        if (authUser.user?.id != user.id) {
          // Never use another account's online session for this user's options.
          // Treat it as unavailable here so the account-scoped encrypted cache
          // below can still support offline delivery entry.
          throw const SocketException('No matching online account session.');
        }
        final branches = _normalizeRows(
          await supabase
              .from('branches')
              .select('id, name, branch_type, is_active')
              .eq('business_id', user.businessId)
              .eq('is_active', true)
              .isFilter('deleted_at', null)
              .order('name'),
        );
        final managedBranchIds = user.role == RetivoxRole.owner
            ? branches
                  .map((branch) => branch['id']?.toString())
                  .whereType<String>()
                  .toList()
            : user.branches
                  .where(
                    (branch) =>
                        branch.role == 'admin' || branch.role == 'owner',
                  )
                  .map((branch) => branch.id)
                  .toList();
        final productRows = _normalizeRows(
          await supabase
              .from('products')
              .select('id, name, sku, tracks_expiry')
              .eq('business_id', user.businessId)
              .eq('is_active', true)
              .isFilter('deleted_at', null)
              .order('name')
              .range(0, 99),
        );
        final catalogIds = productRows
            .map((row) => row['id']?.toString())
            .whereType<String>()
            .toList();
        final catalogUoms = catalogIds.isEmpty
            ? <Map<String, dynamic>>[]
            : _normalizeRows(
                await supabase
                    .from('product_uom_links')
                    .select(
                      'product_id, is_purchase_uom, is_default_purchase_uom, units_of_measure!inner(id, name, abbreviation, conversion_factor, is_base_unit)',
                    )
                    .eq('business_id', user.businessId)
                    .inFilter('product_id', catalogIds)
                    .eq('is_purchase_uom', true)
                    .order('is_default_purchase_uom', ascending: false),
              );
        final catalogUomsByProduct = _groupRows(catalogUoms, 'product_id');
        final products = productRows.map((product) {
          final id = product['id']?.toString() ?? '';
          final units = (catalogUomsByProduct[id] ?? const [])
              .map((link) {
                final unit = _nested(link['units_of_measure']);
                if (unit == null) return null;
                return <String, dynamic>{
                  'id': unit['id'],
                  'name': unit['name'],
                  'abbreviation': unit['abbreviation'],
                  'conversion_factor': unit['conversion_factor'],
                  'is_base_unit': unit['is_base_unit'],
                  'is_purchase_uom': true,
                  'is_default_purchase_uom': link['is_default_purchase_uom'],
                };
              })
              .whereType<Map<String, dynamic>>()
              .toList();
          return {...product, 'uom_options': units};
        }).toList();
        var stockRows = <Map<String, dynamic>>[];
        if (managedBranchIds.isNotEmpty) {
          final rawStockRows = _normalizeRows(
            await supabase
                .from('branch_stock')
                .select(
                  'id, branch_id, product_id, quantity_on_hand, quantity_reserved, base_quantity_on_hand, base_quantity_reserved, products!inner(id, name, sku)',
                )
                .eq('business_id', user.businessId)
                .inFilter('branch_id', managedBranchIds)
                .order('branch_id')
                .range(0, 999),
          );
          final productIds = rawStockRows
              .map((row) => row['product_id']?.toString())
              .whereType<String>()
              .toSet()
              .toList();
          final uomRows = productIds.isEmpty
              ? <Map<String, dynamic>>[]
              : _normalizeRows(
                  await supabase
                      .from('product_uom_links')
                      .select(
                        'product_id, is_base_uom, is_purchase_uom, is_default_purchase_uom, units_of_measure!inner(id, name, abbreviation, conversion_factor, is_base_unit)',
                      )
                      .eq('business_id', user.businessId)
                      .inFilter('product_id', productIds)
                      .order('is_default_purchase_uom', ascending: false),
                );
          final uomsByProduct = _groupRows(uomRows, 'product_id');
          final branchNames = {
            for (final branch in branches)
              branch['id'].toString(): branch['name']?.toString() ?? 'Branch',
          };
          stockRows = rawStockRows.map((row) {
            final id = row['product_id']?.toString() ?? '';
            return {
              ...row,
              'branch_name':
                  branchNames[row['branch_id']?.toString()] ?? 'Branch',
              'uom_options': (uomsByProduct[id] ?? const [])
                  .map((link) {
                    final unit = _nested(link['units_of_measure']);
                    if (unit == null) return null;
                    return {
                      'id': unit['id'],
                      'name': unit['name'],
                      'abbreviation': unit['abbreviation'],
                      'conversion_factor': unit['conversion_factor'],
                      'is_base_unit': unit['is_base_unit'],
                      'is_base_uom': link['is_base_uom'],
                      'is_purchase_uom': link['is_purchase_uom'],
                      'is_default_purchase_uom':
                          link['is_default_purchase_uom'],
                    };
                  })
                  .whereType<Map<String, dynamic>>()
                  .toList(),
            };
          }).toList();
        }
        final options = {
          'branches': branches,
          'stock_rows': stockRows,
          'products': products,
        };
        await vault.cacheValue(user, cacheKey, [options]);
        return TransferOptionsSnapshot(
          branches: branches,
          stockRows: stockRows,
          products: products,
          updatedAt: await vault.cachedValueUpdatedAt(user, cacheKey),
          isCached: false,
        );
      } catch (error) {
        if (!_isNetworkError(error)) rethrow;
      }
    }

    final cached = await vault.readCachedValue<List<dynamic>>(user, cacheKey);
    if (cached == null || cached.isEmpty || cached.first is! Map) {
      throw const DashboardRepositoryException(
        'No branch stock is cached for transfer options. Connect to the internet to load it first.',
      );
    }
    final options = Map<String, dynamic>.from(cached.first as Map);
    return TransferOptionsSnapshot(
      branches: _normalizeRows(options['branches']),
      stockRows: _normalizeRows(options['stock_rows']),
      products: options['products'] == null
          ? const []
          : _normalizeRows(options['products']),
      updatedAt: await vault.cachedValueUpdatedAt(user, cacheKey),
      isCached: true,
    );
  }

  Future<void> initiateTransfer(
    RetivoxUser user, {
    required String fromBranchId,
    required String toBranchId,
    required List<Map<String, Object?>> items,
    String notes = '',
  }) async {
    final supabase = await _requireOnlineRole(user, [
      RetivoxRole.owner,
      RetivoxRole.admin,
    ]);
    if (fromBranchId == toBranchId || items.isEmpty) {
      throw const DashboardRepositoryException(
        'Choose different source and destination branches and add at least one product.',
      );
    }
    final response = await supabase.rpc(
      'dashboard_initiate_stock_transfer',
      params: {
        'p_from_branch_id': fromBranchId,
        'p_to_branch_id': toBranchId,
        'p_items': items,
        'p_notes': notes.trim(),
      },
    );
    if (response == null) {
      throw const DashboardRepositoryException(
        'The server did not confirm the transfer.',
      );
    }
  }

  Future<void> approveTransfer(RetivoxUser user, String transferId) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    await supabase.rpc(
      'dashboard_approve_stock_transfer',
      params: {'p_transfer_id': transferId},
    );
  }

  Future<void> receiveTransfer(RetivoxUser user, String transferId) async {
    final supabase = await _requireOnlineRole(user, [
      RetivoxRole.owner,
      RetivoxRole.admin,
    ]);
    await supabase.rpc(
      'dashboard_mark_stock_transfer_received',
      params: {'p_transfer_id': transferId},
    );
  }

  Future<bool> recordSupplierDelivery(
    RetivoxUser user, {
    required String branchId,
    required String supplierId,
    required String supplierName,
    required String referenceCode,
    required List<Map<String, Object?>> items,
    String? supplierPhone,
    String? supplierEmail,
    String? supplierContactPerson,
    String? supplierNotes,
    int? priceRating,
    int? stockQualityRating,
    int? availabilityRating,
    String ratingNote = '',
  }) async {
    if (!const [RetivoxRole.owner, RetivoxRole.admin].contains(user.role)) {
      throw const DashboardRepositoryException(
        'Only owners and administrators can record supplier deliveries.',
      );
    }
    if (items.isEmpty || supplierName.trim().isEmpty) {
      throw const DashboardRepositoryException(
        'Select a supplier and add at least one product.',
      );
    }
    if (priceRating != null && (priceRating < 1 || priceRating > 5) ||
        stockQualityRating != null &&
            (stockQualityRating < 1 || stockQualityRating > 5) ||
        availabilityRating != null &&
            (availabilityRating < 1 || availabilityRating > 5)) {
      throw const DashboardRepositoryException('Ratings must be from 1 to 5.');
    }
    return _enqueueDashboardAction(user, 'record_supplier_delivery', {
      'branch_id': branchId,
      'supplier_id': supplierId.trim().isEmpty ? null : supplierId,
      'supplier_name': supplierName.trim(),
      'supplier_phone': supplierPhone,
      'supplier_email': supplierEmail,
      'supplier_contact_person': supplierContactPerson,
      'supplier_notes': supplierNotes,
      'reference_code': referenceCode.trim(),
      'items': items,
      'price_rating': priceRating,
      'stock_quality_rating': stockQualityRating,
      'availability_rating': availabilityRating,
      'rating_note': ratingNote.trim(),
    });
  }

  Future<bool> approveSupplierDelivery(
    RetivoxUser user,
    String deliveryId,
  ) async {
    if (user.role != RetivoxRole.owner) {
      throw const DashboardRepositoryException(
        'Only an owner can approve supplier deliveries.',
      );
    }
    return _enqueueDashboardAction(user, 'approve_supplier_delivery', {
      'delivery_id': deliveryId,
    });
  }

  Future<bool> acknowledgeSupplierDelivery(
    RetivoxUser user,
    String deliveryId,
  ) async {
    if (!const [RetivoxRole.owner, RetivoxRole.admin].contains(user.role)) {
      throw const DashboardRepositoryException(
        'Only owners and administrators can acknowledge deliveries.',
      );
    }
    return _enqueueDashboardAction(user, 'acknowledge_supplier_delivery', {
      'delivery_id': deliveryId,
    });
  }

  Future<bool> editSupplierDelivery(
    RetivoxUser user, {
    required String deliveryId,
    required String supplierName,
    required String referenceCode,
    required String reason,
    required List<Map<String, Object?>> items,
  }) async {
    if (!const [RetivoxRole.owner, RetivoxRole.admin].contains(user.role)) {
      throw const DashboardRepositoryException(
        'Only owners and administrators can edit supplier deliveries.',
      );
    }
    if (supplierName.trim().isEmpty || items.isEmpty) {
      throw const DashboardRepositoryException(
        'Supplier name and at least one delivery item are required.',
      );
    }
    return _enqueueDashboardAction(user, 'edit_supplier_delivery', {
      'delivery_id': deliveryId,
      'supplier_name': supplierName.trim(),
      'reference_code': referenceCode.trim(),
      'items': items,
      'reason': reason.trim(),
    });
  }

  Future<bool> reviewSupplierDeliveryEdit(
    RetivoxUser user, {
    required String requestId,
    required bool approve,
  }) async {
    if (user.role != RetivoxRole.owner) {
      throw const DashboardRepositoryException(
        'Only an owner can review delivery edit requests.',
      );
    }
    return _enqueueDashboardAction(user, 'review_supplier_delivery_edit', {
      'request_id': requestId,
      'approve': approve,
    });
  }

  Future<ProductOptionsSnapshot> loadProductOptions(
    RetivoxUser user, {
    String? productId,
  }) async {
    if (user.role != RetivoxRole.owner) {
      throw const DashboardRepositoryException(
        'Only owners can manage the product catalog.',
      );
    }
    final supabase = client;
    if (supabase != null && await isBackendReachable()) {
      try {
        final authUser = await supabase.auth.getUser();
        if (authUser.user?.id == user.id) {
          final results = await Future.wait([
            supabase
                .from('units_of_measure')
                .select(
                  'id, name, abbreviation, conversion_factor, is_base_unit',
                )
                .eq('business_id', user.businessId)
                .eq('is_active', true)
                .order('conversion_factor')
                .order('name'),
            supabase
                .from('branches')
                .select('id, name')
                .eq('business_id', user.businessId)
                .eq('is_active', true)
                .isFilter('deleted_at', null)
                .order('name'),
          ]);
          final units = _normalizeRows(results[0]);
          final branches = _normalizeRows(results[1]);
          await vault.cacheValue(user, 'dashboard:product-options', [
            {'units': units, 'branches': branches},
          ]);
          Map<String, dynamic>? product;
          if (productId != null) {
            final response = await supabase
                .from('products')
                .select(
                  'id, name, sku, category, subcategory, brand_family, product_kind, unit, description, is_active, product_pricing(base_price, min_price, max_price), product_uom_links(id, uom_id, is_purchase_uom, is_sale_uom, is_base_uom, is_default_purchase_uom, is_default_sale_uom), product_pricing_models(id, branch_id, pricing_method, rounding_rule, status, product_price_points(uom_id, quantity_in_uom, base_quantity, price, max_discount_amount))',
                )
                .eq('business_id', user.businessId)
                .eq('id', productId)
                .isFilter('deleted_at', null)
                .maybeSingle();
            if (response == null) {
              throw const DashboardRepositoryException(
                'The product is no longer available for editing.',
              );
            }
            product = Map<String, dynamic>.from(response);
          }
          return ProductOptionsSnapshot(
            units: units,
            branches: branches,
            product: product,
          );
        }
      } catch (error) {
        if (!_isNetworkError(error)) rethrow;
      }
    }
    final cached = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:product-options',
    );
    if (cached == null || cached.isEmpty || cached.first is! Map) {
      throw const DashboardRepositoryException(
        'No product setup data is cached for this account. Connect once to load active units and branches before editing products offline.',
      );
    }
    final options = Map<String, dynamic>.from(cached.first as Map);
    final productRows = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:products',
    );
    final product = productId == null
        ? null
        : productRows
              ?.whereType<Map>()
              .map(Map<String, dynamic>.from)
              .where((row) => row['id']?.toString() == productId)
              .firstOrNull;
    if (productId != null && product == null) {
      throw const DashboardRepositoryException(
        'This product is not in the offline cache yet. Connect once to load it before editing offline.',
      );
    }
    return ProductOptionsSnapshot(
      units: _normalizeRows(options['units'] ?? const []),
      branches: _normalizeRows(options['branches'] ?? const []),
      product: product,
    );
  }

  Future<String> createUnitOfMeasure(
    RetivoxUser user, {
    required String name,
    required String abbreviation,
    required double conversionFactor,
    bool isBaseUnit = false,
  }) async {
    if (user.role != RetivoxRole.owner) {
      throw const DashboardRepositoryException(
        'Only owners can create units of measure.',
      );
    }
    final normalizedName = name.trim();
    final normalizedAbbreviation = abbreviation.trim();
    if (normalizedName.length < 2 ||
        normalizedName.length > 120 ||
        normalizedAbbreviation.isEmpty ||
        normalizedAbbreviation.length > 32 ||
        !conversionFactor.isFinite ||
        conversionFactor <= 0 ||
        conversionFactor >= 1000000 ||
        (conversionFactor * 10000).roundToDouble() !=
            conversionFactor * 10000 ||
        (isBaseUnit && conversionFactor != 1)) {
      throw const DashboardRepositoryException(
        'Enter a unit name, abbreviation, and positive conversion factor.',
      );
    }

    if (!_isSyncingDashboardAction && !await isBackendReachable()) {
      final localId = 'local-uom:${const Uuid().v4()}';
      await _enqueueDashboardAction(user, 'create_uom', {
        'local_id': localId,
        'name': normalizedName,
        'abbreviation': normalizedAbbreviation,
        'conversion_factor': conversionFactor,
        'is_base_unit': isBaseUnit,
      });
      return localId;
    }

    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    final created = await supabase
        .from('units_of_measure')
        .insert({
          'business_id': user.businessId,
          'name': normalizedName,
          'abbreviation': normalizedAbbreviation,
          'conversion_factor': conversionFactor,
          'is_base_unit': isBaseUnit,
          'is_active': true,
          'created_by': user.id,
        })
        .select('id, name, abbreviation, conversion_factor, is_base_unit')
        .single();
    return created['id'].toString();
  }

  Future<String> createProduct(
    RetivoxUser user, {
    required String name,
    required String sku,
    required String category,
    required String description,
    required String productKind,
    required String subcategory,
    required String brandFamily,
    required String baseUnitId,
    required List<String> purchaseUnitIds,
    required List<String> saleUnitIds,
    required String defaultPurchaseUnitId,
    required String defaultSaleUnitId,
    required Map<String, double> salePrices,
    required List<ProductPricePointInput> pricePoints,
    required List<String> pricingBranchIds,
    required String pricingMethod,
    required String roundingRule,
    required double basePrice,
    required double minPrice,
    required double maxPrice,
    bool tracksExpiry = false,
    List<String> barcodes = const [],
  }) async {
    if (user.role != RetivoxRole.owner) {
      throw const DashboardRepositoryException(
        'Only owners can create products.',
      );
    }
    _validateProductFields(
      name: name,
      sku: sku,
      category: category,
      description: description,
      subcategory: subcategory,
      brandFamily: brandFamily,
      productKind: productKind,
      basePrice: basePrice,
      minPrice: minPrice,
      maxPrice: maxPrice,
    );
    if (!_isSyncingDashboardAction && !await isBackendReachable()) {
      await _validateCachedProductSelections(
        user,
        baseUnitId: baseUnitId,
        purchaseUnitIds: purchaseUnitIds,
        saleUnitIds: saleUnitIds,
        defaultPurchaseUnitId: defaultPurchaseUnitId,
        defaultSaleUnitId: defaultSaleUnitId,
        salePrices: salePrices,
        pricePoints: pricePoints,
        pricingBranchIds: pricingBranchIds,
        pricingMethod: pricingMethod,
        roundingRule: roundingRule,
      );
      final localId = 'local-product:${const Uuid().v4()}';
      await _enqueueDashboardAction(user, 'create_product', {
        'local_product_id': localId,
        'name': name.trim(),
        'sku': sku.trim(),
        'category': category.trim(),
        'description': description.trim(),
        'product_kind': productKind,
        'subcategory': subcategory.trim(),
        'brand_family': brandFamily.trim(),
        'tracks_expiry': tracksExpiry,
        'barcodes': barcodes,
        'base_unit_id': baseUnitId,
        'purchase_unit_ids': purchaseUnitIds,
        'sale_unit_ids': saleUnitIds,
        'default_purchase_unit_id': defaultPurchaseUnitId,
        'default_sale_unit_id': defaultSaleUnitId,
        'sale_prices': salePrices,
        'price_points': pricePoints
            .map(
              (point) => {
                'uom_id': point.uomId,
                'quantity': point.quantity,
                'price': point.price,
                'max_discount_amount': point.maxDiscountAmount,
              },
            )
            .toList(),
        'pricing_branch_ids': pricingBranchIds,
        'pricing_method': pricingMethod,
        'rounding_rule': roundingRule,
        'base_price': basePrice,
        'min_price': minPrice,
        'max_price': maxPrice,
      });
      return 'pending:$localId';
    }
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    _validateProductFields(
      name: name,
      sku: sku,
      category: category,
      description: description,
      subcategory: subcategory,
      brandFamily: brandFamily,
      productKind: productKind,
      basePrice: basePrice,
      minPrice: minPrice,
      maxPrice: maxPrice,
    );
    if (purchaseUnitIds.isEmpty ||
        saleUnitIds.isEmpty ||
        purchaseUnitIds.toSet().length != purchaseUnitIds.length ||
        saleUnitIds.toSet().length != saleUnitIds.length) {
      throw const DashboardRepositoryException(
        'Choose unique units, including at least one purchase unit and one sale unit.',
      );
    }
    if (!purchaseUnitIds.contains(defaultPurchaseUnitId) ||
        !saleUnitIds.contains(defaultSaleUnitId)) {
      throw const DashboardRepositoryException(
        'Default units must be included in their selected unit lists.',
      );
    }
    const pricingMethods = {'fixed_price', 'assisted_pack', 'manual_quantity'};
    const roundingRules = {'none', 'nearest_5', 'up_5', 'down_5', 'nearest_10'};
    if (!pricingMethods.contains(pricingMethod) ||
        !roundingRules.contains(roundingRule)) {
      throw const DashboardRepositoryException(
        'Select a supported pricing method and rounding rule.',
      );
    }
    if (pricingBranchIds.toSet().length != pricingBranchIds.length) {
      throw const DashboardRepositoryException(
        'Remove duplicate branch selections from pricing scope.',
      );
    }
    final selectedUnitIds = {
      baseUnitId,
      ...purchaseUnitIds,
      ...saleUnitIds,
      defaultPurchaseUnitId,
      defaultSaleUnitId,
    }.toList();
    final selectedUnits = _normalizeRows(
      await supabase
          .from('units_of_measure')
          .select('id, name, abbreviation, conversion_factor')
          .eq('business_id', user.businessId)
          .eq('is_active', true)
          .inFilter('id', selectedUnitIds),
    );
    if (selectedUnits.length != selectedUnitIds.length) {
      throw const DashboardRepositoryException(
        'One or more selected units are not active in this business.',
      );
    }
    final unitsById = {
      for (final selected in selectedUnits) selected['id'].toString(): selected,
    };
    final unitFactorById = {
      for (final selected in selectedUnits)
        selected['id'].toString(): _number(selected['conversion_factor']),
    };
    if (unitFactorById[baseUnitId] != 1) {
      throw const DashboardRepositoryException(
        'The selected product base unit must equal one business base unit.',
      );
    }
    final saleUomPricePoints = <Map<String, dynamic>>[];
    for (final uomId in saleUnitIds) {
      final price = uomId == defaultSaleUnitId ? basePrice : salePrices[uomId];
      final factor = unitFactorById[uomId];
      if (price == null || !price.isFinite || price <= 0) {
        throw const DashboardRepositoryException(
          'Enter a positive price for each sale unit.',
        );
      }
      if (factor == null || !factor.isFinite || factor <= 0) {
        throw const DashboardRepositoryException(
          'One or more sale units have an invalid conversion factor.',
        );
      }
      saleUomPricePoints.add({
        'uom_id': uomId,
        'quantity_in_uom': 1,
        'base_quantity': factor,
        'price': price,
        'max_discount_amount': 0,
        'source': 'manual',
      });
    }
    for (final point in pricePoints) {
      if (!saleUnitIds.contains(point.uomId) ||
          !point.quantity.isFinite ||
          point.quantity <= 0 ||
          point.quantity * 10000 != (point.quantity * 10000).roundToDouble() ||
          !point.price.isFinite ||
          point.price < 0 ||
          !point.maxDiscountAmount.isFinite ||
          point.maxDiscountAmount < 0) {
        throw const DashboardRepositoryException(
          'Price points must use an active sale unit with positive quantity, a nonnegative price, and a nonnegative discount.',
        );
      }
      final factor = unitFactorById[point.uomId];
      if (factor == null || !factor.isFinite || factor <= 0) {
        throw const DashboardRepositoryException(
          'A price point unit has an invalid conversion factor.',
        );
      }
      saleUomPricePoints.add({
        'uom_id': point.uomId,
        'quantity_in_uom': point.quantity,
        'base_quantity': double.parse(
          (point.quantity * factor).toStringAsFixed(4),
        ),
        'price': point.price,
        'max_discount_amount': point.maxDiscountAmount,
        'source': 'manual',
      });
    }
    final pricePointsByUomQuantity = <String, Map<String, dynamic>>{};
    for (final point in saleUomPricePoints) {
      final key = '${point['uom_id']}:${point['base_quantity']}';
      pricePointsByUomQuantity[key] = point;
    }
    final mergedSaleUomPricePoints = pricePointsByUomQuantity.values.toList();

    if (pricingBranchIds.isNotEmpty) {
      final branchRows = _normalizeRows(
        await supabase
            .from('branches')
            .select('id')
            .eq('business_id', user.businessId)
            .eq('is_active', true)
            .isFilter('deleted_at', null)
            .inFilter('id', pricingBranchIds),
      );
      if (branchRows.length != pricingBranchIds.length) {
        throw const DashboardRepositoryException(
          'One or more selected pricing branches are unavailable.',
        );
      }
    }
    await supabase
        .from('products')
        .select('id, product_kind, subcategory, brand_family')
        .eq('business_id', user.businessId)
        .limit(1);
    await supabase
        .from('product_uom_links')
        .select('id')
        .eq('business_id', user.businessId)
        .limit(1);
    await supabase
        .from('product_pricing_models')
        .select('id')
        .eq('business_id', user.businessId)
        .limit(1);

    final createdId = await supabase.rpc(
      'owner_create_product',
      params: {
        'p_name': name.trim(),
        'p_sku': sku.trim(),
        'p_category': category.trim(),
        'p_unit':
            unitsById[baseUnitId]?['abbreviation']?.toString() ??
            unitsById[baseUnitId]?['name']?.toString(),
        'p_description': description.trim().isEmpty ? null : description.trim(),
        'p_base_price': basePrice,
        'p_min_price': minPrice,
        'p_max_price': maxPrice,
      },
    );
    if (createdId is! String || createdId.isEmpty) {
      throw const DashboardRepositoryException(
        'The server did not confirm product creation.',
      );
    }

    final classified = await supabase
        .from('products')
        .update({
          'product_kind': productKind,
          'tracks_expiry': tracksExpiry,
          'subcategory': subcategory.trim().isEmpty ? null : subcategory.trim(),
          'brand_family': brandFamily.trim().isEmpty
              ? null
              : brandFamily.trim(),
        })
        .eq('business_id', user.businessId)
        .eq('id', createdId)
        .select('id')
        .maybeSingle();
    if (classified == null) {
      throw const DashboardRepositoryException(
        'The product was created, but product classification could not be saved.',
      );
    }
    await _saveProductBarcodes(supabase, user, createdId, barcodes);

    await supabase
        .from('product_uom_links')
        .insert(
          selectedUnitIds.map((uomId) {
            return {
              'product_id': createdId,
              'uom_id': uomId,
              'business_id': user.businessId,
              'is_purchase_uom': purchaseUnitIds.contains(uomId),
              'is_sale_uom': saleUnitIds.contains(uomId),
              'is_base_uom': uomId == baseUnitId,
              'is_default_purchase_uom': uomId == defaultPurchaseUnitId,
              'is_default_sale_uom': uomId == defaultSaleUnitId,
            };
          }).toList(),
        );

    final effectivePricingMethod =
        pricingMethod == 'fixed_price' && saleUnitIds.length > 1
        ? 'assisted_pack'
        : pricingMethod;
    final effectiveRoundingRule =
        pricingMethod == 'fixed_price' && saleUnitIds.length > 1
        ? 'none'
        : roundingRule;
    final pricingScopes = pricingBranchIds.isEmpty
        ? <String?>[null]
        : pricingBranchIds.cast<String?>();
    final pricingModels = await supabase
        .from('product_pricing_models')
        .insert(
          pricingScopes
              .map(
                (branchId) => {
                  'business_id': user.businessId,
                  'product_id': createdId,
                  'branch_id': branchId,
                  'pricing_method': effectivePricingMethod,
                  'rounding_rule': effectiveRoundingRule,
                  'calculation_strategy': 'nearest_lower_pack_rate',
                  'status': 'approved',
                  'created_by': user.id,
                  'approved_by': user.id,
                  'approved_at': DateTime.now().toUtc().toIso8601String(),
                },
              )
              .toList(),
        )
        .select('id, branch_id');
    if (effectivePricingMethod != 'fixed_price' ||
        mergedSaleUomPricePoints.length > 1) {
      await supabase
          .from('product_price_points')
          .insert(
            pricingModels.expand((model) {
              return mergedSaleUomPricePoints.map(
                (point) => {
                  ...point,
                  'source': effectivePricingMethod == 'assisted_pack'
                      ? 'assisted_anchor'
                      : 'manual',
                  'business_id': user.businessId,
                  'pricing_model_id': model['id'],
                  'product_id': createdId,
                  'branch_id': model['branch_id'],
                },
              );
            }).toList(),
          );
    }
    return createdId;
  }

  Future<String> updateProduct(
    RetivoxUser user, {
    required String productId,
    required String name,
    required String sku,
    required String category,
    required String unit,
    required String description,
    required String productKind,
    required String subcategory,
    required String brandFamily,
    required double basePrice,
    required double minPrice,
    required double maxPrice,
    required String baseUnitId,
    required List<String> purchaseUnitIds,
    required List<String> saleUnitIds,
    required String defaultPurchaseUnitId,
    required String defaultSaleUnitId,
    required Map<String, double> salePrices,
    required List<ProductPricePointInput> pricePoints,
    required List<String> pricingBranchIds,
    required String pricingMethod,
    required String roundingRule,
    bool tracksExpiry = false,
    List<String> barcodes = const [],
  }) async {
    if (user.role != RetivoxRole.owner) {
      throw const DashboardRepositoryException(
        'Only owners can edit products.',
      );
    }
    _validateProductFields(
      name: name,
      sku: sku,
      category: category,
      description: description,
      subcategory: subcategory,
      brandFamily: brandFamily,
      productKind: productKind,
      basePrice: basePrice,
      minPrice: minPrice,
      maxPrice: maxPrice,
    );
    if (!_isSyncingDashboardAction && !await isBackendReachable()) {
      await _validateCachedProductSelections(
        user,
        baseUnitId: baseUnitId,
        purchaseUnitIds: purchaseUnitIds,
        saleUnitIds: saleUnitIds,
        defaultPurchaseUnitId: defaultPurchaseUnitId,
        defaultSaleUnitId: defaultSaleUnitId,
        salePrices: salePrices,
        pricePoints: pricePoints,
        pricingBranchIds: pricingBranchIds,
        pricingMethod: pricingMethod,
        roundingRule: roundingRule,
      );
      await _enqueueDashboardAction(user, 'update_product', {
        'product_id': productId,
        'name': name.trim(),
        'sku': sku.trim(),
        'category': category.trim(),
        'unit': unit,
        'description': description.trim(),
        'product_kind': productKind,
        'subcategory': subcategory.trim(),
        'brand_family': brandFamily.trim(),
        'tracks_expiry': tracksExpiry,
        'barcodes': barcodes,
        'base_unit_id': baseUnitId,
        'purchase_unit_ids': purchaseUnitIds,
        'sale_unit_ids': saleUnitIds,
        'default_purchase_unit_id': defaultPurchaseUnitId,
        'default_sale_unit_id': defaultSaleUnitId,
        'sale_prices': salePrices,
        'price_points': pricePoints
            .map(
              (point) => {
                'uom_id': point.uomId,
                'quantity': point.quantity,
                'price': point.price,
                'max_discount_amount': point.maxDiscountAmount,
              },
            )
            .toList(),
        'pricing_branch_ids': pricingBranchIds,
        'pricing_method': pricingMethod,
        'rounding_rule': roundingRule,
        'base_price': basePrice,
        'min_price': minPrice,
        'max_price': maxPrice,
      });
      return 'pending:$productId';
    }
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    _validateProductFields(
      name: name,
      sku: sku,
      category: category,
      description: description,
      subcategory: subcategory,
      brandFamily: brandFamily,
      productKind: productKind,
      basePrice: basePrice,
      minPrice: minPrice,
      maxPrice: maxPrice,
    );
    if (purchaseUnitIds.isEmpty ||
        saleUnitIds.isEmpty ||
        purchaseUnitIds.toSet().length != purchaseUnitIds.length ||
        saleUnitIds.toSet().length != saleUnitIds.length ||
        !purchaseUnitIds.contains(defaultPurchaseUnitId) ||
        !saleUnitIds.contains(defaultSaleUnitId) ||
        pricingBranchIds.toSet().length != pricingBranchIds.length ||
        !const [
          'fixed_price',
          'assisted_pack',
          'manual_quantity',
        ].contains(pricingMethod) ||
        !const [
          'none',
          'nearest_5',
          'up_5',
          'down_5',
          'nearest_10',
        ].contains(roundingRule)) {
      throw const DashboardRepositoryException(
        'Complete the product units and pricing settings before saving.',
      );
    }
    final selectedUnitIds = {
      baseUnitId,
      ...purchaseUnitIds,
      ...saleUnitIds,
    }.toList();
    final selectedUnits = _normalizeRows(
      await supabase
          .from('units_of_measure')
          .select('id, name, abbreviation, conversion_factor')
          .eq('business_id', user.businessId)
          .eq('is_active', true)
          .inFilter('id', selectedUnitIds),
    );
    if (selectedUnits.length != selectedUnitIds.length) {
      throw const DashboardRepositoryException(
        'One or more selected units are not active in this business.',
      );
    }
    final unitFactorById = {
      for (final selected in selectedUnits)
        selected['id'].toString(): _number(selected['conversion_factor']),
    };
    if (unitFactorById[baseUnitId] != 1) {
      throw const DashboardRepositoryException(
        'The selected product base unit must equal one business base unit.',
      );
    }
    final pointRowsByKey = <String, Map<String, dynamic>>{};
    for (final uomId in saleUnitIds) {
      final price = uomId == defaultSaleUnitId ? basePrice : salePrices[uomId];
      final factor = unitFactorById[uomId];
      if (price == null && pricePoints.any((point) => point.uomId == uomId)) {
        continue;
      }
      if (price == null ||
          !price.isFinite ||
          price <= 0 ||
          factor == null ||
          !factor.isFinite ||
          factor <= 0) {
        throw const DashboardRepositoryException(
          'Enter a positive price for each sale unit with a valid conversion factor.',
        );
      }
      final point = {
        'uom_id': uomId,
        'quantity_in_uom': 1,
        'base_quantity': factor,
        'price': price,
        'max_discount_amount': 0,
      };
      pointRowsByKey['$uomId:$factor'] = point;
    }
    for (final point in pricePoints) {
      final factor = unitFactorById[point.uomId];
      if (!saleUnitIds.contains(point.uomId) ||
          factor == null ||
          !point.quantity.isFinite ||
          point.quantity <= 0 ||
          point.quantity * 10000 != (point.quantity * 10000).roundToDouble() ||
          !point.price.isFinite ||
          point.price < 0 ||
          !point.maxDiscountAmount.isFinite ||
          point.maxDiscountAmount < 0) {
        throw const DashboardRepositoryException(
          'Each price point requires a selected sale unit, positive quantity, and nonnegative price and discount.',
        );
      }
      final baseQuantity = double.parse(
        (point.quantity * factor).toStringAsFixed(4),
      );
      pointRowsByKey['${point.uomId}:$baseQuantity'] = {
        'uom_id': point.uomId,
        'quantity_in_uom': point.quantity,
        'base_quantity': baseQuantity,
        'price': point.price,
        'max_discount_amount': point.maxDiscountAmount,
      };
    }
    if (pricingBranchIds.isNotEmpty) {
      final branches = _normalizeRows(
        await supabase
            .from('branches')
            .select('id')
            .eq('business_id', user.businessId)
            .eq('is_active', true)
            .isFilter('deleted_at', null)
            .inFilter('id', pricingBranchIds),
      );
      if (branches.length != pricingBranchIds.length) {
        throw const DashboardRepositoryException(
          'One or more selected pricing branches are unavailable.',
        );
      }
    }
    await supabase.rpc(
      'owner_update_product',
      params: {
        'p_product_id': productId,
        'p_name': name.trim(),
        'p_sku': sku.trim(),
        'p_category': category.trim(),
        'p_unit': unit.trim(),
        'p_description': description.trim().isEmpty ? null : description.trim(),
        'p_base_price': basePrice,
        'p_min_price': minPrice,
        'p_max_price': maxPrice,
      },
    );
    final classified = await supabase
        .from('products')
        .update({
          'product_kind': productKind,
          'tracks_expiry': tracksExpiry,
          'subcategory': subcategory.trim().isEmpty ? null : subcategory.trim(),
          'brand_family': brandFamily.trim().isEmpty
              ? null
              : brandFamily.trim(),
        })
        .eq('business_id', user.businessId)
        .eq('id', productId)
        .select('id')
        .maybeSingle();
    if (classified == null) {
      throw const DashboardRepositoryException(
        'The product details were updated, but classification could not be saved.',
      );
    }
    await _saveProductBarcodes(supabase, user, productId, barcodes);

    await supabase
        .from('product_uom_links')
        .delete()
        .eq('business_id', user.businessId)
        .eq('product_id', productId);
    await supabase
        .from('product_uom_links')
        .insert(
          selectedUnitIds
              .map(
                (uomId) => {
                  'product_id': productId,
                  'uom_id': uomId,
                  'business_id': user.businessId,
                  'is_purchase_uom': purchaseUnitIds.contains(uomId),
                  'is_sale_uom': saleUnitIds.contains(uomId),
                  'is_base_uom': uomId == baseUnitId,
                  'is_default_purchase_uom': uomId == defaultPurchaseUnitId,
                  'is_default_sale_uom': uomId == defaultSaleUnitId,
                },
              )
              .toList(),
        );
    final activeModels = _normalizeRows(
      await supabase
          .from('product_pricing_models')
          .select('id')
          .eq('business_id', user.businessId)
          .eq('product_id', productId)
          .inFilter('status', ['draft', 'pending_approval', 'approved']),
    );
    final activeModelIds = activeModels
        .map((model) => model['id'].toString())
        .toList();
    if (activeModelIds.isNotEmpty) {
      await supabase
          .from('product_pricing_models')
          .update({'status': 'inactive'})
          .eq('business_id', user.businessId)
          .inFilter('id', activeModelIds);
    }
    final effectivePricingMethod =
        pricingMethod == 'fixed_price' && saleUnitIds.length > 1
        ? 'assisted_pack'
        : pricingMethod;
    final effectiveRoundingRule =
        pricingMethod == 'fixed_price' && saleUnitIds.length > 1
        ? 'none'
        : roundingRule;
    final pricingScopes = pricingBranchIds.isEmpty
        ? <String?>[null]
        : pricingBranchIds.cast<String?>();
    final pricingModels = await supabase
        .from('product_pricing_models')
        .insert(
          pricingScopes
              .map(
                (branchId) => {
                  'business_id': user.businessId,
                  'product_id': productId,
                  'branch_id': branchId,
                  'pricing_method': effectivePricingMethod,
                  'rounding_rule': effectiveRoundingRule,
                  'calculation_strategy': 'nearest_lower_pack_rate',
                  'status': 'approved',
                  'created_by': user.id,
                  'approved_by': user.id,
                  'approved_at': DateTime.now().toUtc().toIso8601String(),
                },
              )
              .toList(),
        )
        .select('id, branch_id');
    if (effectivePricingMethod != 'fixed_price') {
      await supabase
          .from('product_price_points')
          .insert(
            pricingModels.expand((model) {
              return pointRowsByKey.values.map(
                (point) => {
                  ...point,
                  'business_id': user.businessId,
                  'pricing_model_id': model['id'],
                  'product_id': productId,
                  'branch_id': model['branch_id'],
                  'source': effectivePricingMethod == 'assisted_pack'
                      ? 'assisted_anchor'
                      : 'manual',
                },
              );
            }).toList(),
          );
    }
    return productId;
  }

  Future<void> _saveProductBarcodes(
    SupabaseClient supabase,
    RetivoxUser user,
    String productId,
    List<String> requestedCodes,
  ) async {
    final uniqueCodes = <String, String>{};
    for (final value in requestedCodes) {
      final code = value.trim();
      if (code.isNotEmpty) {
        uniqueCodes.putIfAbsent(normalizeBarcode(code), () => code);
      }
    }
    final codes = uniqueCodes.values.toList();
    if (codes.length > 25 || codes.any((code) => code.length > 128)) {
      throw const DashboardRepositoryException(
        'Add up to 25 barcode values, each no longer than 128 characters.',
      );
    }
    for (var index = 0; index < codes.length; index++) {
      final code = codes[index];
      if (codes
          .take(index)
          .any(
            (previous) =>
                barcodeConfusableKey(previous) == barcodeConfusableKey(code),
          )) {
        throw DashboardRepositoryException(
          'Barcode $code is too similar to another barcode in this product. Check the scanned values.',
        );
      }
    }

    final rows = _normalizeRows(
      await supabase
          .from('product_barcodes')
          .select('id, code, product_id, is_active')
          .eq('business_id', user.businessId),
    );
    final existing = <String, Map<String, dynamic>>{
      for (final row in rows) normalizeBarcode(row['code'].toString()): row,
    };
    for (final code in codes) {
      final exact = existing[normalizeBarcode(code)];
      final ownerId = exact?['product_id']?.toString();
      if (exact != null && ownerId != productId) {
        throw DashboardRepositoryException(
          'Barcode $code is already assigned to another product.',
        );
      }
      final similar = rows.where((row) {
        return row['product_id']?.toString() != productId &&
            row['is_active'] == true &&
            normalizeBarcode(row['code'].toString()) !=
                normalizeBarcode(code) &&
            barcodeConfusableKey(row['code'].toString()) ==
                barcodeConfusableKey(code);
      }).firstOrNull;
      if (similar != null) {
        throw DashboardRepositoryException(
          'Barcode $code is too similar to ${similar['code']} on another product. Check the scanned value.',
        );
      }
    }

    final requested = codes.map(normalizeBarcode).toSet();
    final reactivateIds = rows
        .where(
          (row) =>
              row['product_id']?.toString() == productId &&
              row['is_active'] != true &&
              requested.contains(normalizeBarcode(row['code'].toString())),
        )
        .map((row) => row['id']?.toString())
        .whereType<String>()
        .toList();
    if (reactivateIds.isNotEmpty) {
      await supabase
          .from('product_barcodes')
          .update({'is_active': true})
          .eq('business_id', user.businessId)
          .inFilter('id', reactivateIds);
    }

    final inserts = codes
        .where((code) => !existing.containsKey(normalizeBarcode(code)))
        .map(
          (code) => {
            'business_id': user.businessId,
            'product_id': productId,
            'code': code,
            'source': 'manufacturer',
          },
        )
        .toList();
    if (inserts.isNotEmpty) {
      await supabase.from('product_barcodes').insert(inserts);
    }

    final deactivateIds = rows
        .where(
          (row) =>
              row['product_id']?.toString() == productId &&
              row['is_active'] == true &&
              !requested.contains(normalizeBarcode(row['code'].toString())),
        )
        .map((row) => row['id']?.toString())
        .whereType<String>()
        .toList();
    if (deactivateIds.isNotEmpty) {
      await supabase
          .from('product_barcodes')
          .update({'is_active': false})
          .eq('business_id', user.businessId)
          .inFilter('id', deactivateIds);
    }
  }

  void _validateProductFields({
    required String name,
    required String sku,
    required String category,
    required String description,
    required String subcategory,
    required String brandFamily,
    required String productKind,
    required double basePrice,
    required double minPrice,
    required double maxPrice,
  }) {
    if (name.trim().length < 2 ||
        name.trim().length > 100 ||
        !RegExp(r'^[a-zA-Z0-9._-]{1,64}$').hasMatch(sku.trim()) ||
        category.trim().length < 2 ||
        description.length > 500 ||
        subcategory.length > 120 ||
        brandFamily.length > 120 ||
        !const ['fixed_package', 'measured_counted'].contains(productKind)) {
      throw const DashboardRepositoryException(
        'Enter a product name, SKU, category, and valid product type.',
      );
    }
    if (!basePrice.isFinite ||
        !minPrice.isFinite ||
        !maxPrice.isFinite ||
        minPrice <= 0 ||
        basePrice <= minPrice ||
        maxPrice <= basePrice) {
      throw const DashboardRepositoryException(
        'Pricing must satisfy minimum < base price < maximum.',
      );
    }
  }

  Future<void> _validateCachedProductSelections(
    RetivoxUser user, {
    required String baseUnitId,
    required List<String> purchaseUnitIds,
    required List<String> saleUnitIds,
    required String defaultPurchaseUnitId,
    required String defaultSaleUnitId,
    required Map<String, double> salePrices,
    required List<ProductPricePointInput> pricePoints,
    required List<String> pricingBranchIds,
    required String pricingMethod,
    required String roundingRule,
  }) async {
    if (purchaseUnitIds.isEmpty ||
        saleUnitIds.isEmpty ||
        purchaseUnitIds.toSet().length != purchaseUnitIds.length ||
        saleUnitIds.toSet().length != saleUnitIds.length ||
        !purchaseUnitIds.contains(defaultPurchaseUnitId) ||
        !saleUnitIds.contains(defaultSaleUnitId) ||
        !const [
          'fixed_price',
          'assisted_pack',
          'manual_quantity',
        ].contains(pricingMethod) ||
        !const [
          'none',
          'nearest_5',
          'up_5',
          'down_5',
          'nearest_10',
        ].contains(roundingRule)) {
      throw const DashboardRepositoryException(
        'Choose a base unit, purchase units, sale units, and valid defaults before saving offline.',
      );
    }
    final cached = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:product-options',
    );
    final options = cached
        ?.whereType<Map>()
        .map(Map<String, dynamic>.from)
        .firstOrNull;
    final units = (options?['units'] as List? ?? const [])
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .toList();
    final ids = <String>{baseUnitId, ...purchaseUnitIds, ...saleUnitIds};
    final byId = {for (final unit in units) unit['id'].toString(): unit};
    if (ids.any((id) => !byId.containsKey(id))) {
      throw const DashboardRepositoryException(
        'One or more product units are missing from the offline cache. Connect once to refresh unit data.',
      );
    }
    if (_number(byId[baseUnitId]?['conversion_factor']) != 1) {
      throw const DashboardRepositoryException(
        'The product base unit must have a conversion factor of 1.',
      );
    }
    for (final id in saleUnitIds) {
      final price = id == defaultSaleUnitId ? null : salePrices[id];
      if (id != defaultSaleUnitId &&
          (price == null || !price.isFinite || price <= 0)) {
        throw const DashboardRepositoryException(
          'Enter a positive price for each sale unit before saving offline.',
        );
      }
    }
    if (pricePoints.any(
      (point) =>
          !saleUnitIds.contains(point.uomId) ||
          !point.quantity.isFinite ||
          point.quantity <= 0 ||
          !point.price.isFinite ||
          point.price < 0 ||
          !point.maxDiscountAmount.isFinite ||
          point.maxDiscountAmount < 0,
    )) {
      throw const DashboardRepositoryException(
        'Complete each quantity price using a selected sale unit.',
      );
    }
    final branches = (options?['branches'] as List? ?? const [])
        .whereType<Map>()
        .map((branch) => branch['id']?.toString())
        .whereType<String>()
        .toSet();
    if (pricingBranchIds.any((id) => !branches.contains(id))) {
      throw const DashboardRepositoryException(
        'One or more pricing branches are missing from the offline cache.',
      );
    }
  }

  Future<void> verifyPayment(
    RetivoxUser user, {
    required String paymentId,
    required String action,
    String? evidenceSource,
    String? evidenceNote,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    if (!const ['approve', 'reject'].contains(action)) {
      throw const DashboardRepositoryException('Invalid payment action.');
    }
    await supabase.rpc(
      'owner_verify_payment_v2',
      params: {
        'p_payment_id': paymentId,
        'p_action': action,
        'p_evidence_source': evidenceSource,
        'p_evidence_note': evidenceNote,
      },
    );
  }

  Future<void> voidTransaction(RetivoxUser user, String transactionId) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    await supabase.rpc(
      'owner_void_transaction',
      params: {'p_transaction_id': transactionId},
    );
  }

  Future<void> recordFinanceExpense(
    RetivoxUser user, {
    String? branchId,
    required String category,
    required String description,
    required double amount,
    required DateTime incurredOn,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    final normalizedCategory = category.trim();
    final normalizedDescription = description.trim();
    if (normalizedCategory.isEmpty ||
        normalizedCategory.length > 80 ||
        normalizedDescription.isEmpty ||
        normalizedDescription.length > 180 ||
        !amount.isFinite ||
        amount <= 0) {
      throw const DashboardRepositoryException(
        'Enter a category, description, and a valid positive amount.',
      );
    }
    await supabase.rpc(
      'record_owner_finance_expense',
      params: {
        'p_branch_id': branchId == null || branchId.isEmpty ? null : branchId,
        'p_category': normalizedCategory,
        'p_description': normalizedDescription,
        'p_amount': amount,
        'p_incurred_on':
            '${incurredOn.year.toString().padLeft(4, '0')}-'
            '${incurredOn.month.toString().padLeft(2, '0')}-'
            '${incurredOn.day.toString().padLeft(2, '0')}',
      },
    );
  }

  Future<bool> saveSupplier(
    RetivoxUser user, {
    String? supplierId,
    required String name,
    required String phone,
    required String email,
    required String contactPerson,
    required String notes,
    required bool isActive,
  }) async {
    if (!const [RetivoxRole.owner, RetivoxRole.admin].contains(user.role)) {
      throw const DashboardRepositoryException(
        'Only owners and administrators can manage suppliers.',
      );
    }
    final normalizedName = name.trim();
    if (normalizedName.isEmpty || normalizedName.length > 120) {
      throw const DashboardRepositoryException(
        'Supplier name is required and must be 120 characters or fewer.',
      );
    }
    if (phone.trim().length > 40 ||
        contactPerson.trim().length > 120 ||
        notes.trim().length > 240) {
      throw const DashboardRepositoryException(
        'Supplier contact details exceed the allowed length.',
      );
    }
    final normalizedEmail = email.trim();
    if (normalizedEmail.isNotEmpty &&
        !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(normalizedEmail)) {
      throw const DashboardRepositoryException(
        'Enter a valid supplier email address.',
      );
    }
    const uuid = Uuid();
    return _enqueueDashboardAction(user, 'save_supplier', {
      'supplier_id': supplierId ?? uuid.v4(),
      'name': normalizedName,
      'phone': phone.trim(),
      'email': normalizedEmail,
      'contact_person': contactPerson.trim(),
      'notes': notes.trim(),
      'is_active': isActive,
      'is_new': supplierId == null,
    });
  }

  Future<void> updateBusinessProfile(
    RetivoxUser user, {
    required String name,
    required String country,
    required String currency,
    required String timezone,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    final normalizedName = name.trim();
    final normalizedCountry = country.trim().toUpperCase();
    final normalizedCurrency = currency.trim().toUpperCase();
    final normalizedTimezone = timezone.trim();
    if (normalizedName.isEmpty ||
        normalizedName.length > 120 ||
        !RegExp(r'^[A-Z]{2}$').hasMatch(normalizedCountry) ||
        !RegExp(r'^[A-Z]{3}$').hasMatch(normalizedCurrency) ||
        normalizedTimezone.isEmpty ||
        normalizedTimezone.length > 80) {
      throw const DashboardRepositoryException(
        'Enter a business name, two-letter country code, three-letter currency code, and time zone.',
      );
    }
    final current = await supabase
        .from('businesses')
        .select('id, name, country, currency, timezone')
        .eq('id', user.businessId)
        .maybeSingle();
    if (current == null) {
      throw const DashboardRepositoryException('Business profile not found.');
    }
    await supabase
        .from('businesses')
        .update({
          'name': normalizedName,
          'country': normalizedCountry,
          'currency': normalizedCurrency,
          'timezone': normalizedTimezone,
        })
        .eq('id', user.businessId);
    await supabase.from('audit_logs').insert({
      'business_id': user.businessId,
      'actor_id': user.id,
      'entity_type': 'business',
      'entity_id': user.businessId,
      'action': 'updated',
      'old_value': {
        'name': current['name'],
        'country': current['country'],
        'currency': current['currency'],
        'timezone': current['timezone'],
      },
      'new_value': {
        'name': normalizedName,
        'country': normalizedCountry,
        'currency': normalizedCurrency,
        'timezone': normalizedTimezone,
      },
    });
  }

  Future<void> updatePersonalProfile(
    RetivoxUser user, {
    required String name,
    required String phone,
  }) async {
    final supabase = await _requireOnlineRole(user, RetivoxRole.values);
    final normalizedName = name.trim();
    final normalizedPhone = phone.trim();
    if (normalizedName.isEmpty || normalizedName.length > 120) {
      throw const DashboardRepositoryException(
        'Enter a name between 1 and 120 characters.',
      );
    }
    if (normalizedPhone.length > 40) {
      throw const DashboardRepositoryException(
        'Phone number must be 40 characters or fewer.',
      );
    }
    final current = await supabase
        .from('users')
        .select('name, phone')
        .eq('business_id', user.businessId)
        .eq('id', user.id)
        .maybeSingle();
    if (current == null) {
      throw const DashboardRepositoryException('Account profile not found.');
    }
    await supabase
        .from('users')
        .update({
          'name': normalizedName,
          'phone': normalizedPhone.isEmpty ? null : normalizedPhone,
        })
        .eq('business_id', user.businessId)
        .eq('id', user.id);
    await supabase.from('audit_logs').insert({
      'business_id': user.businessId,
      'actor_id': user.id,
      'entity_type': 'user',
      'entity_id': user.id,
      'action': 'updated_personal_profile',
      'old_value': {'name': current['name'], 'phone': current['phone']},
      'new_value': {
        'name': normalizedName,
        'phone': normalizedPhone.isEmpty ? null : normalizedPhone,
      },
    });
    await vault.updateCachedProfile(user.copyWith(name: normalizedName));
  }

  Future<void> changePassword(
    RetivoxUser user, {
    required String currentPassword,
    required String newPassword,
    required String confirmation,
  }) async {
    final supabase = await _requireOnlineRole(user, RetivoxRole.values);
    final passwordPattern = RegExp(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$');
    if (currentPassword.isEmpty ||
        !passwordPattern.hasMatch(newPassword) ||
        newPassword != confirmation) {
      throw const DashboardRepositoryException(
        'Use at least 8 characters with uppercase, lowercase, and a number; both new passwords must match.',
      );
    }
    final result = await supabase.auth.signInWithPassword(
      email: user.email,
      password: currentPassword,
    );
    if (result.user?.id != user.id) {
      throw const DashboardRepositoryException(
        'Current password is incorrect.',
      );
    }
    await supabase.auth.updateUser(UserAttributes(password: newPassword));
    await supabase.from('audit_logs').insert({
      'business_id': user.businessId,
      'actor_id': user.id,
      'entity_type': 'user',
      'entity_id': user.id,
      'action': 'updated_password',
      'old_value': {'password_changed': false},
      'new_value': {'password_changed': true},
    });
  }

  Future<bool> createBranch(
    RetivoxUser user, {
    required String name,
    required String location,
    required String branchType,
  }) async {
    final normalizedName = name.trim();
    final normalizedLocation = location.trim();
    if (normalizedName.length < 2 ||
        normalizedName.length > 100 ||
        normalizedLocation.length < 3 ||
        !const ['store', 'warehouse'].contains(branchType)) {
      throw const DashboardRepositoryException(
        'Enter a branch name, location, and valid branch type.',
      );
    }
    const uuid = Uuid();
    final branch = <String, dynamic>{
      'id': uuid.v4(),
      'business_id': user.businessId,
      'name': normalizedName,
      'location': normalizedLocation,
      'branch_type': branchType,
      'is_active': true,
    };
    try {
      final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
      await _createBranchOnline(supabase, user, branch);
      await _upsertCachedBranch(user, branch);
      return false;
    } catch (error) {
      if (!_isNetworkError(error)) rethrow;
      await _queueBranchCreate(user, branch);
      return true;
    }
  }

  Future<void> _createBranchOnline(
    SupabaseClient supabase,
    RetivoxUser user,
    Map<String, dynamic> branch,
  ) async {
    final existing = await supabase
        .from('branches')
        .select('id')
        .eq('business_id', user.businessId)
        .eq('id', branch['id'])
        .maybeSingle();
    if (existing == null) {
      await supabase.from('branches').insert(branch);
      await supabase.from('audit_logs').insert({
        'business_id': user.businessId,
        'actor_id': user.id,
        'entity_type': 'branch',
        'entity_id': branch['id'],
        'action': 'created',
        'old_value': null,
        'new_value': {
          'name': branch['name'],
          'location': branch['location'],
          'branch_type': branch['branch_type'],
        },
      });
    }
  }

  Future<void> _queueBranchCreate(
    RetivoxUser user,
    Map<String, dynamic> branch,
  ) async {
    final queue = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:pending_branch_creates',
    );
    await vault.cacheValue(user, 'dashboard:pending_branch_creates', [
      ...?queue,
      branch,
    ]);
    await _upsertCachedBranch(user, {...branch, 'is_pending_sync': true});
    await vault.cacheValue(user, 'dashboard:branch:${branch['id']}', {
      ...branch,
      'team': <Map<String, dynamic>>[],
      'bestSellingItem': null,
      'worstSellingItem': null,
      'bestEmployee': null,
      'employeeCount': 0,
      'totalProfit': 0,
      'totalSales': 0,
      'transactions': 0,
      'updatedAt': DateTime.now().toIso8601String(),
      'isCached': true,
      'isPendingSync': true,
    });
  }

  Future<void> _upsertCachedBranch(
    RetivoxUser user,
    Map<String, dynamic> branch,
  ) async {
    final cached = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:branches',
    );
    final rows = cached?.whereType<Map<String, dynamic>>().toList() ?? [];
    final id = branch['id']?.toString();
    final index = rows.indexWhere((row) => row['id']?.toString() == id);
    if (index < 0) {
      rows.add(branch);
    } else {
      rows[index] = {...rows[index], ...branch};
    }
    await vault.cacheValue(user, 'dashboard:branches', rows);
  }

  Future<void> syncPendingBranchCreates(RetivoxUser user) async {
    final pending = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:pending_branch_creates',
    );
    if (pending == null || pending.isEmpty) return;
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    final remaining = <Map<String, dynamic>>[];
    for (final value in pending) {
      if (value is! Map<String, dynamic>) continue;
      final branch = Map<String, dynamic>.from(value);
      try {
        await _createBranchOnline(supabase, user, branch);
        final synced = {...branch, 'is_pending_sync': false};
        await _upsertCachedBranch(user, synced);
        final details = await vault.readCachedValue<Map<String, dynamic>>(
          user,
          'dashboard:branch:${branch['id']}',
        );
        if (details != null) {
          await vault.cacheValue(user, 'dashboard:branch:${branch['id']}', {
            ...details,
            'isPendingSync': false,
            'isCached': true,
          });
        }
      } catch (error) {
        if (_isNetworkError(error)) {
          remaining.add(branch);
          continue;
        }
        rethrow;
      }
    }
    await vault.cacheValue(user, 'dashboard:pending_branch_creates', remaining);
  }

  Future<Map<String, dynamic>> loadBranchDetails(
    RetivoxUser user,
    String branchId,
  ) async {
    final cacheKey = 'dashboard:branch:$branchId';
    final saved = await vault.readCachedValue<Map<String, dynamic>>(
      user,
      cacheKey,
    );
    if (saved?['isPendingSync'] == true) {
      return {...saved!, 'isCached': true};
    }
    try {
      final supabase = await _requireOnlineRole(user, RetivoxRole.values);
      final result = await supabase.rpc(
        'desktop_branch_details',
        params: {'p_business_id': user.businessId, 'p_branch_id': branchId},
      );
      if (result is! Map<String, dynamic>) {
        throw const DashboardRepositoryException(
          'The store details response was invalid.',
        );
      }
      final details = {...result, 'isCached': false};
      await vault.cacheValue(user, cacheKey, details);
      return details;
    } catch (error) {
      if (!_isNetworkError(error)) rethrow;
      final cached =
          saved ??
          await vault.readCachedValue<Map<String, dynamic>>(user, cacheKey);
      if (cached == null) {
        throw const DashboardRepositoryException(
          'No saved details are available for this store yet. Connect to the internet to load them first.',
        );
      }
      return {...cached, 'isCached': true};
    }
  }

  Future<void> setBranchActive(
    RetivoxUser user, {
    required String branchId,
    required bool isActive,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    final branch = await supabase
        .from('branches')
        .select('id, name, is_active, deleted_at')
        .eq('business_id', user.businessId)
        .eq('id', branchId)
        .maybeSingle();
    if (branch == null || branch['deleted_at'] != null) {
      throw const DashboardRepositoryException('Branch not found.');
    }
    if (branch['is_active'] == isActive) {
      throw DashboardRepositoryException(
        '${branch['name']} is already ${isActive ? 'active' : 'inactive'}.',
      );
    }
    final updated = await supabase
        .from('branches')
        .update({'is_active': isActive})
        .eq('business_id', user.businessId)
        .eq('id', branchId)
        .select('id')
        .maybeSingle();
    if (updated == null) {
      throw const DashboardRepositoryException(
        'The branch status was not updated.',
      );
    }
    await supabase.from('audit_logs').insert({
      'business_id': user.businessId,
      'actor_id': user.id,
      'entity_type': 'branch',
      'entity_id': branchId,
      'action': isActive ? 'activated' : 'deactivated',
      'old_value': {'is_active': branch['is_active']},
      'new_value': {'is_active': isActive},
    });
  }

  Future<void> deleteBranch(
    RetivoxUser user, {
    required String branchId,
    required String confirmationName,
    String? reason,
  }) async {
    await _requireOnlineRole(user, [RetivoxRole.owner]);
    final api = webApiClient;
    if (api == null) {
      throw const DashboardRepositoryException(
        'The secure Retivox web API is not configured for this installation.',
      );
    }
    try {
      await api.post('/api/desktop/branches', {
        'action': 'delete',
        'branchId': branchId,
        'confirmationName': confirmationName.trim(),
        'reason': reason?.trim(),
      });
    } on WebApiException catch (error) {
      throw DashboardRepositoryException(error.message);
    }
  }

  Future<bool> adjustStock(
    RetivoxUser user, {
    required String stockId,
    required int quantity,
    required String operation,
  }) async {
    if (!const [RetivoxRole.owner, RetivoxRole.admin].contains(user.role)) {
      throw const DashboardRepositoryException(
        'Only owners and administrators can adjust stock.',
      );
    }
    if (quantity <= 0 || !const ['add', 'remove'].contains(operation)) {
      throw const DashboardRepositoryException(
        'Enter a positive quantity and choose add or remove.',
      );
    }
    return _enqueueDashboardAction(user, 'adjust_stock', {
      'stock_id': stockId,
      'quantity': quantity,
      'operation': operation,
    });
  }

  Future<bool> setProductActive(
    RetivoxUser user, {
    required String productId,
    required bool isActive,
  }) async {
    if (user.role != RetivoxRole.owner) {
      throw const DashboardRepositoryException(
        'Only owners can change product availability.',
      );
    }
    if (!await isBackendReachable()) {
      return _enqueueDashboardAction(user, 'set_product_active', {
        'product_id': productId,
        'is_active': isActive,
      });
    }
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    await supabase.rpc(
      'owner_toggle_product_status',
      params: {'p_product_id': productId, 'p_is_active': isActive},
    );
    return false;
  }

  Future<bool> updateStockThreshold(
    RetivoxUser user, {
    required String stockId,
    required String branchId,
    required int threshold,
  }) async {
    if (!const [RetivoxRole.owner, RetivoxRole.admin].contains(user.role)) {
      throw const DashboardRepositoryException(
        'Only owners and administrators can update stock thresholds.',
      );
    }
    if (threshold < 0) {
      throw const DashboardRepositoryException(
        'Low-stock threshold cannot be negative.',
      );
    }
    return _enqueueDashboardAction(user, 'update_stock_threshold', {
      'stock_id': stockId,
      'branch_id': branchId,
      'threshold': threshold,
    });
  }

  Future<void> recordCashDeposit(
    RetivoxUser user, {
    required String branchId,
    required DateTime depositDate,
    required double amount,
    required String reference,
    String note = '',
  }) async {
    if (!const [
      RetivoxRole.owner,
      RetivoxRole.admin,
      RetivoxRole.employee,
    ].contains(user.role)) {
      throw const DashboardRepositoryException(
        'Your account cannot record cash deposits.',
      );
    }
    final normalizedReference = reference.trim();
    if (!amount.isFinite ||
        amount <= 0 ||
        normalizedReference.length < 3 ||
        normalizedReference.length > 80 ||
        note.trim().length > 180) {
      throw const DashboardRepositoryException(
        'Enter a positive amount, a 3–80 character deposit reference, and a note no longer than 180 characters.',
      );
    }
    await _enqueueDashboardAction(user, 'record_cash_deposit', {
      'branch_id': branchId,
      'deposit_date':
          '${depositDate.year.toString().padLeft(4, '0')}-'
          '${depositDate.month.toString().padLeft(2, '0')}-'
          '${depositDate.day.toString().padLeft(2, '0')}',
      'amount': amount,
      'deposit_reference': normalizedReference,
      'note': note.trim(),
    });
  }

  Future<void> reviewCashDeposit(
    RetivoxUser user, {
    required String depositId,
    required String action,
    String reviewNote = '',
  }) async {
    if (!const [RetivoxRole.owner, RetivoxRole.admin].contains(user.role)) {
      throw const DashboardRepositoryException(
        'Only owners and administrators can review cash deposits.',
      );
    }
    if (!const ['approve', 'reject'].contains(action) ||
        reviewNote.trim().length > 180) {
      throw const DashboardRepositoryException(
        'Choose an action and enter a review note of up to 180 characters.',
      );
    }
    await _enqueueDashboardAction(user, 'review_cash_deposit', {
      'deposit_id': depositId,
      'action': action,
      'review_note': reviewNote.trim(),
    });
  }

  Future<List<Map<String, dynamic>>> loadCashDeposits(RetivoxUser user) async {
    final snapshot = await loadSection(user, 'cash_deposits');
    return snapshot.rows;
  }

  Future<List<Map<String, dynamic>>> loadNotifications(RetivoxUser user) async {
    final cacheKey = 'dashboard:notifications';
    final supabase = client;
    if (supabase != null) {
      try {
        final authUser = await supabase.auth.getUser().timeout(
          const Duration(seconds: 6),
        );
        if (authUser.user?.id == user.id) {
          final rows = _normalizeRows(
            await supabase
                .from('notifications')
                .select('id, type, title, body, metadata, is_read, created_at')
                .eq('recipient_id', user.id)
                .order('created_at', ascending: false)
                .range(0, 49),
          );
          await vault.cacheValue(user, cacheKey, rows);
          return rows;
        }
      } catch (error) {
        if (!_isNetworkError(error)) rethrow;
      }
    }
    final cached = await vault.readCachedValue<List<dynamic>>(user, cacheKey);
    return cached?.whereType<Map>().map(Map<String, dynamic>.from).toList() ??
        const [];
  }

  Future<void> saveRecurringExpenseTemplate(
    RetivoxUser user, {
    String? templateId,
    String? branchId,
    required String category,
    required String description,
    required double amount,
    required int dueDay,
    required bool isActive,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    if (category.trim().isEmpty ||
        category.trim().length > 80 ||
        description.trim().isEmpty ||
        description.trim().length > 180 ||
        !amount.isFinite ||
        amount <= 0 ||
        dueDay < 1 ||
        dueDay > 31) {
      throw const DashboardRepositoryException(
        'Enter a valid category, description, amount, and due day (1–31).',
      );
    }
    await supabase.rpc(
      'upsert_recurring_finance_expense_template',
      params: {
        'p_template_id': templateId,
        'p_branch_id': branchId,
        'p_category': category.trim(),
        'p_description': description.trim(),
        'p_default_amount': amount,
        'p_due_day': dueDay,
        'p_is_active': isActive,
      },
    );
  }

  Future<void> confirmRecurringExpense(
    RetivoxUser user, {
    required String instanceId,
    required double amount,
    required DateTime incurredOn,
    String description = '',
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    if (!amount.isFinite || amount <= 0 || description.trim().length > 180) {
      throw const DashboardRepositoryException(
        'Enter a valid positive amount and description.',
      );
    }
    await supabase.rpc(
      'confirm_recurring_finance_expense_instance',
      params: {
        'p_instance_id': instanceId,
        'p_amount': amount,
        'p_incurred_on':
            '${incurredOn.year.toString().padLeft(4, '0')}-'
            '${incurredOn.month.toString().padLeft(2, '0')}-'
            '${incurredOn.day.toString().padLeft(2, '0')}',
        'p_description': description.trim().isEmpty ? null : description.trim(),
      },
    );
  }

  Future<void> skipRecurringExpense(RetivoxUser user, String instanceId) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    await supabase.rpc(
      'skip_recurring_finance_expense_instance',
      params: {'p_instance_id': instanceId},
    );
  }

  Future<DamageReportOptionsSnapshot> loadDamageReportOptions(
    RetivoxUser user,
  ) async {
    final supabase = await _requireOnlineRole(user, [
      RetivoxRole.owner,
      RetivoxRole.admin,
      RetivoxRole.employee,
    ]);
    final List<Map<String, dynamic>> rows;
    if (user.role == RetivoxRole.owner) {
      final options = await loadTransferOptions(user);
      final branchesById = {
        for (final branch in options.branches)
          branch['id']?.toString(): branch['name']?.toString() ?? 'Branch',
      };
      rows = options.stockRows.map((row) {
        final product = _nested(row['products']);
        return {
          'branch_id': row['branch_id'],
          'branch_name': branchesById[row['branch_id']?.toString()] ?? 'Branch',
          'product_id': row['product_id'],
          'name': product?['name'] ?? 'Product',
          'sku': product?['sku'],
          'base_quantity_available':
              _number(row['base_quantity_on_hand']) -
              _number(row['base_quantity_reserved']),
          'uom_options': (row['uom_options'] as List? ?? const [])
              .whereType<Map<String, dynamic>>()
              .where(
                (uom) =>
                    uom['is_base_uom'] == true || uom['is_base_unit'] == true,
              )
              .map(
                (uom) => {
                  'id': uom['id'],
                  'name': uom['name'],
                  'abbreviation': uom['abbreviation'],
                  'conversionFactor': uom['conversion_factor'],
                },
              )
              .toList(),
        };
      }).toList();
    } else if (user.role == RetivoxRole.admin) {
      rows = _normalizeRows(
        await supabase.rpc(
          'admin_damage_report_products',
          params: {'p_branch_id': null},
        ),
      );
    } else {
      final branch = user.branches.firstOrNull;
      if (branch == null) {
        throw const DashboardRepositoryException(
          'No branch is assigned to this employee account.',
        );
      }
      rows =
          _normalizeRows(
            await supabase.rpc(
              'employee_damage_report_products',
              params: {'p_branch_id': branch.id},
            ),
          ).map((row) {
            return {...row, 'branch_id': branch.id, 'branch_name': branch.name};
          }).toList();
    }
    return DamageReportOptionsSnapshot(rows: rows);
  }

  Future<void> submitDamageReport(
    RetivoxUser user, {
    required String branchId,
    required String productId,
    required String uomId,
    required double quantity,
    required String lossType,
    required String reason,
  }) async {
    final supabase = await _requireOnlineRole(user, [
      RetivoxRole.admin,
      RetivoxRole.employee,
    ]);
    _validateLoss(quantity: quantity, lossType: lossType, reason: reason);
    if (user.role == RetivoxRole.employee) {
      await supabase.rpc(
        'employee_report_inventory_loss',
        params: {
          'p_product_id': productId,
          'p_uom_id': uomId,
          'p_quantity_in_uom': quantity,
          'p_loss_type': lossType,
          'p_reason': reason.trim(),
        },
      );
    } else {
      await supabase.rpc(
        'admin_report_inventory_loss',
        params: {
          'p_branch_id': branchId,
          'p_product_id': productId,
          'p_uom_id': uomId,
          'p_quantity_in_uom': quantity,
          'p_loss_type': lossType,
          'p_reason': reason.trim(),
        },
      );
    }
  }

  Future<void> recordInventoryLoss(
    RetivoxUser user, {
    required String branchId,
    required String productId,
    required String uomId,
    required double quantity,
    required String lossType,
    required String reason,
    double recoverySalePrice = 0,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    _validateLoss(quantity: quantity, lossType: lossType, reason: reason);
    if (!recoverySalePrice.isFinite || recoverySalePrice < 0) {
      throw const DashboardRepositoryException(
        'Recovery selling price cannot be negative.',
      );
    }
    await supabase.rpc(
      'record_inventory_loss_event',
      params: {
        'p_branch_id': branchId,
        'p_product_id': productId,
        'p_uom_id': uomId,
        'p_quantity_in_uom': quantity,
        'p_loss_type': lossType,
        'p_reason': reason.trim(),
        'p_recoverable_amount': 0,
        'p_recovery_sale_price_per_uom': recoverySalePrice > 0
            ? recoverySalePrice
            : null,
      },
    );
  }

  Future<void> reviewDamageReport(
    RetivoxUser user, {
    required String reportId,
    required bool approve,
    required String reviewNote,
    double? quantity,
    String? lossType,
    String? reason,
    double? recoverySalePrice,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    if (approve) {
      if (quantity == null || lossType == null || reason == null) {
        throw const DashboardRepositoryException(
          'Complete the report details before approving.',
        );
      }
      _validateLoss(quantity: quantity, lossType: lossType, reason: reason);
      if (recoverySalePrice != null &&
          (!recoverySalePrice.isFinite || recoverySalePrice < 0)) {
        throw const DashboardRepositoryException(
          'Recovery selling price cannot be negative.',
        );
      }
      final updateResponse = await supabase.rpc(
        'owner_update_employee_inventory_loss_report',
        params: {
          'p_report_id': reportId,
          'p_quantity_in_uom': quantity,
          'p_loss_type': lossType,
          'p_reason': reason.trim(),
          'p_recovery_sale_price_per_base_unit':
              recoverySalePrice == null || recoverySalePrice == 0
              ? null
              : recoverySalePrice,
          'p_review_note': reviewNote.trim().isEmpty ? null : reviewNote.trim(),
        },
      );
      if (updateResponse != null) {
        throw const DashboardRepositoryException(
          'The server returned an unexpected damage-report update response.',
        );
      }
      await supabase.rpc(
        'owner_approve_employee_inventory_loss_report',
        params: {
          'p_report_id': reportId,
          'p_recovery_sale_price_per_base_unit':
              recoverySalePrice == null || recoverySalePrice == 0
              ? null
              : recoverySalePrice,
          'p_review_note': reviewNote.trim().isEmpty ? null : reviewNote.trim(),
        },
      );
    } else {
      await supabase.rpc(
        'owner_reject_employee_inventory_loss_report',
        params: {
          'p_report_id': reportId,
          'p_review_note': reviewNote.trim().isEmpty ? null : reviewNote.trim(),
        },
      );
    }
  }

  void _validateLoss({
    required double quantity,
    required String lossType,
    required String reason,
  }) {
    if (!quantity.isFinite || quantity <= 0) {
      throw const DashboardRepositoryException(
        'Loss quantity must be greater than zero.',
      );
    }
    if (!const [
      'breakage',
      'spoilage',
      'theft',
      'markdown_damage',
      'other',
    ].contains(lossType)) {
      throw const DashboardRepositoryException('Choose a valid loss type.');
    }
    if (reason.trim().isEmpty || reason.trim().length > 240) {
      throw const DashboardRepositoryException(
        'Enter a loss reason of up to 240 characters.',
      );
    }
  }

  Future<SupabaseClient> _requireOnlineRole(
    RetivoxUser user,
    List<RetivoxRole> roles,
  ) async {
    if (!roles.contains(user.role)) {
      throw const DashboardRepositoryException(
        'This action is not available for your role.',
      );
    }
    final supabase = client;
    if (supabase == null) {
      throw const DashboardRepositoryException(
        'This action requires an internet connection.',
      );
    }
    final authUser = await supabase.auth.getUser().timeout(
      const Duration(seconds: 8),
    );
    if (authUser.user?.id != user.id) {
      throw const DashboardRepositoryException(
        'Sign in online with this account before continuing.',
      );
    }
    return supabase;
  }

  Future<DashboardSnapshot> loadAnalytics(
    RetivoxUser user, {
    required int rangeDays,
  }) async {
    if (user.role != RetivoxRole.owner) {
      throw const DashboardRepositoryException(
        'Analytics is only available to business owners.',
      );
    }
    if (![7, 30, 90].contains(rangeDays)) {
      throw const DashboardRepositoryException(
        'Choose an analytics range of 7, 30, or 90 days.',
      );
    }

    final cacheKey = 'dashboard:analytics:$rangeDays';
    final supabase = client;
    if (supabase != null) {
      try {
        final authUser = await supabase.auth.getUser();
        if (authUser.user?.id != user.id) {
          throw const DashboardRepositoryException(
            'Sign in online with this account to refresh analytics.',
          );
        }
        final response = await supabase.rpc(
          'owner_analytics_summary',
          params: {'p_range_days': rangeDays},
        );
        if (response is! Map) {
          throw const DashboardRepositoryException(
            'The server returned an invalid analytics response.',
          );
        }
        final summary = Map<String, dynamic>.from(response);
        await vault.cacheValue(user, cacheKey, [summary]);
        return DashboardSnapshot(
          section: 'analytics',
          rows: [summary],
          updatedAt: await vault.cachedValueUpdatedAt(user, cacheKey),
          isCached: false,
        );
      } catch (error) {
        if (!_isNetworkError(error)) rethrow;
      }
    }

    final cached = await vault.readCachedValue<List<dynamic>>(user, cacheKey);
    if (cached == null || cached.isEmpty || cached.first is! Map) {
      throw DashboardRepositoryException(
        'No $rangeDays-day analytics are cached for this account. Connect to the internet to load them first.',
      );
    }
    return DashboardSnapshot(
      section: 'analytics',
      rows: [Map<String, dynamic>.from(cached.first as Map)],
      updatedAt: await vault.cachedValueUpdatedAt(user, cacheKey),
      isCached: true,
    );
  }

  Future<DashboardSnapshot> loadFinance(
    RetivoxUser user, {
    required String period,
    String? branchId,
  }) async {
    if (user.role != RetivoxRole.owner) {
      throw const DashboardRepositoryException(
        'Finance is only available to business owners.',
      );
    }
    if (!const ['today', 'week', 'month'].contains(period)) {
      throw const DashboardRepositoryException(
        'Choose today, this week, or this month.',
      );
    }

    final normalizedBranchId = branchId?.trim() ?? '';
    final cacheKey =
        'dashboard:finance:$period:${normalizedBranchId.isEmpty ? 'all' : normalizedBranchId}';
    final supabase = client;
    if (supabase != null) {
      try {
        final authUser = await supabase.auth.getUser();
        if (authUser.user?.id != user.id) {
          throw const DashboardRepositoryException(
            'Sign in online with this account to refresh finance data.',
          );
        }
        try {
          await syncPendingDashboardActions(user);
        } catch (error) {
          if (!_isNetworkError(error)) rethrow;
        }

        final branches = _normalizeRows(
          await supabase
              .from('branches')
              .select('id, name')
              .eq('business_id', user.businessId)
              .eq('is_active', true)
              .isFilter('deleted_at', null)
              .order('name'),
        );
        final activeBranchIds = branches
            .map((branch) => branch['id']?.toString())
            .whereType<String>()
            .toList();
        if (normalizedBranchId.isNotEmpty &&
            !activeBranchIds.contains(normalizedBranchId)) {
          throw const DashboardRepositoryException(
            'The selected branch is not active or is outside this business.',
          );
        }
        final range = _financeRange(period);
        var transactionQuery = supabase
            .from('transactions')
            .select(
              'id, total_amount, discount_amount, is_credit_sale, recorded_at, branch_id, branches(name), transaction_items(product_id, line_total, line_discount_amount, net_line_total, line_cost, gross_profit, base_quantity, products(name, sku))',
            )
            .eq('business_id', user.businessId)
            .eq('status', 'verified')
            .gte('recorded_at', range.$1)
            .lte('recorded_at', range.$2);
        var lossQuery = supabase
            .from('inventory_loss_events')
            .select(
              'id, branch_id, product_id, loss_type, reason, quantity_in_uom, base_quantity, gross_cost, recoverable_amount, net_loss, created_at, branches(name), products(name, sku), units_of_measure(name)',
            )
            .eq('business_id', user.businessId)
            .gte('created_at', range.$1)
            .lte('created_at', range.$2);
        var expenseQuery = supabase
            .from('finance_expenses')
            .select(
              'id, branch_id, category, description, amount, incurred_on, branches(name)',
            )
            .eq('business_id', user.businessId)
            .gte('incurred_on', range.$3)
            .lte('incurred_on', range.$4);

        if (normalizedBranchId.isNotEmpty) {
          transactionQuery = transactionQuery.eq(
            'branch_id',
            normalizedBranchId,
          );
          lossQuery = lossQuery.eq('branch_id', normalizedBranchId);
          expenseQuery = expenseQuery.eq('branch_id', normalizedBranchId);
        } else {
          if (activeBranchIds.isEmpty) {
            return await _cacheFinance(
              user,
              cacheKey,
              branches,
              const [],
              const [],
              const [],
            );
          }
          transactionQuery = transactionQuery.inFilter(
            'branch_id',
            activeBranchIds,
          );
          lossQuery = lossQuery.inFilter('branch_id', activeBranchIds);
          expenseQuery = expenseQuery.or(
            'branch_id.in.(${activeBranchIds.join(',')}),branch_id.is.null',
          );
        }

        final transactions = _normalizeRows(
          await transactionQuery
              .order('recorded_at', ascending: false)
              .range(0, 499),
        );
        final expenses = _normalizeRows(
          await expenseQuery
              .order('incurred_on', ascending: false)
              .range(0, 199),
        );
        final losses = _normalizeRows(
          await lossQuery.order('created_at', ascending: false).range(0, 199),
        );
        final pendingReports = _normalizeRows(
          await supabase.rpc(
            'owner_pending_employee_inventory_loss_reports',
            params: {'p_limit': 50},
          ),
        );
        var depositRowsQuery = supabase
            .from('branch_cash_deposits')
            .select(
              'id, branch_id, deposit_date, amount, expected_cash_amount, variance_amount, deposit_reference, note, review_note, status, created_at, branches(name)',
            )
            .eq('business_id', user.businessId);
        var templateRowsQuery = supabase
            .from('finance_recurring_expense_templates')
            .select(
              'id, branch_id, category, description, default_amount, due_day, is_active, branches(name)',
            )
            .eq('business_id', user.businessId);
        var instanceRowsQuery = supabase
            .from('finance_recurring_expense_instances')
            .select(
              'id, template_id, branch_id, category, description, amount, due_on, status, branches(name)',
            )
            .eq('business_id', user.businessId)
            .eq('status', 'pending')
            .gte('due_on', range.$3)
            .lte('due_on', range.$4);
        if (normalizedBranchId.isNotEmpty) {
          depositRowsQuery = depositRowsQuery.eq(
            'branch_id',
            normalizedBranchId,
          );
          templateRowsQuery = templateRowsQuery.or(
            'branch_id.eq.$normalizedBranchId,branch_id.is.null',
          );
          instanceRowsQuery = instanceRowsQuery.or(
            'branch_id.eq.$normalizedBranchId,branch_id.is.null',
          );
        } else if (activeBranchIds.isNotEmpty) {
          depositRowsQuery = depositRowsQuery.inFilter(
            'branch_id',
            activeBranchIds,
          );
          final branchList = activeBranchIds.join(',');
          templateRowsQuery = templateRowsQuery.or(
            'branch_id.in.($branchList),branch_id.is.null',
          );
          instanceRowsQuery = instanceRowsQuery.or(
            'branch_id.in.($branchList),branch_id.is.null',
          );
        }
        await supabase.rpc(
          'ensure_recurring_finance_expense_instances',
          params: {'p_as_of': range.$4},
        );
        final deposits = _normalizeRows(
          await depositRowsQuery
              .order('created_at', ascending: false)
              .range(0, 99),
        );
        final recurringTemplates = _normalizeRows(
          await templateRowsQuery.order('due_day').range(0, 99),
        );
        final recurringInstances = _normalizeRows(
          await instanceRowsQuery.order('due_on').range(0, 99),
        );
        var paymentQuery = supabase
            .from('payments')
            .select(
              'payment_method,amount,status,transactions!inner(branch_id,status)',
            )
            .eq('business_id', user.businessId)
            .gte('payment_at', range.$1)
            .lte('payment_at', range.$2)
            .neq('status', 'rejected');
        if (normalizedBranchId.isNotEmpty) {
          paymentQuery = paymentQuery.eq(
            'transactions.branch_id',
            normalizedBranchId,
          );
        } else {
          paymentQuery = paymentQuery.inFilter(
            'transactions.branch_id',
            activeBranchIds,
          );
        }
        final paymentRows = _normalizeRows(await paymentQuery.range(0, 999));
        final paymentMethods = <String, double>{};
        for (final payment in paymentRows) {
          final transaction = payment['transactions'];
          if (transaction is Map &&
              ['voided', 'rejected'].contains(transaction['status']))
            continue;
          final method = payment['payment_method']?.toString() ?? 'other';
          paymentMethods[method] =
              (paymentMethods[method] ?? 0) + _number(payment['amount']);
        }
        var receivableQuery = supabase
            .from('receivable_account_balances')
            .select(
              'id,business_id,branch_id,transaction_id,due_date,customer_name,customer_phone,customer_email,branch_name,total_amount,amount_paid,balance_due,account_status',
            )
            .eq('business_id', user.businessId);
        if (normalizedBranchId.isNotEmpty) {
          receivableQuery = receivableQuery.eq('branch_id', normalizedBranchId);
        } else {
          receivableQuery = receivableQuery.inFilter(
            'branch_id',
            activeBranchIds,
          );
        }
        final receivableRows = _normalizeRows(
          await receivableQuery.order('due_date').range(0, 499),
        );
        final totalLent = receivableRows.fold<double>(
          0,
          (total, row) => total + _number(row['balance_due']),
        );
        final receivableTransactionIds = receivableRows
            .map((row) => row['transaction_id']?.toString())
            .whereType<String>()
            .toList();
        final creditItems = receivableTransactionIds.isEmpty
            ? <Map<String, dynamic>>[]
            : _normalizeRows(
                await supabase
                    .from('transaction_items')
                    .select(
                      'transaction_id,quantity_in_uom,quantity,unit_price_at_sale,line_total,products(name,sku),units_of_measure(name)',
                    )
                    .inFilter('transaction_id', receivableTransactionIds)
                    .range(0, 1999),
              );
        final creditPayments = receivableTransactionIds.isEmpty
            ? <Map<String, dynamic>>[]
            : _normalizeRows(
                await supabase
                    .from('payments')
                    .select(
                      'transaction_id,payment_method,amount,status,payment_at,reference_code,mpesa_ref_code',
                    )
                    .inFilter('transaction_id', receivableTransactionIds)
                    .order('payment_at')
                    .range(0, 1999),
              );
        final itemsByTransaction = _groupRows(creditItems, 'transaction_id');
        final paymentsByTransaction = _groupRows(
          creditPayments,
          'transaction_id',
        );
        final receivableAccounts = receivableRows.map((row) {
          final transactionId = row['transaction_id']?.toString() ?? '';
          return {
            ...row,
            'items':
                itemsByTransaction[transactionId] ??
                const <Map<String, dynamic>>[],
            'payments':
                paymentsByTransaction[transactionId] ??
                const <Map<String, dynamic>>[],
          };
        }).toList();
        return await _cacheFinance(
          user,
          cacheKey,
          branches,
          transactions,
          expenses,
          losses,
          pendingReports: pendingReports,
          deposits: deposits,
          recurringTemplates: recurringTemplates,
          recurringInstances: recurringInstances,
          paymentMethods: paymentMethods,
          totalLent: totalLent,
          receivableAccounts: receivableAccounts,
        );
      } catch (error) {
        if (!_isNetworkError(error)) rethrow;
      }
    }

    final cached = await vault.readCachedValue<List<dynamic>>(user, cacheKey);
    if (cached == null || cached.isEmpty || cached.first is! Map) {
      throw DashboardRepositoryException(
        'No $period finance data is cached for this account. Connect to the internet to load it first.',
      );
    }
    return DashboardSnapshot(
      section: 'finances',
      rows: [Map<String, dynamic>.from(cached.first as Map)],
      updatedAt: await vault.cachedValueUpdatedAt(user, cacheKey),
      isCached: true,
    );
  }

  Future<bool> recordReceivablePayment({
    required RetivoxUser user,
    required String receivableId,
    required String paymentMethod,
    required double amount,
    double? amountTendered,
    String? referenceCode,
    required double currentBalance,
    required String branchId,
  }) async {
    if (!amount.isFinite || amount <= 0) {
      throw const DashboardRepositoryException(
        'Enter a valid payment amount greater than zero.',
      );
    }
    if (amount > currentBalance + 0.009 && !await isBackendReachable()) {
      throw const DashboardRepositoryException(
        'This amount is above the last saved balance. Connect to refresh the balance before recording it.',
      );
    }
    return _enqueueDashboardAction(user, 'record_receivable_payment', {
      'receivable_id': receivableId,
      'payment_method': paymentMethod,
      'amount': amount,
      'amount_tendered': paymentMethod == 'cash'
          ? amountTendered ?? amount
          : amount,
      'reference_code': referenceCode?.trim().isEmpty == true
          ? null
          : referenceCode?.trim(),
      'branch_id': branchId,
    });
  }

  Future<DashboardSnapshot> _cacheFinance(
    RetivoxUser user,
    String cacheKey,
    List<Map<String, dynamic>> branches,
    List<Map<String, dynamic>> transactions,
    List<Map<String, dynamic>> expenses,
    List<Map<String, dynamic>> losses, {
    List<Map<String, dynamic>> pendingReports = const [],
    List<Map<String, dynamic>> deposits = const [],
    List<Map<String, dynamic>> recurringTemplates = const [],
    List<Map<String, dynamic>> recurringInstances = const [],
    Map<String, double> paymentMethods = const {},
    double totalLent = 0,
    List<Map<String, dynamic>> receivableAccounts = const [],
  }) async {
    final summary = <String, dynamic>{
      'branches': branches,
      'transactions': transactions,
      'expenses': expenses,
      'losses': losses,
      'pending_reports': pendingReports,
      'cash_deposits': deposits,
      'recurring_templates': recurringTemplates,
      'recurring_instances': recurringInstances,
      'payment_methods': paymentMethods,
      'total_lent': totalLent,
      'receivable_accounts': receivableAccounts,
    };
    await vault.cacheValue(user, cacheKey, [summary]);
    for (final action in await _pendingDashboardActions(user)) {
      if (action['type'] == 'record_receivable_payment') {
        await _cachePendingDashboardAction(user, action);
      }
      if (action['type'] == 'record_cash_deposit' ||
          action['type'] == 'review_cash_deposit') {
        await _cachePendingDashboardAction(user, action);
      }
    }
    final updated = await vault.readCachedValue<List<dynamic>>(user, cacheKey);
    final visibleSummary = updated?.isNotEmpty == true && updated!.first is Map
        ? Map<String, dynamic>.from(updated.first as Map)
        : summary;
    return DashboardSnapshot(
      section: 'finances',
      rows: [visibleSummary],
      updatedAt: await vault.cachedValueUpdatedAt(user, cacheKey),
      isCached: false,
    );
  }

  (String, String, String, String) _financeRange(String period) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final start = switch (period) {
      'week' => today.subtract(Duration(days: today.weekday - 1)),
      'month' => DateTime(today.year, today.month),
      _ => today,
    };
    final end = DateTime(start.year, start.month, start.day, 23, 59, 59, 999);
    final startDate = DateTime(start.year, start.month, start.day);
    final endDate = DateTime(end.year, end.month, end.day);
    return (
      start.toIso8601String(),
      end.toIso8601String(),
      startDate.toIso8601String().substring(0, 10),
      endDate.toIso8601String().substring(0, 10),
    );
  }

  Future<DashboardSnapshot> loadExpiryAlerts(RetivoxUser user) async {
    const cacheKey = 'dashboard:expiry-alerts';
    final branchIds = user.branches.map((branch) => branch.id).toList();
    if (branchIds.isNotEmpty && await isBackendReachable()) {
      try {
        final supabase = await _requireOnlineRole(user, [
          RetivoxRole.owner,
          RetivoxRole.admin,
        ]);
        final rows =
            _normalizeRows(
              await supabase
                  .from('product_expiry_alerts')
                  .select(
                    'branch_id, product_id, product_name, sku, lot_id, supplier_lot_code, expires_on, days_remaining, base_quantity_on_hand, alert_status',
                  )
                  .eq('business_id', user.businessId)
                  .inFilter('branch_id', branchIds)
                  .order('expires_on')
                  .range(0, 199),
            ).map((row) {
              final branch = user.branches
                  .where((item) => item.id == row['branch_id']?.toString())
                  .firstOrNull;
              return {
                ...row,
                'branch_name': branch?.name ?? 'Branch',
                'days_remaining': _number(row['days_remaining']),
                'base_quantity_on_hand': _number(row['base_quantity_on_hand']),
              };
            }).toList();
        await vault.cacheValue(user, cacheKey, rows);
        return DashboardSnapshot(
          section: 'expiry_alerts',
          rows: rows,
          updatedAt: DateTime.now(),
          isCached: false,
        );
      } catch (error) {
        if (!_isNetworkError(error)) rethrow;
      }
    }
    final cached = await vault.readCachedValue<List<dynamic>>(user, cacheKey);
    return DashboardSnapshot(
      section: 'expiry_alerts',
      rows:
          cached?.whereType<Map>().map(Map<String, dynamic>.from).toList() ??
          const [],
      updatedAt: await vault.cachedValueUpdatedAt(user, cacheKey),
      isCached: true,
    );
  }

  Future<DashboardSnapshot> loadSection(
    RetivoxUser user,
    String section,
  ) async {
    final supabase = client;
    if (supabase != null) {
      try {
        final authUser = await supabase.auth.getUser().timeout(
          const Duration(seconds: 8),
        );
        if (authUser.user?.id != user.id) {
          final saved = await vault.readCachedValue<List<dynamic>>(
            user,
            'dashboard:$section',
          );
          if (saved == null) {
            throw const DashboardRepositoryException(
              'Sign in online with this account to load dashboard data.',
            );
          }
          var savedRows = saved.whereType<Map<String, dynamic>>().toList();
          if (section == 'branches' && user.role == RetivoxRole.owner) {
            savedRows = await _mergePendingBranchCreates(user, savedRows);
          }
          savedRows = await _mergePendingDashboardActions(
            user,
            section,
            savedRows,
          );
          return DashboardSnapshot(
            section: section,
            rows: savedRows,
            updatedAt: await vault.cachedValueUpdatedAt(
              user,
              'dashboard:$section',
            ),
            isCached: true,
          );
        }
        var rows = await _fetchSection(supabase, user, section).timeout(
          const Duration(seconds: 15),
          onTimeout: () =>
              throw TimeoutException('The $section data request timed out.'),
        );
        if (section == 'branches' && user.role == RetivoxRole.owner) {
          try {
            await syncPendingBranchCreates(user);
          } catch (error) {
            if (!_isNetworkError(error)) rethrow;
          }
          rows = await _mergePendingBranchCreates(user, rows);
        }
        await vault.cacheValue(user, 'dashboard:$section', rows);
        rows = await _mergePendingDashboardActions(user, section, rows);
        return DashboardSnapshot(
          section: section,
          rows: rows,
          updatedAt: await vault.cachedValueUpdatedAt(
            user,
            'dashboard:$section',
          ),
          isCached: false,
        );
      } catch (error) {
        if (!_isNetworkError(error)) rethrow;
      }
    }

    final cached = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:$section',
    );
    if (cached == null) {
      throw DashboardRepositoryException(
        'No $section data is cached for this account. Connect to the internet to load it first.',
      );
    }
    var rows = cached.whereType<Map<String, dynamic>>().toList();
    if (section == 'branches' && user.role == RetivoxRole.owner) {
      rows = await _mergePendingBranchCreates(user, rows);
    }
    rows = await _mergePendingDashboardActions(user, section, rows);
    return DashboardSnapshot(
      section: section,
      rows: rows,
      updatedAt: await vault.cachedValueUpdatedAt(user, 'dashboard:$section'),
      isCached: true,
    );
  }

  static const _pendingDashboardActionsKey = 'dashboard:pending_actions';

  Future<List<Map<String, dynamic>>> _pendingDashboardActions(
    RetivoxUser user,
  ) async {
    final raw = await vault.readCachedValue<List<dynamic>>(
      user,
      _pendingDashboardActionsKey,
    );
    return raw
            ?.whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .toList() ??
        <Map<String, dynamic>>[];
  }

  Future<void> _storePendingDashboardActions(
    RetivoxUser user,
    List<Map<String, dynamic>> actions,
  ) => vault.cacheValue(user, _pendingDashboardActionsKey, actions);

  Future<bool> _enqueueDashboardAction(
    RetivoxUser user,
    String type,
    Map<String, dynamic> payload,
  ) async {
    final id = const Uuid().v4();
    final action = <String, dynamic>{
      'id': id,
      'type': type,
      'payload': payload,
      'queued_at': DateTime.now().toUtc().toIso8601String(),
      'status': 'pending_sync',
    };
    final actions = await _pendingDashboardActions(user);
    actions.add(action);
    await _storePendingDashboardActions(user, actions);
    await _cachePendingDashboardAction(user, action);
    if (await isBackendReachable()) {
      try {
        await syncPendingDashboardActions(user);
      } catch (error) {
        if (!_isNetworkError(error)) {
          final pending = await _pendingDashboardActions(user);
          final index = pending.indexWhere((row) => row['id'] == id);
          if (index >= 0) {
            pending[index]['error'] = error.toString();
            await _storePendingDashboardActions(user, pending);
          }
        }
      }
    }
    return (await _pendingDashboardActions(user))
        .any((pending) => pending['id'] == id);
  }

  Future<void> _cachePendingDashboardAction(
    RetivoxUser user,
    Map<String, dynamic> action,
  ) async {
    final type = action['type']?.toString();
    final payload = Map<String, dynamic>.from(action['payload'] as Map? ?? {});
    if (type == 'record_cash_deposit') {
      final saved = await vault.readCachedValue<List<dynamic>>(
        user,
        'dashboard:cash_deposits',
      );
      final rows =
          saved?.whereType<Map>().map(Map<String, dynamic>.from).toList() ??
          <Map<String, dynamic>>[];
      rows.removeWhere((row) => row['pending_action_id'] == action['id']);
      rows.insert(0, {
        'id': 'local-${action['id']}',
        'branch_id': payload['branch_id'],
        'deposit_date': payload['deposit_date'],
        'amount': payload['amount'],
        'deposit_reference': payload['deposit_reference'],
        'note': payload['note'],
        'status': 'pending_sync',
        'submitted_role': user.role.name,
        'deposited_by_name': user.name,
        'is_pending_sync': true,
        'pending_action_id': action['id'],
        'sync_error': action['error'],
      });
      await vault.cacheValue(user, 'dashboard:cash_deposits', rows);
      await _applyPendingCashDepositToFinanceCaches(user, action, payload);
    }
    if (type == 'review_cash_deposit') {
      await _applyPendingCashDepositToFinanceCaches(user, action, payload);
    }
    if (type == 'create_uom') {
      final cached = await vault.readCachedValue<List<dynamic>>(
        user,
        'dashboard:product-options',
      );
      final options =
          cached?.whereType<Map>().map(Map<String, dynamic>.from).firstOrNull ??
          <String, dynamic>{
            'units': <Map<String, dynamic>>[],
            'branches': <Map<String, dynamic>>[],
          };
      final units = (options['units'] as List? ?? const [])
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .toList();
      units.removeWhere((unit) => unit['id'] == payload['local_id']);
      units.add({
        'id': payload['local_id'],
        'name': payload['name'],
        'abbreviation': payload['abbreviation'],
        'conversion_factor': payload['conversion_factor'],
        'is_base_unit': payload['is_base_unit'] == true,
        'is_active': true,
        'is_pending_sync': true,
      });
      options['units'] = units;
      await vault.cacheValue(user, 'dashboard:product-options', [options]);
    }
    if (type == 'record_receivable_payment') {
      await _applyPendingReceivablePaymentToFinanceCaches(
        user,
        action,
        payload,
      );
    }
    if (type == 'create_product' || type == 'update_product') {
      final product = await _productRowFromAction(user, payload, action);
      final cached = await vault.readCachedValue<List<dynamic>>(
        user,
        'dashboard:products',
      );
      final rows =
          cached?.whereType<Map>().map(Map<String, dynamic>.from).toList() ??
          <Map<String, dynamic>>[];
      final id = product['id']?.toString();
      final index = rows.indexWhere((row) => row['id']?.toString() == id);
      if (index < 0) {
        rows.insert(0, product);
      } else {
        rows[index] = {...rows[index], ...product};
      }
      await vault.cacheValue(user, 'dashboard:products', rows);
    }
    if (type == 'set_product_active') {
      final cached = await vault.readCachedValue<List<dynamic>>(
        user,
        'dashboard:products',
      );
      if (cached != null) {
        final rows = cached
            .whereType<Map>()
            .map(Map<String, dynamic>.from)
            .toList();
        final index = rows.indexWhere(
          (row) => row['id']?.toString() == payload['product_id']?.toString(),
        );
        if (index >= 0)
          rows[index] = {
            ...rows[index],
            'is_active': payload['is_active'],
            'is_pending_sync': true,
            'sync_error': action['error'],
          };
        await vault.cacheValue(user, 'dashboard:products', rows);
      }
    }
    if (type == 'save_supplier') {
      final cached = await vault.readCachedValue<List<dynamic>>(
        user,
        'dashboard:suppliers',
      );
      final rows =
          cached?.whereType<Map>().map(Map<String, dynamic>.from).toList() ??
          <Map<String, dynamic>>[];
      final localId = payload['supplier_id']?.toString();
      final index = rows.indexWhere(
        (row) =>
            row['id']?.toString() == localId ||
            row['name']?.toString().toLowerCase() ==
                payload['name']?.toString().toLowerCase(),
      );
      final supplier = <String, dynamic>{
        'id': localId,
        'name': payload['name'],
        'phone': payload['phone'],
        'email': payload['email'],
        'contact_person': payload['contact_person'],
        'notes': payload['notes'],
        'is_active': payload['is_active'],
        'is_pending_sync': true,
        'pending_action_id': action['id'],
      };
      if (index < 0) {
        rows.add(supplier);
      } else {
        rows[index] = {...rows[index], ...supplier};
      }
      await vault.cacheValue(user, 'dashboard:suppliers', rows);
    }
    if (type == 'record_supplier_delivery') {
      final cached = await vault.readCachedValue<List<dynamic>>(
        user,
        'dashboard:deliveries',
      );
      final rows =
          cached?.whereType<Map>().map(Map<String, dynamic>.from).toList() ??
          <Map<String, dynamic>>[];
      if (!rows.any((row) => row['id'] == action['id'])) {
        final branch = user.branches
            .where((item) => item.id == payload['branch_id'])
            .firstOrNull;
        rows.insert(0, {
          'id': action['id'],
          'to_branch_id': payload['branch_id'],
          'branches': branch == null
              ? null
              : {'id': branch.id, 'name': branch.name},
          'supplier_id': payload['supplier_id'],
          'supplier_name': payload['supplier_name'],
          'reference_code': payload['reference_code'],
          'status': 'pending_sync',
          'recorded_at': action['queued_at'],
          'items': await _pendingDeliveryItems(user, payload),
          'edit_requests': const [],
          'is_pending_sync': true,
          'sync_error': action['error'],
        });
        await vault.cacheValue(user, 'dashboard:deliveries', rows);
      }
    }
    if (type == 'approve_supplier_delivery' ||
        type == 'acknowledge_supplier_delivery') {
      final cached = await vault.readCachedValue<List<dynamic>>(
        user,
        'dashboard:deliveries',
      );
      if (cached != null) {
        final rows = cached
            .whereType<Map>()
            .map(Map<String, dynamic>.from)
            .toList();
        final id = payload['delivery_id']?.toString();
        for (var index = 0; index < rows.length; index++) {
          if (rows[index]['id']?.toString() == id) {
            rows[index] = {
              ...rows[index],
              'status': type == 'approve_supplier_delivery'
                  ? 'approved'
                  : 'received',
              'is_pending_sync': true,
              'pending_action_id': action['id'],
            };
          }
        }
        await vault.cacheValue(user, 'dashboard:deliveries', rows);
      }
    }
    if (type == 'edit_supplier_delivery' ||
        type == 'review_supplier_delivery_edit') {
      final cached = await vault.readCachedValue<List<dynamic>>(
        user,
        'dashboard:deliveries',
      );
      if (cached != null) {
        final rows = cached
            .whereType<Map>()
            .map(Map<String, dynamic>.from)
            .toList();
        for (var index = 0; index < rows.length; index++) {
          if (type == 'edit_supplier_delivery' &&
              rows[index]['id']?.toString() ==
                  payload['delivery_id']?.toString()) {
            rows[index] = {
              ...rows[index],
              'is_pending_sync': true,
              'pending_action_id': action['id'],
            };
          }
          if (type == 'review_supplier_delivery_edit') {
            final requests = (rows[index]['edit_requests'] as List? ?? const [])
                .whereType<Map>()
                .map(Map<String, dynamic>.from)
                .toList();
            final requestIndex = requests.indexWhere(
              (request) =>
                  request['id']?.toString() ==
                  payload['request_id']?.toString(),
            );
            if (requestIndex >= 0) {
              requests[requestIndex] = {
                ...requests[requestIndex],
                'is_pending_sync': true,
                'queued_decision': payload['approve'] == true
                    ? 'approve'
                    : 'reject',
              };
              rows[index] = {...rows[index], 'edit_requests': requests};
            }
          }
        }
        await vault.cacheValue(user, 'dashboard:deliveries', rows);
      }
    }
  }

  Future<void> _applyPendingReceivablePaymentToFinanceCaches(
    RetivoxUser user,
    Map<String, dynamic> action,
    Map<String, dynamic> payload,
  ) async {
    final localId = action['id']?.toString();
    final receivableId = payload['receivable_id']?.toString();
    final amount = _number(payload['amount']);
    if (localId == null || receivableId == null || amount <= 0) return;

    final scopes = <String>{'all', ...user.branches.map((branch) => branch.id)};
    for (final period in const ['today', 'week', 'month']) {
      for (final scope in scopes) {
        final key = 'dashboard:finance:$period:$scope';
        final cached = await vault.readCachedValue<List<dynamic>>(user, key);
        if (cached == null || cached.isEmpty || cached.first is! Map) continue;
        final summary = Map<String, dynamic>.from(cached.first as Map);
        final appliedIds =
            (summary['_pending_receivable_payment_ids'] as List? ?? const [])
                .map((value) => value.toString())
                .toSet();
        if (appliedIds.contains(localId)) continue;

        final accounts = (summary['receivable_accounts'] as List? ?? const [])
            .whereType<Map>()
            .map(Map<String, dynamic>.from)
            .toList();
        final index = accounts.indexWhere(
          (account) => account['id']?.toString() == receivableId,
        );
        if (index < 0) continue;
        final account = accounts[index];
        final nextBalance = (_number(account['balance_due']) - amount)
            .clamp(0, double.infinity)
            .toDouble();
        account['balance_due'] = nextBalance;
        account['amount_paid'] = _number(account['amount_paid']) + amount;
        account['account_status'] = nextBalance <= 0
            ? 'paid'
            : _number(account['amount_paid']) > 0
            ? 'partial'
            : 'open';
        final payments = (account['payments'] as List? ?? const [])
            .whereType<Map>()
            .map(Map<String, dynamic>.from)
            .toList();
        payments.add({
          'local_id': localId,
          'payment_method': payload['payment_method'],
          'amount': amount,
          'status': 'pending_sync',
          'payment_at': action['queued_at'],
          'reference_code': payload['reference_code'],
          'sync_error': action['error'],
        });
        account['payments'] = payments;
        accounts[index] = account;
        summary['receivable_accounts'] = accounts;
        summary['total_lent'] = (_number(summary['total_lent']) - amount)
            .clamp(0, double.infinity)
            .toDouble();
        final methods = Map<String, dynamic>.from(
          summary['payment_methods'] as Map? ?? const {},
        );
        final method = payload['payment_method']?.toString() ?? 'other';
        methods[method] = _number(methods[method]) + amount;
        summary['payment_methods'] = methods;
        appliedIds.add(localId);
        summary['_pending_receivable_payment_ids'] = appliedIds.toList();
        await vault.cacheValue(user, key, [summary]);
      }
    }
  }

  Future<void> _applyPendingCashDepositToFinanceCaches(
    RetivoxUser user,
    Map<String, dynamic> action,
    Map<String, dynamic> payload,
  ) async {
    final scopes = <String>{'all', ...user.branches.map((branch) => branch.id)};
    final type = action['type']?.toString();
    for (final period in const ['today', 'week', 'month']) {
      for (final scope in scopes) {
        if (type == 'record_cash_deposit' &&
            scope != 'all' &&
            scope != payload['branch_id']?.toString())
          continue;
        final key = 'dashboard:finance:$period:$scope';
        final cached = await vault.readCachedValue<List<dynamic>>(user, key);
        if (cached == null || cached.isEmpty || cached.first is! Map) continue;
        final summary = Map<String, dynamic>.from(cached.first as Map);
        final deposits = (summary['cash_deposits'] as List? ?? const [])
            .whereType<Map>()
            .map(Map<String, dynamic>.from)
            .toList();
        if (type == 'record_cash_deposit') {
          if (!deposits.any(
            (row) => row['pending_action_id'] == action['id'],
          )) {
            final branch = user.branches
                .where((item) => item.id == payload['branch_id'])
                .firstOrNull;
            deposits.insert(0, {
              'id': 'local-${action['id']}',
              'branch_id': payload['branch_id'],
              'branches': branch == null
                  ? null
                  : {'id': branch.id, 'name': branch.name},
              'deposit_date': payload['deposit_date'],
              'amount': payload['amount'],
              'deposit_reference': payload['deposit_reference'],
              'note': payload['note'],
              'status': 'pending_sync',
              'submitted_role': user.role.name,
              'is_pending_sync': true,
              'pending_action_id': action['id'],
              'sync_error': action['error'],
            });
          }
        } else {
          final index = deposits.indexWhere(
            (row) => row['id']?.toString() == payload['deposit_id']?.toString(),
          );
          if (index >= 0)
            deposits[index] = {
              ...deposits[index],
              'is_pending_sync': true,
              'pending_action_id': action['id'],
              'sync_error': action['error'],
              'pending_action': payload['action'],
            };
        }
        summary['cash_deposits'] = deposits;
        await vault.cacheValue(user, key, [summary]);
      }
    }
  }

  Future<Map<String, dynamic>> _productRowFromAction(
    RetivoxUser user,
    Map<String, dynamic> payload,
    Map<String, dynamic> action,
  ) async {
    final optionsRaw = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:product-options',
    );
    final options = optionsRaw
        ?.whereType<Map>()
        .map(Map<String, dynamic>.from)
        .firstOrNull;
    final units = (options?['units'] as List? ?? const [])
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .toList();
    final unitById = {for (final unit in units) unit['id'].toString(): unit};
    final allUnitIds = <String>{
      payload['base_unit_id']?.toString() ?? '',
      ...(payload['purchase_unit_ids'] as List? ?? const []).map(
        (id) => id.toString(),
      ),
      ...(payload['sale_unit_ids'] as List? ?? const []).map(
        (id) => id.toString(),
      ),
    }..remove('');
    final links = allUnitIds.map((id) {
      final unit = unitById[id];
      return {
        'uom_id': id,
        'is_base_uom': id == payload['base_unit_id']?.toString(),
        'is_purchase_uom': (payload['purchase_unit_ids'] as List? ?? const [])
            .map((value) => value.toString())
            .contains(id),
        'is_sale_uom': (payload['sale_unit_ids'] as List? ?? const [])
            .map((value) => value.toString())
            .contains(id),
        'is_default_purchase_uom':
            id == payload['default_purchase_unit_id']?.toString(),
        'is_default_sale_uom':
            id == payload['default_sale_unit_id']?.toString(),
        'units_of_measure': unit == null
            ? null
            : {
                'name': unit['name'],
                'abbreviation': unit['abbreviation'],
                'conversion_factor': unit['conversion_factor'],
              },
      };
    }).toList();
    final pricePoints = (payload['price_points'] as List? ?? const [])
        .whereType<Map>()
        .map(
          (point) => {
            'uom_id': point['uom_id'],
            'quantity_in_uom': point['quantity'],
            'price': point['price'],
            'max_discount_amount': point['max_discount_amount'],
          },
        )
        .toList();
    final rawPricingMethod =
        payload['pricing_method']?.toString() ?? 'fixed_price';
    final effectivePricingMethod =
        rawPricingMethod == 'fixed_price' &&
            (payload['sale_unit_ids'] as List? ?? const []).length > 1
        ? 'assisted_pack'
        : rawPricingMethod;
    final productId =
        payload['local_product_id']?.toString() ??
        payload['product_id']?.toString();
    final existingRows = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:products',
    );
    final existing = existingRows
        ?.whereType<Map>()
        .map(Map<String, dynamic>.from)
        .where((row) => row['id']?.toString() == productId)
        .firstOrNull;
    return {
      ...?existing,
      'id': productId,
      'name': payload['name'],
      'sku': payload['sku'],
      'category': payload['category'],
      'subcategory': payload['subcategory'],
      'brand_family': payload['brand_family'],
      'product_kind': payload['product_kind'],
      'tracks_expiry': payload['tracks_expiry'] == true,
      'barcodes': _stringList(payload['barcodes']),
      'unit':
          unitById[payload['base_unit_id']?.toString()]?['abbreviation'] ??
          unitById[payload['base_unit_id']?.toString()]?['name'],
      'description': payload['description'],
      'is_active': existing?['is_active'] ?? true,
      'product_pricing': {
        'base_price': payload['base_price'],
        'min_price': payload['min_price'],
        'max_price': payload['max_price'],
      },
      'product_uom_links': links,
      'product_pricing_models': [
        for (final branchId
            in (payload['pricing_branch_ids'] as List? ?? const []).isEmpty
                ? <Object?>[null]
                : (payload['pricing_branch_ids'] as List))
          {
            'branch_id': branchId,
            'pricing_method': effectivePricingMethod,
            'rounding_rule':
                effectivePricingMethod == 'assisted_pack' &&
                    rawPricingMethod == 'fixed_price'
                ? 'none'
                : payload['rounding_rule'],
            'status': 'approved',
            'product_price_points': pricePoints,
          },
      ],
      'is_pending_sync': true,
      'pending_action_id': action['id'],
      'sync_error': action['error'],
    };
  }

  Future<List<Map<String, dynamic>>> _pendingDeliveryItems(
    RetivoxUser user,
    Map<String, dynamic> payload,
  ) async {
    final raw = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:transfer-options',
    );
    final options = raw
        ?.whereType<Map>()
        .map(Map<String, dynamic>.from)
        .firstOrNull;
    final products = options?['products'] is List
        ? (options!['products'] as List)
              .whereType<Map>()
              .map(Map<String, dynamic>.from)
              .toList()
        : <Map<String, dynamic>>[];
    final items = (payload['items'] as List? ?? const []).whereType<Map>();
    return items.map((rawItem) {
      final item = Map<String, dynamic>.from(rawItem);
      final product = products
          .where(
            (row) => row['id']?.toString() == item['productId']?.toString(),
          )
          .firstOrNull;
      final units = (product?['uom_options'] as List? ?? const [])
          .whereType<Map>();
      final unit = units
          .where((row) => row['id']?.toString() == item['uomId']?.toString())
          .firstOrNull;
      return {
        ...item,
        'quantity_in_uom': item['quantity'],
        'quantity_expected': item['quantity'],
        'base_quantity_expected':
            _number(item['quantity']) *
            (_number(unit?['conversion_factor']) > 0
                ? _number(unit?['conversion_factor'])
                : 1),
        'quantity_received': 0,
        'base_quantity_received': 0,
        'total_cost': ((item['costs'] as List? ?? const [])
            .whereType<Map>()
            .fold<double>(0, (sum, cost) => sum + _number(cost['amount']))),
        'products': product == null
            ? null
            : {
                'id': product['id'],
                'name': product['name'],
                'sku': product['sku'],
              },
        'units_of_measure': unit == null
            ? null
            : {'name': unit['name'], 'abbreviation': unit['abbreviation']},
      };
    }).toList();
  }

  Future<List<Map<String, dynamic>>> _mergePendingDashboardActions(
    RetivoxUser user,
    String section,
    List<Map<String, dynamic>> source,
  ) async {
    final actions = await _pendingDashboardActions(user);
    if (actions.isEmpty) return source;
    final rows = [...source];
    for (final action in actions) {
      final type = action['type']?.toString();
      final payload = Map<String, dynamic>.from(
        action['payload'] as Map? ?? {},
      );
      if (section == 'cash_deposits' && type == 'record_cash_deposit') {
        final index = rows.indexWhere(
          (row) => row['pending_action_id'] == action['id'],
        );
        final branch = user.branches
            .where((item) => item.id == payload['branch_id'])
            .firstOrNull;
        final pending = {
          'id': 'local-${action['id']}',
          'branch_id': payload['branch_id'],
          'branches': branch == null
              ? null
              : {'id': branch.id, 'name': branch.name},
          'deposit_date': payload['deposit_date'],
          'amount': payload['amount'],
          'deposit_reference': payload['deposit_reference'],
          'note': payload['note'],
          'status': 'pending_sync',
          'submitted_role': user.role.name,
          'deposited_by_name': user.name,
          'created_at': action['queued_at'],
          'is_pending_sync': true,
          'pending_action_id': action['id'],
          'sync_error': action['error'],
        };
        if (index < 0)
          rows.insert(0, pending);
        else
          rows[index] = {...rows[index], ...pending};
      }
      if (section == 'cash_deposits' && type == 'review_cash_deposit') {
        final index = rows.indexWhere(
          (row) => row['id']?.toString() == payload['deposit_id']?.toString(),
        );
        if (index >= 0)
          rows[index] = {
            ...rows[index],
            'is_pending_sync': true,
            'pending_action_id': action['id'],
            'sync_error': action['error'],
            'pending_action': payload['action'],
          };
      }
      if (section == 'products' &&
          (type == 'create_product' || type == 'update_product')) {
        final pending = await _productRowFromAction(user, payload, action);
        final index = rows.indexWhere(
          (row) => row['id']?.toString() == pending['id']?.toString(),
        );
        if (index < 0) {
          if (type == 'create_product') rows.insert(0, pending);
        } else {
          rows[index] = {...rows[index], ...pending};
        }
      }
      if (section == 'products' && type == 'set_product_active') {
        final index = rows.indexWhere(
          (row) => row['id']?.toString() == payload['product_id']?.toString(),
        );
        if (index >= 0) {
          rows[index] = {
            ...rows[index],
            'is_active': payload['is_active'],
            'is_pending_sync': true,
            'sync_error': action['error'],
          };
        }
      }
      if (section == 'suppliers' && type == 'save_supplier') {
        final localId = payload['supplier_id']?.toString();
        final index = rows.indexWhere(
          (row) =>
              row['id']?.toString() == localId ||
              row['name']?.toString().toLowerCase() ==
                  payload['name']?.toString().toLowerCase(),
        );
        final pending = {
          'id': localId,
          'name': payload['name'],
          'phone': payload['phone'],
          'email': payload['email'],
          'contact_person': payload['contact_person'],
          'notes': payload['notes'],
          'is_active': payload['is_active'],
          'is_pending_sync': true,
          'sync_error': action['error'],
        };
        if (index < 0) {
          rows.add(pending);
        } else {
          rows[index] = {...rows[index], ...pending};
        }
      }
      if (section == 'deliveries' &&
          type == 'record_supplier_delivery' &&
          !rows.any((row) => row['id']?.toString() == action['id'])) {
        final branch = user.branches
            .where((item) => item.id == payload['branch_id'])
            .firstOrNull;
        rows.insert(0, {
          'id': action['id'],
          'to_branch_id': payload['branch_id'],
          'branches': branch == null
              ? null
              : {'id': branch.id, 'name': branch.name},
          'supplier_id': payload['supplier_id'],
          'supplier_name': payload['supplier_name'],
          'reference_code': payload['reference_code'],
          'status': 'pending_sync',
          'recorded_at': action['queued_at'],
          'items': await _pendingDeliveryItems(user, payload),
          'edit_requests': const [],
          'is_pending_sync': true,
          'sync_error': action['error'],
        });
      }
      if (section == 'deliveries' && type == 'record_supplier_delivery') {
        final index = rows.indexWhere(
          (row) => row['id']?.toString() == action['id'],
        );
        if (index >= 0) {
          rows[index] = {
            ...rows[index],
            'is_pending_sync': true,
            'sync_error': action['error'],
          };
        }
      }
      if (section == 'deliveries' &&
          (type == 'approve_supplier_delivery' ||
              type == 'acknowledge_supplier_delivery')) {
        final deliveryId = payload['delivery_id']?.toString();
        final index = rows.indexWhere(
          (row) => row['id']?.toString() == deliveryId,
        );
        if (index >= 0 && rows[index]['pending_action_id'] != action['id']) {
          rows[index] = {
            ...rows[index],
            'status': type == 'approve_supplier_delivery'
                ? 'approved'
                : 'received',
            'is_pending_sync': true,
            'pending_action_id': action['id'],
            'sync_error': action['error'],
          };
        }
      }
      if (section == 'deliveries' && type == 'edit_supplier_delivery') {
        final deliveryId = payload['delivery_id']?.toString();
        final index = rows.indexWhere(
          (row) => row['id']?.toString() == deliveryId,
        );
        if (index >= 0) {
          rows[index] = {
            ...rows[index],
            'is_pending_sync': true,
            'sync_error': action['error'],
          };
        }
      }
      if (section == 'deliveries' && type == 'review_supplier_delivery_edit') {
        for (var index = 0; index < rows.length; index++) {
          final requests = (rows[index]['edit_requests'] as List? ?? const [])
              .whereType<Map>()
              .map(Map<String, dynamic>.from)
              .toList();
          final requestIndex = requests.indexWhere(
            (request) =>
                request['id']?.toString() == payload['request_id']?.toString(),
          );
          if (requestIndex >= 0) {
            requests[requestIndex] = {
              ...requests[requestIndex],
              'is_pending_sync': true,
              'queued_decision': payload['approve'] == true
                  ? 'approve'
                  : 'reject',
            };
            rows[index] = {...rows[index], 'edit_requests': requests};
          }
        }
      }
      if (section == 'stock' &&
          (type == 'update_stock_threshold' || type == 'adjust_stock')) {
        for (var index = 0; index < rows.length; index++) {
          if (rows[index]['id']?.toString() != payload['stock_id']?.toString())
            continue;
          final merged = {...rows[index]};
          if (type == 'update_stock_threshold') {
            merged['low_stock_threshold'] = payload['threshold'];
          } else {
            final sign = payload['operation'] == 'add' ? 1 : -1;
            final current = _number(
              merged['base_quantity_on_hand'] ?? merged['quantity_on_hand'],
            );
            merged['quantity_on_hand'] =
                current + sign * _number(payload['quantity']);
            merged['base_quantity_on_hand'] = merged['quantity_on_hand'];
          }
          merged['is_pending_sync'] = true;
          merged['pending_action_id'] = action['id'];
          merged['sync_error'] = action['error'];
          rows[index] = merged;
        }
      }
    }
    return rows;
  }

  Future<void> syncPendingDashboardActions(RetivoxUser user) async {
    var actions = await _pendingDashboardActions(user);
    if (actions.isEmpty) return;
    final supabase = await _requireOnlineRole(user, [
      RetivoxRole.owner,
      RetivoxRole.admin,
      RetivoxRole.employee,
    ]);
    for (final queued in actions.toList()) {
      final action = Map<String, dynamic>.from(queued);
      final payload = Map<String, dynamic>.from(
        action['payload'] as Map? ?? {},
      );
      _isSyncingDashboardAction = true;
      try {
        Object? response;
        switch (action['type']) {
          case 'record_cash_deposit':
            response = await supabase.rpc(
              'record_branch_cash_deposit_v2',
              params: {
                'p_branch_id': payload['branch_id'],
                'p_deposit_date': payload['deposit_date'],
                'p_amount': payload['amount'],
                'p_deposit_reference': payload['deposit_reference'],
                'p_note': (payload['note'] as String?)?.isEmpty == true
                    ? null
                    : payload['note'],
                'p_local_id': action['id'],
              },
            );
            break;
          case 'review_cash_deposit':
            await supabase.rpc(
              'review_branch_cash_deposit_v2',
              params: {
                'p_deposit_id': payload['deposit_id'],
                'p_action': payload['action'],
                'p_review_note':
                    (payload['review_note'] as String?)?.isEmpty == true
                    ? null
                    : payload['review_note'],
                'p_local_id': action['id'],
              },
            );
            break;
          case 'record_receivable_payment':
            response = await supabase.rpc(
              'record_receivable_payment_v2',
              params: {
                'p_receivable_id': payload['receivable_id'],
                'p_payment_method': payload['payment_method'],
                'p_amount': payload['amount'],
                'p_amount_tendered': payload['amount_tendered'],
                'p_reference_code': payload['reference_code'],
                'p_local_id': action['id'],
              },
            );
            break;
          case 'create_uom':
            response = await supabase
                .from('units_of_measure')
                .insert({
                  'business_id': user.businessId,
                  'name': payload['name'],
                  'abbreviation': payload['abbreviation'],
                  'conversion_factor': payload['conversion_factor'],
                  'is_base_unit': payload['is_base_unit'] == true,
                  'is_active': true,
                  'created_by': user.id,
                })
                .select(
                  'id, name, abbreviation, conversion_factor, is_base_unit',
                )
                .single();
            final createdUnitId = (response as Map)['id']?.toString();
            _replacePendingUnitId(
              actions,
              payload['local_id']?.toString(),
              createdUnitId,
            );
            await _rewriteCachedUnitId(
              user,
              payload['local_id']?.toString(),
              createdUnitId,
            );
            break;
          case 'create_product':
            response = await createProduct(
              user,
              name: payload['name'].toString(),
              sku: payload['sku'].toString(),
              category: payload['category'].toString(),
              description: payload['description']?.toString() ?? '',
              productKind: payload['product_kind'].toString(),
              subcategory: payload['subcategory']?.toString() ?? '',
              brandFamily: payload['brand_family']?.toString() ?? '',
              baseUnitId: payload['base_unit_id'].toString(),
              purchaseUnitIds: _stringList(payload['purchase_unit_ids']),
              saleUnitIds: _stringList(payload['sale_unit_ids']),
              defaultPurchaseUnitId: payload['default_purchase_unit_id']
                  .toString(),
              defaultSaleUnitId: payload['default_sale_unit_id'].toString(),
              salePrices: _doubleMap(payload['sale_prices']),
              pricePoints: _productPricePoints(payload['price_points']),
              pricingBranchIds: _stringList(payload['pricing_branch_ids']),
              pricingMethod: payload['pricing_method'].toString(),
              roundingRule: payload['rounding_rule'].toString(),
              basePrice: _number(payload['base_price']),
              minPrice: _number(payload['min_price']),
              maxPrice: _number(payload['max_price']),
              barcodes: _stringList(payload['barcodes']),
              tracksExpiry: payload['tracks_expiry'] == true,
            );
            _replacePendingProductId(
              actions,
              payload['local_product_id']?.toString(),
              response.toString(),
            );
            await _rewriteCachedProductId(
              user,
              payload['local_product_id']?.toString(),
              response.toString(),
            );
            break;
          case 'update_product':
            await updateProduct(
              user,
              productId: payload['product_id'].toString(),
              name: payload['name'].toString(),
              sku: payload['sku'].toString(),
              category: payload['category'].toString(),
              unit: payload['unit']?.toString() ?? '',
              description: payload['description']?.toString() ?? '',
              productKind: payload['product_kind'].toString(),
              subcategory: payload['subcategory']?.toString() ?? '',
              brandFamily: payload['brand_family']?.toString() ?? '',
              basePrice: _number(payload['base_price']),
              minPrice: _number(payload['min_price']),
              maxPrice: _number(payload['max_price']),
              baseUnitId: payload['base_unit_id'].toString(),
              purchaseUnitIds: _stringList(payload['purchase_unit_ids']),
              saleUnitIds: _stringList(payload['sale_unit_ids']),
              defaultPurchaseUnitId: payload['default_purchase_unit_id']
                  .toString(),
              defaultSaleUnitId: payload['default_sale_unit_id'].toString(),
              salePrices: _doubleMap(payload['sale_prices']),
              pricePoints: _productPricePoints(payload['price_points']),
              pricingBranchIds: _stringList(payload['pricing_branch_ids']),
              pricingMethod: payload['pricing_method'].toString(),
              roundingRule: payload['rounding_rule'].toString(),
              tracksExpiry: payload['tracks_expiry'] == true,
              barcodes: _stringList(payload['barcodes']),
            );
            break;
          case 'set_product_active':
            await supabase.rpc(
              'owner_toggle_product_status',
              params: {
                'p_product_id': payload['product_id'],
                'p_is_active': payload['is_active'],
              },
            );
            break;
          case 'save_supplier':
            response = await supabase.rpc(
              'upsert_business_supplier',
              params: {
                'p_supplier_id': payload['is_new'] == true
                    ? null
                    : payload['supplier_id'],
                'p_name': payload['name'],
                'p_phone': (payload['phone'] as String?)?.isEmpty == true
                    ? null
                    : payload['phone'],
                'p_email': (payload['email'] as String?)?.isEmpty == true
                    ? null
                    : payload['email'],
                'p_contact_person':
                    (payload['contact_person'] as String?)?.isEmpty == true
                    ? null
                    : payload['contact_person'],
                'p_notes': (payload['notes'] as String?)?.isEmpty == true
                    ? null
                    : payload['notes'],
                'p_is_active': payload['is_active'],
              },
            );
            _replacePendingSupplierId(
              actions,
              payload['supplier_id']?.toString(),
              response?.toString(),
            );
            break;
          case 'record_supplier_delivery':
            response = await supabase.rpc(
              'dashboard_record_supplier_delivery_idempotent_v1',
              params: {
                'p_request_id': action['id'],
                'p_branch_id': payload['branch_id'],
                'p_supplier_id': payload['supplier_id'],
                'p_supplier_phone': payload['supplier_phone'],
                'p_supplier_email': payload['supplier_email'],
                'p_supplier_contact_person': payload['supplier_contact_person'],
                'p_supplier_notes': payload['supplier_notes'],
                'p_supplier_name': payload['supplier_name'],
                'p_reference_code': payload['reference_code'],
                'p_items': payload['items'],
                'p_price_rating': payload['price_rating'],
                'p_stock_quality_rating': payload['stock_quality_rating'],
                'p_availability_rating': payload['availability_rating'],
                'p_rating_note': payload['rating_note'],
              },
            );
            _replacePendingDeliveryId(
              actions,
              action['id']?.toString(),
              response?.toString(),
            );
            break;
          case 'approve_supplier_delivery':
            await supabase.rpc(
              'dashboard_approve_supplier_delivery',
              params: {'p_delivery_id': payload['delivery_id']},
            );
            break;
          case 'acknowledge_supplier_delivery':
            await supabase.rpc(
              'dashboard_acknowledge_supplier_delivery',
              params: {'p_delivery_id': payload['delivery_id']},
            );
            break;
          case 'edit_supplier_delivery':
            await supabase.rpc(
              'dashboard_request_supplier_delivery_edit',
              params: {
                'p_delivery_id': payload['delivery_id'],
                'p_supplier_name': payload['supplier_name'],
                'p_reference_code': payload['reference_code'],
                'p_items': payload['items'],
                'p_reason': (payload['reason'] as String?)?.isEmpty == true
                    ? null
                    : payload['reason'],
              },
            );
            break;
          case 'review_supplier_delivery_edit':
            await supabase.rpc(
              'dashboard_review_supplier_delivery_edit_request',
              params: {
                'p_request_id': payload['request_id'],
                'p_action': payload['approve'] == true ? 'approve' : 'reject',
              },
            );
            break;
          case 'adjust_stock':
            await supabase.rpc(
              'dashboard_adjust_stock_idempotent_v1',
              params: {
                'p_request_id': action['id'],
                'p_stock_id': payload['stock_id'],
                'p_quantity': payload['quantity'],
                'p_operation': payload['operation'],
              },
            );
            break;
          case 'update_stock_threshold':
            await supabase.rpc(
              'dashboard_update_low_stock_threshold',
              params: {
                'p_stock_id': payload['stock_id'],
                'p_branch_id': payload['branch_id'],
                'p_threshold': payload['threshold'],
              },
            );
            break;
          default:
            action['error'] =
                'Unsupported saved action. It remains on this device.';
            await _storePendingDashboardActions(user, actions);
            _isSyncingDashboardAction = false;
            continue;
        }
        actions.removeWhere((row) => row['id'] == action['id']);
        await _storePendingDashboardActions(user, actions);
        if (action['type'] == 'save_supplier') {
          await _rewriteCachedSupplierId(
            user,
            payload['supplier_id']?.toString(),
            response?.toString(),
          );
        }
        _isSyncingDashboardAction = false;
      } catch (error) {
        _isSyncingDashboardAction = false;
        if (_isNetworkError(error)) {
          action.remove('error');
          await _storePendingDashboardActions(user, actions);
          return;
        }
        action['error'] = error.toString();
        actions = [
          for (final row in actions)
            if (row['id'] == action['id']) action else row,
        ];
        await _storePendingDashboardActions(user, actions);
      }
    }
  }

  void _replacePendingSupplierId(
    List<Map<String, dynamic>> actions,
    String? from,
    String? to,
  ) {
    if (from == null || to == null) return;
    for (final action in actions) {
      final payload = Map<String, dynamic>.from(
        action['payload'] as Map? ?? {},
      );
      if (payload['supplier_id'] == from) {
        payload['supplier_id'] = to;
        action['payload'] = payload;
      }
    }
  }

  void _replacePendingDeliveryId(
    List<Map<String, dynamic>> actions,
    String? from,
    String? to,
  ) {
    if (from == null || to == null) return;
    for (final action in actions) {
      final payload = Map<String, dynamic>.from(
        action['payload'] as Map? ?? {},
      );
      if (payload['delivery_id'] == from) {
        payload['delivery_id'] = to;
        action['payload'] = payload;
      }
    }
  }

  void _replacePendingUnitId(
    List<Map<String, dynamic>> actions,
    String? from,
    String? to,
  ) {
    if (from == null || to == null) return;
    for (final action in actions) {
      final payload = Map<String, dynamic>.from(
        action['payload'] as Map? ?? {},
      );
      for (final key in [
        'base_unit_id',
        'default_purchase_unit_id',
        'default_sale_unit_id',
      ]) {
        if (payload[key] == from) payload[key] = to;
      }
      for (final key in ['purchase_unit_ids', 'sale_unit_ids']) {
        final ids = _stringList(payload[key]);
        payload[key] = ids.map((id) => id == from ? to : id).toList();
      }
      final prices = _doubleMap(payload['sale_prices']);
      if (prices.containsKey(from)) {
        prices[to] = prices.remove(from)!;
        payload['sale_prices'] = prices;
      }
      final points = (payload['price_points'] as List? ?? const [])
          .whereType<Map>()
          .map((point) => Map<String, dynamic>.from(point))
          .toList();
      for (final point in points) {
        if (point['uom_id'] == from) point['uom_id'] = to;
      }
      payload['price_points'] = points;
      action['payload'] = payload;
    }
  }

  void _replacePendingProductId(
    List<Map<String, dynamic>> actions,
    String? from,
    String? to,
  ) {
    if (from == null || to == null) return;
    for (final action in actions) {
      final payload = Map<String, dynamic>.from(
        action['payload'] as Map? ?? {},
      );
      if (payload['product_id'] == from) payload['product_id'] = to;
      action['payload'] = payload;
    }
  }

  Future<void> _rewriteCachedUnitId(
    RetivoxUser user,
    String? from,
    String? to,
  ) async {
    if (from == null || to == null) return;
    final cached = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:product-options',
    );
    if (cached == null || cached.isEmpty || cached.first is! Map) return;
    final options = Map<String, dynamic>.from(cached.first as Map);
    final units = (options['units'] as List? ?? const [])
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .map(
          (unit) => unit['id']?.toString() == from
              ? {...unit, 'id': to, 'is_pending_sync': false}
              : unit,
        )
        .toList();
    options['units'] = units;
    await vault.cacheValue(user, 'dashboard:product-options', [options]);
    final productCache = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:products',
    );
    if (productCache != null) {
      final products = productCache
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .map((product) {
            final links = (product['product_uom_links'] as List? ?? const [])
                .whereType<Map>()
                .map((rawLink) {
                  final link = Map<String, dynamic>.from(rawLink);
                  if (link['uom_id']?.toString() == from) link['uom_id'] = to;
                  return link;
                })
                .toList();
            return {...product, 'product_uom_links': links};
          })
          .toList();
      await vault.cacheValue(user, 'dashboard:products', products);
    }
  }

  Future<void> _rewriteCachedProductId(
    RetivoxUser user,
    String? from,
    String? to,
  ) async {
    if (from == null || to == null) return;
    final cached = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:products',
    );
    if (cached == null) return;
    final rows = cached.whereType<Map>().map(Map<String, dynamic>.from).map((
      row,
    ) {
      if (row['id']?.toString() != from) return row;
      return {
        ...row,
        'id': to,
        'is_pending_sync': false,
        'pending_action_id': null,
      };
    }).toList();
    await vault.cacheValue(user, 'dashboard:products', rows);
  }

  List<String> _stringList(Object? value) => value is List
      ? value.map((item) => item.toString()).toList()
      : <String>[];

  Map<String, double> _doubleMap(Object? value) {
    if (value is! Map) return <String, double>{};
    return {
      for (final entry in value.entries)
        entry.key.toString(): _number(entry.value),
    };
  }

  List<ProductPricePointInput> _productPricePoints(Object? value) =>
      (value as List? ?? const []).whereType<Map>().map((point) {
        return ProductPricePointInput(
          uomId: point['uom_id'].toString(),
          quantity: _number(point['quantity']),
          price: _number(point['price']),
          maxDiscountAmount: _number(point['max_discount_amount']),
        );
      }).toList();

  Future<void> _rewriteCachedSupplierId(
    RetivoxUser user,
    String? from,
    String? to,
  ) async {
    if (from == null || to == null) return;
    final cached = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:suppliers',
    );
    if (cached == null) return;
    final rows = cached.whereType<Map>().map(Map<String, dynamic>.from).map((
      row,
    ) {
      if (row['id']?.toString() != from) return row;
      return {
        ...row,
        'id': to,
        'is_pending_sync': false,
        'pending_action_id': null,
      };
    }).toList();
    await vault.cacheValue(user, 'dashboard:suppliers', rows);
  }

  Future<List<Map<String, dynamic>>> _mergePendingBranchCreates(
    RetivoxUser user,
    List<Map<String, dynamic>> branches,
  ) async {
    final pending = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:pending_branch_creates',
    );
    if (pending == null || pending.isEmpty) return branches;
    final rows = [...branches];
    for (final value in pending.whereType<Map<String, dynamic>>()) {
      final id = value['id']?.toString();
      if (!rows.any((row) => row['id']?.toString() == id)) {
        rows.add({...value, 'is_pending_sync': true});
      }
    }
    return rows;
  }

  Future<DashboardSnapshot> loadMoreSection(
    RetivoxUser user,
    String section,
    int offset,
  ) async {
    if (section != 'transactions' && section != 'audit') {
      throw const DashboardRepositoryException(
        'This dashboard section does not support additional pages.',
      );
    }
    if (offset < 200 || offset % 200 != 0) {
      throw const DashboardRepositoryException(
        'The requested history page is invalid.',
      );
    }
    final supabase = await _requireOnlineRole(
      user,
      section == 'audit' ? [RetivoxRole.owner] : RetivoxRole.values,
    );
    try {
      final current = await vault.readCachedValue<List<dynamic>>(
        user,
        'dashboard:$section',
      );
      final currentRows =
          current?.whereType<Map<String, dynamic>>().toList() ??
          <Map<String, dynamic>>[];
      if (currentRows.length != offset) {
        throw const DashboardRepositoryException(
          'History changed while loading. Refresh and try again.',
        );
      }
      final page = await _fetchSection(supabase, user, section, offset: offset);
      final rows = [...currentRows, ...page];
      await vault.cacheValue(user, 'dashboard:$section', rows);
      return DashboardSnapshot(
        section: section,
        rows: rows,
        updatedAt: await vault.cachedValueUpdatedAt(user, 'dashboard:$section'),
        isCached: false,
      );
    } catch (error) {
      if (!_isNetworkError(error)) rethrow;
      throw const DashboardRepositoryException(
        'Connect to the internet to load older history.',
      );
    }
  }

  Future<DashboardSnapshot> loadHistoryPage(
    RetivoxUser user,
    String section, {
    int offset = 0,
    String search = '',
    String status = 'all',
    String branchId = 'all',
    DateTime? startDate,
    DateTime? endDate,
    String action = 'all',
    String entityType = 'all',
  }) async {
    if (section != 'transactions' && section != 'audit') {
      throw const DashboardRepositoryException(
        'This dashboard section does not support history filters.',
      );
    }
    if (offset < 0 || offset % 200 != 0) {
      throw const DashboardRepositoryException(
        'The requested history page is invalid.',
      );
    }
    final allowedRoles = section == 'audit'
        ? [RetivoxRole.owner]
        : RetivoxRole.values;
    if (!allowedRoles.contains(user.role)) {
      throw const DashboardRepositoryException(
        'This dashboard history is not available for your role.',
      );
    }
    if (client == null && offset == 0) return loadSection(user, section);
    late final SupabaseClient supabase;
    try {
      supabase = await _requireOnlineRole(user, allowedRoles);
    } catch (error) {
      if (offset == 0 && _isNetworkError(error)) {
        return loadSection(user, section);
      }
      rethrow;
    }
    try {
      final rows = await _fetchSection(
        supabase,
        user,
        section,
        offset: offset,
        search: search,
        status: status,
        branchId: branchId,
        startDate: startDate,
        endDate: endDate,
        action: action,
        entityType: entityType,
      );
      return DashboardSnapshot(
        section: section,
        rows: rows,
        updatedAt: DateTime.now(),
        isCached: false,
      );
    } catch (error) {
      if (!_isNetworkError(error) || offset != 0) rethrow;
      return loadSection(user, section);
    }
  }

  Future<List<Map<String, dynamic>>> _fetchSection(
    SupabaseClient supabase,
    RetivoxUser user,
    String section, {
    int offset = 0,
    String search = '',
    String status = 'all',
    String branchId = 'all',
    DateTime? startDate,
    DateTime? endDate,
    String action = 'all',
    String entityType = 'all',
  }) async {
    if (section == 'cash_deposits') {
      final response = await supabase
          .from('branch_cash_deposits')
          .select(
            'id, branch_id, deposited_by, deposit_date, amount, expected_cash_amount, variance_amount, deposit_reference, note, review_note, status, submitted_role, admin_approved_by, admin_approved_at, created_at, branches(name), depositor:users!branch_cash_deposits_deposited_by_fkey(name, phone, email)',
          )
          .eq('business_id', user.businessId)
          .order('created_at', ascending: false)
          .range(0, 199);
      return _normalizeRows(response);
    }
    if (section == 'transfers') {
      if (user.role == RetivoxRole.employee) {
        throw const DashboardRepositoryException(
          'Transfers are only available to owners and administrators.',
        );
      }
      final branchIds = user.branches.map((branch) => branch.id).toList();
      if (branchIds.isEmpty) return const [];
      final branchFilter = branchIds.join(',');
      final response = await supabase
          .from('stock_transfers')
          .select(
            'id, from_branch_id, to_branch_id, initiated_by, received_by, status, notes, initiated_at, received_at',
          )
          .eq('business_id', user.businessId)
          .or(
            'from_branch_id.in.($branchFilter),to_branch_id.in.($branchFilter)',
          )
          .order('initiated_at', ascending: false)
          .range(0, 49);
      final transfers = _normalizeRows(response);
      if (transfers.isEmpty) return transfers;

      final transferIds = transfers
          .map((row) => row['id']?.toString())
          .whereType<String>()
          .toList();
      final relatedBranchIds = transfers
          .expand(
            (row) => [
              row['from_branch_id']?.toString(),
              row['to_branch_id']?.toString(),
            ],
          )
          .whereType<String>()
          .toSet()
          .toList();
      final actorIds = transfers
          .expand(
            (row) => [
              row['initiated_by']?.toString(),
              row['received_by']?.toString(),
            ],
          )
          .whereType<String>()
          .toSet()
          .toList();
      final detailResponses = await Future.wait<Object>([
        supabase
            .from('stock_transfer_items')
            .select(
              'id, transfer_id, product_id, quantity_sent, quantity_received, quantity_discrepancy, uom_id, quantity_in_uom, base_quantity_sent, base_quantity_received, products!inner(name, sku), units_of_measure(name, abbreviation, conversion_factor)',
            )
            .eq('business_id', user.businessId)
            .inFilter('transfer_id', transferIds),
        supabase
            .from('branches')
            .select('id, name')
            .eq('business_id', user.businessId)
            .inFilter('id', relatedBranchIds),
        if (actorIds.isNotEmpty)
          supabase
              .from('users')
              .select('id, name')
              .eq('business_id', user.businessId)
              .inFilter('id', actorIds)
        else
          Future.value(const <Map<String, dynamic>>[]),
      ]);
      final items = _normalizeRows(detailResponses[0]);
      final branches = _normalizeRows(detailResponses[1]);
      final actors = _normalizeRows(detailResponses[2]);
      final itemsByTransfer = _groupRows(items, 'transfer_id');
      final branchNames = {
        for (final branch in branches)
          branch['id'].toString(): branch['name']?.toString() ?? 'Branch',
      };
      final actorNames = {
        for (final actor in actors)
          actor['id'].toString(): actor['name']?.toString() ?? 'Team member',
      };

      return transfers.map((transfer) {
        final id = transfer['id']?.toString() ?? '';
        return {
          ...transfer,
          'from_branch_name':
              branchNames[transfer['from_branch_id']?.toString()] ?? 'Branch',
          'to_branch_name':
              branchNames[transfer['to_branch_id']?.toString()] ?? 'Branch',
          'initiated_by_name':
              actorNames[transfer['initiated_by']?.toString()] ?? 'Team member',
          'received_by_name': actorNames[transfer['received_by']?.toString()],
          'items': itemsByTransfer[id] ?? const [],
        };
      }).toList();
    }

    switch (section) {
      case 'branches':
        if (user.role == RetivoxRole.owner) {
          final response = await supabase
              .from('branches')
              .select('id, name, location, branch_type, is_active')
              .eq('business_id', user.businessId)
              .isFilter('deleted_at', null)
              .order('name')
              .range(0, 199);
          return _normalizeRows(response);
        }
        return user.branches
            .map(
              (branch) => {
                'id': branch.id,
                'name': branch.name,
                'role': branch.role,
              },
            )
            .toList();
      case 'admins':
        if (user.role != RetivoxRole.owner) {
          throw const DashboardRepositoryException(
            'Administrator management is only available to the business owner.',
          );
        }
        final response = await supabase
            .from('users')
            .select('id, name, email, phone, is_active, created_at')
            .eq('business_id', user.businessId)
            .eq('global_role', 'admin')
            .isFilter('deleted_at', null)
            .order('name')
            .range(0, 499);
        final admins = _normalizeRows(response);
        if (admins.isEmpty) return admins;
        final adminIds = admins
            .map((row) => row['id']?.toString())
            .whereType<String>()
            .toList();
        final assignmentResponses = await Future.wait<Object>([
          supabase
              .from('user_branch_roles')
              .select('id, user_id, branch_id, role, is_active, assigned_at')
              .eq('business_id', user.businessId)
              .eq('role', 'admin')
              .inFilter('user_id', adminIds)
              .order('assigned_at', ascending: false),
          supabase
              .from('branches')
              .select('id, name')
              .eq('business_id', user.businessId)
              .isFilter('deleted_at', null)
              .order('name'),
        ]);
        final assignments = _normalizeRows(assignmentResponses[0]);
        final branches = _normalizeRows(assignmentResponses[1]);
        final branchNames = {
          for (final branch in branches)
            branch['id'].toString(): branch['name']?.toString() ?? 'Branch',
        };
        final assignmentsByUser = _groupRows(assignments, 'user_id');
        return admins.map((admin) {
          final id = admin['id']?.toString() ?? '';
          final userAssignments = assignmentsByUser[id] ?? const [];
          return {
            ...admin,
            'branches': userAssignments
                .map(
                  (assignment) => {
                    ...assignment,
                    'branch_name':
                        branchNames[assignment['branch_id']?.toString()] ??
                        'Branch',
                  },
                )
                .toList(),
          };
        }).toList();
      case 'audit':
        if (user.role != RetivoxRole.owner) {
          throw const DashboardRepositoryException(
            'The audit log is only available to the business owner.',
          );
        }
        var query = supabase
            .from('audit_logs')
            .select(
              'id, actor_id, entity_type, entity_id, action, old_value, new_value, created_at',
            )
            .eq('business_id', user.businessId);
        if (action != 'all') query = query.eq('action', action);
        if (entityType != 'all') {
          query = query.eq('entity_type', entityType);
        }
        final normalizedSearch = _safeHistorySearch(search);
        if (normalizedSearch.isNotEmpty) {
          final clauses = [
            'action.ilike.%$normalizedSearch%',
            'entity_type.ilike.%$normalizedSearch%',
          ];
          final actors = _normalizeRows(
            await supabase
                .from('users')
                .select('id')
                .eq('business_id', user.businessId)
                .or(
                  'name.ilike.%$normalizedSearch%,email.ilike.%$normalizedSearch%',
                )
                .range(0, 499),
          );
          final actorIds = actors
              .map((actor) => actor['id']?.toString())
              .whereType<String>()
              .where(_isUuid)
              .toList();
          if (actorIds.isNotEmpty) {
            clauses.add('actor_id.in.(${actorIds.join(',')})');
          }
          if (_isUuid(normalizedSearch)) {
            clauses.add('entity_id.eq.$normalizedSearch');
            clauses.add('actor_id.eq.$normalizedSearch');
          }
          query = query.or(clauses.join(','));
        }
        final response = await query
            .order('created_at', ascending: false)
            .range(offset, offset + 199);
        final logs = _normalizeRows(response);
        if (logs.isEmpty) return logs;
        final actorIds = logs
            .map((row) => row['actor_id']?.toString())
            .whereType<String>()
            .toSet()
            .toList();
        if (actorIds.isEmpty) {
          return logs.map((row) => {...row, 'actor_name': 'System'}).toList();
        }
        final users = _normalizeRows(
          await supabase
              .from('users')
              .select('id, name, email')
              .eq('business_id', user.businessId)
              .inFilter('id', actorIds),
        );
        final actorNames = {
          for (final actor in users)
            actor['id'].toString(): actor['name']?.toString() ?? 'User',
        };
        return logs
            .map(
              (row) => {
                ...row,
                'actor_name':
                    actorNames[row['actor_id']?.toString()] ?? 'System',
              },
            )
            .toList();
      case 'settings':
        final profile = await supabase
            .from('users')
            .select('id, name, email, phone, global_role, is_active')
            .eq('business_id', user.businessId)
            .eq('id', user.id)
            .maybeSingle();
        final business = await supabase
            .from('businesses')
            .select('id, name, country, currency, timezone')
            .eq('id', user.businessId)
            .maybeSingle();
        if (profile == null || business == null) {
          throw const DashboardRepositoryException(
            'Your account or business profile is not available.',
          );
        }
        final profileData = Map<String, dynamic>.from(profile);
        final businessData = Map<String, dynamic>.from(business);
        return [
          {
            ...profileData,
            'business_name':
                businessData['name']?.toString() ?? user.businessName,
            'business_currency':
                businessData['currency']?.toString() ?? user.currency,
            'business_country': businessData['country']?.toString() ?? '',
            'business_timezone': businessData['timezone']?.toString() ?? '',
          },
        ];
      case 'stock':
        final branchIds = user.branches.map((branch) => branch.id).toList();
        if (branchIds.isEmpty) return const [];
        final response = await supabase
            .from('branch_stock')
            .select(
              'id, branch_id, quantity_on_hand, quantity_reserved, base_quantity_on_hand, base_quantity_reserved, low_stock_threshold, average_base_unit_cost, products!inner(id, name, sku), branches!inner(id, name)',
            )
            .eq('business_id', user.businessId)
            .inFilter('branch_id', branchIds)
            .isFilter('branches.deleted_at', null)
            .order('branch_id')
            .range(0, 499);
        final rows = _normalizeRows(response);
        final productIds = rows
            .map((row) => _nested(row['products'])?['id']?.toString())
            .whereType<String>()
            .toSet()
            .toList();
        if (productIds.isEmpty) return rows;
        final uomRows = _normalizeRows(
          await supabase
              .from('product_uom_links')
              .select(
                'product_id, is_base_uom, is_purchase_uom, is_sale_uom, is_default_sale_uom, is_default_purchase_uom, units_of_measure!inner(id, name, abbreviation, conversion_factor, is_base_unit)',
              )
              .eq('business_id', user.businessId)
              .inFilter('product_id', productIds)
              .order('is_default_purchase_uom', ascending: false),
        );
        final uomsByProduct = _groupRows(uomRows, 'product_id');
        return rows.map((row) {
          final productId = _nested(row['products'])?['id']?.toString() ?? '';
          final uoms = (uomsByProduct[productId] ?? const [])
              .map((link) {
                final unit = _nested(link['units_of_measure']);
                if (unit == null) return null;
                return <String, dynamic>{
                  'id': unit['id'],
                  'name': unit['name'],
                  'abbreviation': unit['abbreviation'],
                  'conversion_factor': unit['conversion_factor'],
                  'is_base_unit': unit['is_base_unit'],
                  'is_base_uom': link['is_base_uom'],
                  'is_purchase_uom': link['is_purchase_uom'],
                  'is_sale_uom': link['is_sale_uom'],
                  'is_default_sale_uom': link['is_default_sale_uom'],
                  'is_default_purchase_uom': link['is_default_purchase_uom'],
                };
              })
              .whereType<Map<String, dynamic>>()
              .toList();
          return {...row, 'uom_options': uoms};
        }).toList();
      case 'products':
        final response = await supabase
            .from('products')
            .select(
              'id, name, sku, category, subcategory, brand_family, product_kind, unit, description, tracks_expiry, is_active',
            )
            .eq('business_id', user.businessId)
            .isFilter('deleted_at', null)
            .order('name')
            .range(0, 499);
        final productRows = _normalizeRows(response);
        final productIds = productRows
            .map((row) => row['id'].toString())
            .toList();
        final barcodeRows = productIds.isEmpty
            ? <Map<String, dynamic>>[]
            : _normalizeRows(
                await supabase
                    .from('product_barcodes')
                    .select('product_id, code')
                    .eq('business_id', user.businessId)
                    .eq('is_active', true)
                    .inFilter('product_id', productIds),
              );
        final barcodesByProduct = _groupRows(barcodeRows, 'product_id');
        final products = productRows.map((product) {
          final codes =
              (barcodesByProduct[product['id'].toString()] ?? const [])
                  .map((row) => row['code']?.toString())
                  .whereType<String>()
                  .toList();
          return {...product, 'barcodes': codes};
        }).toList();
        if (products.isEmpty) return products;

        // Keep the catalog usable if an optional relationship is unavailable
        // in a particular database deployment. The core product query above
        // is the only query that can prevent the table from rendering.
        List<Map<String, dynamic>> units = const [];
        List<Map<String, dynamic>> branches = const [];
        try {
          units = _normalizeRows(
            await supabase
                .from('units_of_measure')
                .select(
                  'id, name, abbreviation, conversion_factor, is_base_unit',
                )
                .eq('business_id', user.businessId)
                .eq('is_active', true)
                .order('conversion_factor')
                .order('name'),
          );
        } catch (_) {}
        try {
          branches = _normalizeRows(
            await supabase
                .from('branches')
                .select('id, name')
                .eq('business_id', user.businessId)
                .eq('is_active', true)
                .isFilter('deleted_at', null)
                .order('name'),
          );
        } catch (_) {}
        await vault.cacheValue(user, 'dashboard:product-options', [
          {'units': units, 'branches': branches},
        ]);

        for (final entry in <({String key, String table, String columns})>[
          (
            key: 'product_pricing',
            table: 'product_pricing',
            columns: 'product_id, base_price, min_price, max_price',
          ),
          (
            key: 'product_uom_links',
            table: 'product_uom_links',
            columns: 'product_id, uom_id, is_purchase_uom, is_sale_uom, is_base_uom, is_default_purchase_uom, is_default_sale_uom, units_of_measure(name, abbreviation, conversion_factor)',
          ),
          (
            key: 'product_pricing_models',
            table: 'product_pricing_models',
            columns: 'product_id, branch_id, pricing_method, rounding_rule, status, product_price_points(quantity_in_uom, price, max_discount_amount)',
          ),
        ]) {
          try {
            final related = _normalizeRows(
              await supabase
                  .from(entry.table)
                  .select(entry.columns)
                  .eq('business_id', user.businessId)
                  .inFilter('product_id', productIds),
            );
            final byProduct = _groupRows(related, 'product_id');
            for (final product in products) {
              final data = byProduct[product['id'].toString()] ?? const [];
              product[entry.key] = entry.key == 'product_pricing'
                  ? (data.isEmpty ? null : data.first)
                  : data;
            }
          } catch (_) {
            for (final product in products) {
              product.putIfAbsent(
                entry.key,
                () => entry.key == 'product_pricing' ? null : const [],
              );
            }
          }
        }
        if (user.role == RetivoxRole.employee) return products;
        final branchIds = user.branches.map((branch) => branch.id).toList();
        var stockQuery = supabase
            .from('branch_stock')
            .select(
              'product_id, branch_id, quantity_on_hand, branches!inner(name)',
            )
            .eq('business_id', user.businessId)
            .inFilter(
              'product_id',
              products.map((row) => row['id'].toString()).toList(),
            );
        if (branchIds.isNotEmpty)
          stockQuery = stockQuery.inFilter('branch_id', branchIds);
        List<Map<String, dynamic>> stockRows = const [];
        try {
          stockRows = _normalizeRows(await stockQuery.range(0, 1999));
        } catch (_) {}
        final stockByProduct = _groupRows(stockRows, 'product_id');
        return products.map((product) {
          final id = product['id']?.toString() ?? '';
          return {
            ...product,
            'assigned_branch_stock': stockByProduct[id] ?? const [],
          };
        }).toList();
      case 'transactions':
        final branchIds = user.branches.map((branch) => branch.id).toList();
        if (branchIds.isEmpty) return const [];
        var query = supabase
            .from('transactions')
            .select(
              'id, branch_id, employee_id, status, subtotal, discount_amount, total_amount, recorded_at, origin, sync_status',
            )
            .eq('business_id', user.businessId)
            .inFilter('branch_id', branchIds);
        if (user.role == RetivoxRole.employee) {
          query = query.eq('employee_id', user.id);
        }
        if (branchId != 'all') {
          if (!branchIds.contains(branchId)) return const [];
          query = query.eq('branch_id', branchId);
        }
        if (status != 'all') {
          query = query.eq(
            'status',
            status == 'pending_verify' ? 'pending_sync' : status,
          );
        }
        if (startDate != null) {
          final start = DateTime(
            startDate.year,
            startDate.month,
            startDate.day,
          );
          query = query.gte('recorded_at', start.toUtc().toIso8601String());
        }
        if (endDate != null) {
          final endExclusive = DateTime(
            endDate.year,
            endDate.month,
            endDate.day + 1,
          );
          query = query.lt(
            'recorded_at',
            endExclusive.toUtc().toIso8601String(),
          );
        }
        final normalizedSearch = _safeHistorySearch(search);
        if (normalizedSearch.isNotEmpty) {
          final clauses = [
            'status.ilike.%$normalizedSearch%',
            'origin.ilike.%$normalizedSearch%',
            'sync_status.ilike.%$normalizedSearch%',
          ];
          if (_isUuid(normalizedSearch)) {
            clauses.add('id.eq.$normalizedSearch');
            clauses.add('employee_id.eq.$normalizedSearch');
          }
          final employees = _normalizeRows(
            await supabase
                .from('users')
                .select('id')
                .eq('business_id', user.businessId)
                .or(
                  'name.ilike.%$normalizedSearch%,email.ilike.%$normalizedSearch%',
                )
                .range(0, 499),
          );
          final employeeIds = employees
              .map((employee) => employee['id']?.toString())
              .whereType<String>()
              .where(_isUuid)
              .toList();
          if (employeeIds.isNotEmpty) {
            clauses.add('employee_id.in.(${employeeIds.join(',')})');
          }
          final matchingPayments = _normalizeRows(
            await supabase
                .from('payments')
                .select('transaction_id')
                .eq('business_id', user.businessId)
                .or(
                  'mpesa_ref_code.ilike.%$normalizedSearch%,cash_deposit_code.ilike.%$normalizedSearch%',
                )
                .range(0, 499),
          );
          final matchingTransactionIds = matchingPayments
              .map((payment) => payment['transaction_id']?.toString())
              .whereType<String>()
              .where(_isUuid)
              .toSet();
          final products = _normalizeRows(
            await supabase
                .from('products')
                .select('id')
                .eq('business_id', user.businessId)
                .or(
                  'name.ilike.%$normalizedSearch%,sku.ilike.%$normalizedSearch%',
                )
                .range(0, 499),
          );
          final productIds = products
              .map((product) => product['id']?.toString())
              .whereType<String>()
              .where(_isUuid)
              .toList();
          if (productIds.isNotEmpty) {
            final matchingItems = _normalizeRows(
              await supabase
                  .from('transaction_items')
                  .select('transaction_id')
                  .eq('business_id', user.businessId)
                  .inFilter('product_id', productIds)
                  .range(0, 999),
            );
            matchingTransactionIds.addAll(
              matchingItems
                  .map((item) => item['transaction_id']?.toString())
                  .whereType<String>()
                  .where(_isUuid),
            );
          }
          if (matchingTransactionIds.isNotEmpty) {
            clauses.add('id.in.(${matchingTransactionIds.join(',')})');
          }
          query = query.or(clauses.join(','));
        }
        final response = await query
            .order('recorded_at', ascending: false)
            .range(offset, offset + 199);
        final transactions = _normalizeRows(response);
        if (transactions.isEmpty) return transactions;

        final transactionIds = transactions
            .map((row) => row['id']?.toString())
            .whereType<String>()
            .toList();
        final employeeIds = transactions
            .map((row) => row['employee_id']?.toString())
            .whereType<String>()
            .toSet()
            .toList();
        final detailResponses = await Future.wait<Object>([
          supabase
              .from('payments')
              .select(
                'id, transaction_id, payment_method, amount, status, mpesa_ref_code, cash_deposit_code, payment_at',
              )
              .eq('business_id', user.businessId)
              .inFilter('transaction_id', transactionIds)
              .order('payment_at', ascending: false),
          supabase
              .from('transaction_items')
              .select(
                'id, transaction_id, product_id, recovery_item_id, quantity, quantity_in_uom, base_quantity, unit_price_at_sale, line_total, stock_status, products!inner(name, sku), units_of_measure(name, abbreviation, conversion_factor)',
              )
              .eq('business_id', user.businessId)
              .inFilter('transaction_id', transactionIds)
              .order('id'),
          if (employeeIds.isNotEmpty)
            supabase
                .from('users')
                .select('id, name')
                .eq('business_id', user.businessId)
                .inFilter('id', employeeIds)
          else
            Future.value(const <Map<String, dynamic>>[]),
        ]);
        final payments = _normalizeRows(detailResponses[0]);
        final items = _normalizeRows(detailResponses[1]);
        final employees = _normalizeRows(detailResponses[2]);
        final paymentsByTransaction = _groupRows(payments, 'transaction_id');
        final itemsByTransaction = _groupRows(items, 'transaction_id');
        final employeeNames = {
          for (final employee in employees)
            employee['id'].toString():
                employee['name']?.toString() ?? 'Team member',
        };

        return transactions.map((transaction) {
          final id = transaction['id']?.toString() ?? '';
          return {
            ...transaction,
            'employee_name':
                employeeNames[transaction['employee_id']?.toString()] ??
                'Unknown employee',
            'payments': paymentsByTransaction[id] ?? const [],
            'items': itemsByTransaction[id] ?? const [],
          };
        }).toList();
      case 'deliveries':
        if (user.role == RetivoxRole.employee) {
          throw const DashboardRepositoryException(
            'Supplier deliveries are only available to owners and administrators.',
          );
        }
        final branchIds = user.branches
            .where((branch) => branch.role == 'admin' || branch.role == 'owner')
            .map((branch) => branch.id)
            .toList();
        if (branchIds.isEmpty) return const [];
        final deliveries = _normalizeRows(
          await supabase
              .from('supplier_deliveries')
              .select(
                'id, to_branch_id, supplier_id, supplier_name, reference_code, status, requested_by, approved_by, acknowledged_by, recorded_at, delivered_at, branches!inner(name)',
              )
              .eq('business_id', user.businessId)
              .inFilter('to_branch_id', branchIds)
              .order('recorded_at', ascending: false)
              .range(0, 99),
        );
        if (deliveries.isEmpty) return deliveries;
        final deliveryIds = deliveries
            .map((row) => row['id']?.toString())
            .whereType<String>()
            .toList();
        final items = _normalizeRows(
          await supabase
              .from('supplier_delivery_items')
              .select(
                'id, delivery_id, product_id, quantity_expected, quantity_received, quantity_in_uom, base_quantity_received, unit_cost, total_cost, uom_id, products!inner(name, sku), units_of_measure(abbreviation, name, conversion_factor)',
              )
              .eq('business_id', user.businessId)
              .inFilter('delivery_id', deliveryIds)
              .order('id'),
        );
        final itemsByDelivery = _groupRows(
          items.map((item) {
            final unit = _nested(item['units_of_measure']);
            return {
              ...item,
              'base_quantity_expected':
                  _number(item['quantity_expected']) *
                  (_number(unit?['conversion_factor']) > 0
                      ? _number(unit?['conversion_factor'])
                      : 1),
            };
          }).toList(),
          'delivery_id',
        );
        var editRequestsByDelivery = <String, List<Map<String, dynamic>>>{};
        if (user.role == RetivoxRole.owner) {
          final editRequests = _normalizeRows(
            await supabase
                .from('supplier_delivery_edit_requests')
                .select(
                  'id, delivery_id, branch_id, status, new_value, reason, requested_at',
                )
                .eq('business_id', user.businessId)
                .eq('status', 'pending_approval')
                .inFilter('delivery_id', deliveryIds)
                .order('requested_at', ascending: false),
          );
          editRequestsByDelivery = _groupRows(editRequests, 'delivery_id');
        }
        return deliveries.map((delivery) {
          final id = delivery['id']?.toString() ?? '';
          return {
            ...delivery,
            'items': itemsByDelivery[id] ?? const [],
            'edit_requests': editRequestsByDelivery[id] ?? const [],
          };
        }).toList();
      case 'suppliers':
        final response = await supabase
            .from('suppliers')
            .select('id, name, phone, email, contact_person, notes, is_active')
            .eq('business_id', user.businessId)
            .order('is_active', ascending: false)
            .order('name')
            .range(0, 199);
        return _normalizeRows(response);
      case 'stock_movements':
        if (user.role == RetivoxRole.employee) {
          throw const DashboardRepositoryException(
            'Stock movement history is only available to owners and administrators.',
          );
        }
        final branchIds = user.branches
            .where((branch) => branch.role == 'admin' || branch.role == 'owner')
            .map((branch) => branch.id)
            .toList();
        if (branchIds.isEmpty) return const [];
        final movements = await supabase.rpc(
          'dashboard_stock_movement_history',
          params: {'p_branch_ids': branchIds, 'p_limit': 100, 'p_offset': 0},
        );
        return _normalizeRows(movements);
      case 'employees':
        if (user.role == RetivoxRole.owner) {
          final response = await supabase
              .from('users')
              .select(
                'id, name, email, phone, global_role, is_active, created_at',
              )
              .eq('business_id', user.businessId)
              .isFilter('deleted_at', null)
              .order('created_at')
              .range(0, 499);
          return _normalizeRows(response);
        }
        final branchIds = user.branches
            .where((branch) => branch.role == 'admin' || branch.role == 'owner')
            .map((branch) => branch.id)
            .toList();
        if (branchIds.isEmpty) return const [];
        final response = await supabase
            .from('user_branch_roles')
            .select(
              'id, user_id, branch_id, role, assigned_at, is_active, branches!inner(id, name), users!user_branch_roles_user_id_fkey(id, name, email, phone, global_role, is_active, deleted_at)',
            )
            .eq('business_id', user.businessId)
            .eq('role', 'employee')
            .inFilter('branch_id', branchIds)
            .order('assigned_at', ascending: false)
            .range(0, 499);
        return _normalizeRows(response);
      case 'damages':
        final rpc = user.role == RetivoxRole.employee
            ? 'employee_my_inventory_loss_reports'
            : 'admin_managed_inventory_loss_reports';
        final response = await supabase.rpc(
          rpc,
          params: {'p_limit': user.role == RetivoxRole.employee ? 25 : 50},
        );
        return _normalizeRows(response);
      default:
        throw DashboardRepositoryException(
          'The $section section does not have a data provider yet.',
        );
    }
  }

  List<Map<String, dynamic>> _normalizeRows(Object? value) {
    if (value is! List) {
      throw const DashboardRepositoryException(
        'The server returned an invalid dashboard response.',
      );
    }
    return value.whereType<Map<String, dynamic>>().toList();
  }

  String _safeHistorySearch(String value) =>
      value.trim().replaceAll(RegExp(r'[^A-Za-z0-9 _@.+-]'), '').trim();

  bool _isUuid(String value) => RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  ).hasMatch(value);

  Map<String, List<Map<String, dynamic>>> _groupRows(
    List<Map<String, dynamic>> rows,
    String key,
  ) {
    final grouped = <String, List<Map<String, dynamic>>>{};
    for (final row in rows) {
      final value = row[key]?.toString();
      if (value == null) continue;
      grouped.putIfAbsent(value, () => []).add(row);
    }
    return grouped;
  }

  Map<String, dynamic>? _nested(Object? value) {
    if (value is Map<String, dynamic>) return value;
    if (value is List &&
        value.isNotEmpty &&
        value.first is Map<String, dynamic>) {
      return value.first as Map<String, dynamic>;
    }
    return null;
  }

  double _number(Object? value) {
    final parsed = double.tryParse(value?.toString() ?? '');
    return parsed == null || !parsed.isFinite ? 0 : parsed;
  }

  bool _isNetworkError(Object error) {
    if (error is SocketException || error is TimeoutException) return true;
    if (error is PostgrestException) {
      final code = error.code ?? '';
      return code.startsWith('08') || code == 'PGRST000' || code == 'PGRST001';
    }
    final message = error.toString().toLowerCase();
    return message.contains('failed host lookup') ||
        message.contains('socketexception') ||
        message.contains('clientexception') ||
        message.contains('failed to fetch') ||
        message.contains('auth session missing') ||
        message.contains('network request failed') ||
        message.contains('network is unreachable') ||
        message.contains('connection refused') ||
        message.contains('connection reset') ||
        message.contains('connection timed out');
  }
}

class DashboardRepositoryException implements Exception {
  const DashboardRepositoryException(this.message);

  final String message;

  @override
  String toString() => message;
}
