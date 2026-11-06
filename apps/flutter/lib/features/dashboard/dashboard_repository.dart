import 'dart:async';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/auth/offline_account_vault.dart';
import '../../core/auth/retivox_user.dart';
import '../../core/network/web_api_client.dart';

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

class TransferOptionsSnapshot {
  const TransferOptionsSnapshot({
    required this.branches,
    required this.stockRows,
    required this.updatedAt,
    required this.isCached,
  });

  final List<Map<String, dynamic>> branches;
  final List<Map<String, dynamic>> stockRows;
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
  const DashboardRepository({
    required this.vault,
    required this.client,
    this.webApiClient,
  });

  final OfflineAccountVault vault;
  final SupabaseClient? client;
  final WebApiClient? webApiClient;

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
    if (!['starter', 'growth', 'enterprise'].contains(planKey) ||
        !['monthly', 'yearly'].contains(billingInterval) ||
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
        final authUser = await supabase.auth.getUser();
        if (authUser.user?.id != user.id) {
          throw const DashboardRepositoryException(
            'Sign in online with this account to load transfer options.',
          );
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
        final options = {'branches': branches, 'stock_rows': stockRows};
        await vault.cacheValue(user, cacheKey, [options]);
        return TransferOptionsSnapshot(
          branches: branches,
          stockRows: stockRows,
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

  Future<void> recordSupplierDelivery(
    RetivoxUser user, {
    required String branchId,
    required String supplierId,
    required String supplierName,
    required String referenceCode,
    required List<Map<String, Object?>> items,
  }) async {
    final supabase = await _requireOnlineRole(user, [
      RetivoxRole.owner,
      RetivoxRole.admin,
    ]);
    if (items.isEmpty || supplierName.trim().isEmpty) {
      throw const DashboardRepositoryException(
        'Select a supplier and add at least one product.',
      );
    }
    await supabase.rpc(
      'dashboard_record_supplier_delivery',
      params: {
        'p_branch_id': branchId,
        'p_supplier_name': supplierName.trim(),
        'p_reference_code': referenceCode.trim(),
        'p_items': items,
        'p_supplier_id': supplierId,
        'p_supplier_phone': null,
        'p_supplier_email': null,
        'p_supplier_contact_person': null,
        'p_supplier_notes': null,
        'p_price_rating': null,
        'p_stock_quality_rating': null,
        'p_availability_rating': null,
        'p_rating_note': null,
      },
    );
  }

  Future<void> approveSupplierDelivery(
    RetivoxUser user,
    String deliveryId,
  ) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    await supabase.rpc(
      'dashboard_approve_supplier_delivery',
      params: {'p_delivery_id': deliveryId},
    );
  }

  Future<void> acknowledgeSupplierDelivery(
    RetivoxUser user,
    String deliveryId,
  ) async {
    final supabase = await _requireOnlineRole(user, [
      RetivoxRole.owner,
      RetivoxRole.admin,
    ]);
    await supabase.rpc(
      'dashboard_acknowledge_supplier_delivery',
      params: {'p_delivery_id': deliveryId},
    );
  }

  Future<void> editSupplierDelivery(
    RetivoxUser user, {
    required String deliveryId,
    required String supplierName,
    required String referenceCode,
    required String reason,
    required List<Map<String, Object?>> items,
  }) async {
    final supabase = await _requireOnlineRole(user, [
      RetivoxRole.owner,
      RetivoxRole.admin,
    ]);
    if (supplierName.trim().isEmpty || items.isEmpty) {
      throw const DashboardRepositoryException(
        'Supplier name and at least one delivery item are required.',
      );
    }
    await supabase.rpc(
      'dashboard_request_supplier_delivery_edit',
      params: {
        'p_delivery_id': deliveryId,
        'p_supplier_name': supplierName.trim(),
        'p_reference_code': referenceCode.trim(),
        'p_items': items,
        'p_reason': reason.trim().isEmpty ? null : reason.trim(),
      },
    );
  }

  Future<void> reviewSupplierDeliveryEdit(
    RetivoxUser user, {
    required String requestId,
    required bool approve,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    await supabase.rpc(
      'dashboard_review_supplier_delivery_edit_request',
      params: {
        'p_request_id': requestId,
        'p_action': approve ? 'approve' : 'reject',
      },
    );
  }

  Future<ProductOptionsSnapshot> loadProductOptions(
    RetivoxUser user, {
    String? productId,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    final results = await Future.wait([
      supabase
          .from('units_of_measure')
          .select('id, name, abbreviation, conversion_factor, is_base_unit')
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
      units: _normalizeRows(results[0]),
      branches: _normalizeRows(results[1]),
      product: product,
    );
  }

  Future<String> createUnitOfMeasure(
    RetivoxUser user, {
    required String name,
    required String abbreviation,
    required double conversionFactor,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
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
            conversionFactor * 10000) {
      throw const DashboardRepositoryException(
        'Enter a unit name, abbreviation, and positive conversion factor.',
      );
    }

    final created = await supabase
        .from('units_of_measure')
        .insert({
          'business_id': user.businessId,
          'name': normalizedName,
          'abbreviation': normalizedAbbreviation,
          'conversion_factor': conversionFactor,
          'is_base_unit': false,
          'is_active': true,
          'created_by': user.id,
        })
        .select('id, name, abbreviation, conversion_factor, is_base_unit')
        .single();
    return created['id'].toString();
  }

  Future<void> createProduct(
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
  }) async {
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
  }

  Future<void> updateProduct(
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
  }) async {
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
        !RegExp(r'^[a-zA-Z0-9]{1,20}$').hasMatch(sku.trim()) ||
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

  Future<void> verifyPayment(
    RetivoxUser user, {
    required String paymentId,
    required String action,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    if (!const ['approve', 'reject'].contains(action)) {
      throw const DashboardRepositoryException('Invalid payment action.');
    }
    await supabase.rpc(
      'owner_verify_payment',
      params: {'p_payment_id': paymentId, 'p_action': action},
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

  Future<void> saveSupplier(
    RetivoxUser user, {
    String? supplierId,
    required String name,
    required String phone,
    required String email,
    required String contactPerson,
    required String notes,
    required bool isActive,
  }) async {
    final supabase = await _requireOnlineRole(user, [
      RetivoxRole.owner,
      RetivoxRole.admin,
    ]);
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
    await supabase.rpc(
      'upsert_business_supplier',
      params: {
        'p_supplier_id': supplierId,
        'p_name': normalizedName,
        'p_phone': phone.trim().isEmpty ? null : phone.trim(),
        'p_email': normalizedEmail.isEmpty ? null : normalizedEmail,
        'p_contact_person': contactPerson.trim().isEmpty
            ? null
            : contactPerson.trim(),
        'p_notes': notes.trim().isEmpty ? null : notes.trim(),
        'p_is_active': isActive,
      },
    );
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

  Future<void> createBranch(
    RetivoxUser user, {
    required String name,
    required String location,
    required String branchType,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
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
    final created = await supabase
        .from('branches')
        .insert({
          'business_id': user.businessId,
          'name': normalizedName,
          'location': normalizedLocation,
          'branch_type': branchType,
        })
        .select('id')
        .single();
    await supabase.from('audit_logs').insert({
      'business_id': user.businessId,
      'actor_id': user.id,
      'entity_type': 'branch',
      'entity_id': created['id'],
      'action': 'created',
      'old_value': null,
      'new_value': {
        'name': normalizedName,
        'location': normalizedLocation,
        'branch_type': branchType,
      },
    });
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

  Future<void> adjustStock(
    RetivoxUser user, {
    required String stockId,
    required int quantity,
    required String operation,
  }) async {
    final supabase = await _requireOnlineRole(user, [
      RetivoxRole.owner,
      RetivoxRole.admin,
    ]);
    if (quantity <= 0 || !const ['add', 'remove'].contains(operation)) {
      throw const DashboardRepositoryException(
        'Enter a positive quantity and choose add or remove.',
      );
    }
    await supabase.rpc(
      'dashboard_adjust_stock',
      params: {
        'p_stock_id': stockId,
        'p_quantity': quantity,
        'p_operation': operation,
      },
    );
  }

  Future<void> setProductActive(
    RetivoxUser user, {
    required String productId,
    required bool isActive,
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    await supabase.rpc(
      'owner_toggle_product_status',
      params: {'p_product_id': productId, 'p_is_active': isActive},
    );
  }

  Future<void> updateStockThreshold(
    RetivoxUser user, {
    required String stockId,
    required String branchId,
    required int threshold,
  }) async {
    final supabase = await _requireOnlineRole(user, [
      RetivoxRole.owner,
      RetivoxRole.admin,
    ]);
    if (threshold < 0) {
      throw const DashboardRepositoryException(
        'Low-stock threshold cannot be negative.',
      );
    }
    await supabase.rpc(
      'dashboard_update_low_stock_threshold',
      params: {
        'p_stock_id': stockId,
        'p_branch_id': branchId,
        'p_threshold': threshold,
      },
    );
  }

  Future<void> recordCashDeposit(
    RetivoxUser user, {
    required String branchId,
    required DateTime depositDate,
    required double amount,
    required String reference,
    String note = '',
  }) async {
    final supabase = await _requireOnlineRole(user, [
      RetivoxRole.owner,
      RetivoxRole.admin,
    ]);
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
    await supabase.rpc(
      'record_branch_cash_deposit',
      params: {
        'p_branch_id': branchId,
        'p_deposit_date':
            '${depositDate.year.toString().padLeft(4, '0')}-'
            '${depositDate.month.toString().padLeft(2, '0')}-'
            '${depositDate.day.toString().padLeft(2, '0')}',
        'p_amount': amount,
        'p_deposit_reference': normalizedReference,
        'p_note': note.trim().isEmpty ? null : note.trim(),
      },
    );
  }

  Future<void> reviewCashDeposit(
    RetivoxUser user, {
    required String depositId,
    required String action,
    String reviewNote = '',
  }) async {
    final supabase = await _requireOnlineRole(user, [RetivoxRole.owner]);
    if (!const ['approve', 'reject'].contains(action) ||
        reviewNote.trim().length > 180) {
      throw const DashboardRepositoryException(
        'Choose an action and enter a review note of up to 180 characters.',
      );
    }
    await supabase.rpc(
      'owner_review_branch_cash_deposit',
      params: {
        'p_deposit_id': depositId,
        'p_action': action,
        'p_review_note': reviewNote.trim().isEmpty ? null : reviewNote.trim(),
      },
    );
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
    final authUser = await supabase.auth.getUser();
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
              'id, total_amount, discount_amount, recorded_at, branch_id, branches(name), transaction_items(product_id, line_total, line_discount_amount, net_line_total, line_cost, gross_profit, base_quantity, products(name, sku))',
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
            .eq('business_id', user.businessId)
            .gte('deposit_date', range.$3)
            .lte('deposit_date', range.$4);
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
    };
    await vault.cacheValue(user, cacheKey, [summary]);
    return DashboardSnapshot(
      section: 'finances',
      rows: [summary],
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

  Future<DashboardSnapshot> loadSection(
    RetivoxUser user,
    String section,
  ) async {
    final supabase = client;
    if (supabase != null) {
      try {
        final authUser = await supabase.auth.getUser();
        if (authUser.user?.id != user.id) {
          throw const DashboardRepositoryException(
            'Sign in online with this account to refresh dashboard data.',
          );
        }
        final rows = await _fetchSection(supabase, user, section);
        await vault.cacheValue(user, 'dashboard:$section', rows);
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
    return DashboardSnapshot(
      section: section,
      rows: cached.whereType<Map<String, dynamic>>().toList(),
      updatedAt: await vault.cachedValueUpdatedAt(user, 'dashboard:$section'),
      isCached: true,
    );
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
        return _normalizeRows(response);
      case 'products':
        final response = await supabase
            .from('products')
            .select(
              'id, name, sku, category, subcategory, brand_family, product_kind, unit, description, is_active, created_at, product_pricing(base_price, min_price, max_price)',
            )
            .eq('business_id', user.businessId)
            .isFilter('deleted_at', null)
            .order('name')
            .range(0, 499);
        return _normalizeRows(response);
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
                'id, to_branch_id, supplier_id, supplier_name, reference_code, status, requested_by, approved_by, acknowledged_by, created_at, delivered_at, branches!inner(name)',
              )
              .eq('business_id', user.businessId)
              .inFilter('to_branch_id', branchIds)
              .order('created_at', ascending: false)
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
                'id, delivery_id, product_id, quantity_expected, quantity_received, quantity_in_uom, base_quantity_received, unit_cost, total_cost, uom_id, products!inner(name, sku), units_of_measure(abbreviation, name)',
              )
              .eq('business_id', user.businessId)
              .inFilter('delivery_id', deliveryIds)
              .order('id'),
        );
        final itemsByDelivery = _groupRows(items, 'delivery_id');
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
