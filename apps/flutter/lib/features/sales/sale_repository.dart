import 'dart:async';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../core/auth/offline_account_vault.dart';
import '../../core/auth/retivox_user.dart';
import '../../core/database/app_database.dart';

class SaleProduct {
  const SaleProduct({
    required this.optionId,
    required this.productId,
    required this.name,
    required this.sku,
    required this.sellingPrice,
    required this.pricingMethod,
    required this.roundingRule,
    required this.pricingOptions,
    required this.uomOptions,
    required this.quantityOnHand,
    required this.quantityReserved,
    required this.baseQuantityOnHand,
    required this.baseQuantityReserved,
    required this.recoveryItemId,
    required this.stockSource,
  });

  final String optionId;
  final String productId;
  final String name;
  final String sku;
  final double sellingPrice;
  final String pricingMethod;
  final String roundingRule;
  final List<Map<String, dynamic>> pricingOptions;
  final List<Map<String, dynamic>> uomOptions;
  final double quantityOnHand;
  final double quantityReserved;
  final double baseQuantityOnHand;
  final double baseQuantityReserved;
  final String? recoveryItemId;
  final String stockSource;

  factory SaleProduct.fromJson(Map<String, dynamic> row) {
    final recoveryItemId = row['recovery_item_id'] as String?;
    final productId = row['product_id'] as String;
    return SaleProduct(
      optionId: recoveryItemId == null
          ? 'normal:$productId'
          : 'recovery:$recoveryItemId',
      productId: productId,
      name: row['name'] as String? ?? 'Product',
      sku: row['sku'] as String? ?? '',
      sellingPrice: _number(row['selling_price']),
      pricingMethod: row['pricing_method'] as String? ?? 'fixed_price',
      roundingRule: row['rounding_rule'] as String? ?? 'nearest_5',
      pricingOptions: _mapList(row['pricing_options']),
      uomOptions: _mapList(row['uom_options']),
      quantityOnHand: _number(row['quantity_on_hand']),
      quantityReserved: _number(row['quantity_reserved']),
      baseQuantityOnHand: _number(
        row['base_quantity_on_hand'] ?? row['quantity_on_hand'],
      ),
      baseQuantityReserved: _number(
        row['base_quantity_reserved'] ?? row['quantity_reserved'],
      ),
      recoveryItemId: recoveryItemId,
      stockSource: row['stock_source'] as String? ?? 'normal',
    );
  }

  Map<String, Object?> toJson() => {
    'option_id': optionId,
    'product_id': productId,
    'name': name,
    'sku': sku,
    'selling_price': sellingPrice,
    'pricing_method': pricingMethod,
    'rounding_rule': roundingRule,
    'pricing_options': pricingOptions,
    'uom_options': uomOptions,
    'quantity_on_hand': quantityOnHand,
    'quantity_reserved': quantityReserved,
    'base_quantity_on_hand': baseQuantityOnHand,
    'base_quantity_reserved': baseQuantityReserved,
    'recovery_item_id': recoveryItemId,
    'stock_source': stockSource,
  };

  factory SaleProduct.fromCachedJson(Map<String, dynamic> row) {
    final product = SaleProduct.fromJson({
      ...row,
      'recovery_item_id': row['recovery_item_id'],
    });
    return SaleProduct(
      optionId: row['option_id'] as String? ?? product.optionId,
      productId: product.productId,
      name: product.name,
      sku: product.sku,
      sellingPrice: product.sellingPrice,
      pricingMethod: product.pricingMethod,
      roundingRule: product.roundingRule,
      pricingOptions: product.pricingOptions,
      uomOptions: product.uomOptions,
      quantityOnHand: product.quantityOnHand,
      quantityReserved: product.quantityReserved,
      baseQuantityOnHand: product.baseQuantityOnHand,
      baseQuantityReserved: product.baseQuantityReserved,
      recoveryItemId: product.recoveryItemId,
      stockSource: product.stockSource,
    );
  }

  Map<String, dynamic>? get defaultSaleUom {
    for (final option in uomOptions) {
      if (option['isDefaultSaleUom'] == true) return option;
    }
    return uomOptions.isEmpty ? null : uomOptions.first;
  }

  double get availableBaseQuantity => baseQuantityOnHand - baseQuantityReserved;

  double? previewPrice(double quantity, Map<String, dynamic> uom) {
    final baseQuantity =
        quantity * _number(uom['conversionFactor'], fallback: 1);
    final selectedUomId = uom['id'] as String?;
    final options =
        pricingOptions.where((option) {
          final optionUomId = option['uomId'] as String?;
          return optionUomId == selectedUomId || optionUomId == null;
        }).toList()..sort(
          (first, second) =>
              _number(first['baseQuantity'])
                  .compareTo(_number(second['baseQuantity'])),
        );

    final exact = options
        .where(
          (option) =>
              (_number(option['baseQuantity']) - baseQuantity).abs() < 0.0001,
        )
        .toList();
    if (exact.isNotEmpty) return _number(exact.first['price']);
    if (pricingMethod == 'manual_quantity') return null;

    final basis = options
        .where((option) => _number(option['baseQuantity']) < baseQuantity)
        .toList();
    if (basis.isNotEmpty) {
      final option = basis.last;
      final amount =
          baseQuantity *
          _number(option['price']) /
          _number(option['baseQuantity']);
      return _roundPrice(amount, roundingRule);
    }
    return sellingPrice * quantity;
  }

  static List<Map<String, dynamic>> _mapList(Object? value) {
    if (value is! List) return const [];
    return value.whereType<Map<String, dynamic>>().toList();
  }

  static double _number(Object? value, {double fallback = 0}) {
    final parsed = double.tryParse(value?.toString() ?? '');
    return parsed != null && parsed.isFinite ? parsed : fallback;
  }

  static double _roundPrice(double value, String rule) {
    return switch (rule) {
      'none' => double.parse(value.toStringAsFixed(2)),
      'up_5' => (value / 5).ceil() * 5,
      'down_5' => (value / 5).floor() * 5,
      'nearest_10' => (value / 10).round() * 10,
      _ => (value / 5).round() * 5,
    };
  }
}

class LocalSale {
  const LocalSale({
    required this.localId,
    required this.branchId,
    required this.status,
    required this.recordedAt,
    required this.totalAmount,
    required this.items,
    required this.errorMessage,
    this.serverId,
  });

  final String localId;
  final String branchId;
  final String status;
  final String recordedAt;
  final double totalAmount;
  final List<Map<String, dynamic>> items;
  final String? errorMessage;
  final String? serverId;
}

class SaleRepository {
  SaleRepository({
    required this.database,
    required this.vault,
    required this.client,
  });

  final AppDatabase database;
  final OfflineAccountVault vault;
  final SupabaseClient? client;
  final Map<String, Future<void>> _activeSyncs = {};

  Future<DateTime?> productCatalogUpdatedAt(
    RetivoxUser user,
    String branchId,
  ) => vault.cachedValueUpdatedAt(user, 'sale-products:$branchId');

  Future<List<SaleProduct>> loadProducts(
    RetivoxUser user,
    String branchId,
  ) async {
    final supabase = client;
    if (supabase != null) {
      try {
        final response = await supabase.rpc(
          'employee_available_products',
          params: {'p_branch_id': branchId},
        );
        if (response is! List) {
          throw const SaleRepositoryException(
            'The server returned an invalid product list.',
          );
        }
        final rows = response
            .whereType<Map<String, dynamic>>()
            .map(SaleProduct.fromJson)
            .toList();
        await vault.cacheValue(
          user,
          'sale-products:$branchId',
          rows.map((row) => row.toJson()).toList(),
        );
        return rows;
      } on SocketException {
        return _cachedProducts(user, branchId);
      } on TimeoutException {
        return _cachedProducts(user, branchId);
      } catch (error) {
        if (_isNetworkError(error)) return _cachedProducts(user, branchId);
        rethrow;
      }
    }
    return _cachedProducts(user, branchId);
  }

  Future<List<SaleProduct>> _cachedProducts(
    RetivoxUser user,
    String branchId,
  ) async {
    final cached = await vault.readCachedValue<List<dynamic>>(
      user,
      'sale-products:$branchId',
    );
    if (cached == null) {
      throw const SaleRepositoryException(
        'No product data is cached for this branch. Connect to the internet to refresh it before recording a sale.',
      );
    }
    return cached
        .whereType<Map<String, dynamic>>()
        .map(SaleProduct.fromCachedJson)
        .toList();
  }

  Future<String> recordSale({
    required RetivoxUser user,
    required String branchId,
    required List<Map<String, dynamic>> items,
    required String paymentMethod,
    required String mpesaReference,
    required double previewTotal,
  }) async {
    if (items.isEmpty) {
      throw const SaleRepositoryException('Add at least one product.');
    }
    if (paymentMethod == 'mpesa_manual' && mpesaReference.trim().length < 5) {
      throw const SaleRepositoryException(
        'Enter a valid M-Pesa reference code.',
      );
    }
    if (!user.branches.any((branch) => branch.id == branchId)) {
      throw const SaleRepositoryException(
        'This account does not have saved access to that branch.',
      );
    }

    const uuid = Uuid();
    final localId = uuid.v4();
    final recordedAt = DateTime.now().toUtc().toIso8601String();
    final payload = <String, dynamic>{
      'role': user.role.name,
      'branchId': branchId,
      'items': items,
      'paymentMethod': paymentMethod,
      'discountAmount': 0,
      'customerName': null,
      'customerPhone': null,
      'mpesaRefCode': paymentMethod == 'mpesa_manual'
          ? mpesaReference.trim()
          : null,
      'cashDepositCode': null,
      'recordedAt': recordedAt,
      'previewTotal': previewTotal,
    };
    final encrypted = await vault.encryptForAccount(user.id, payload);
    await database.enqueueSale(
      localId: localId,
      accountId: user.id,
      branchId: branchId,
      encryptedPayload: encrypted,
      recordedAt: recordedAt,
    );
    try {
      await syncPending(user);
    } catch (error) {
      await database.updateSale(
        localId: localId,
        status: 'pending_sync',
        errorMessage: 'Saved locally; sync could not complete: $error',
      );
    }
    return localId;
  }

  Future<void> syncPending(RetivoxUser user) {
    final activeSync = _activeSyncs[user.id];
    if (activeSync != null) return activeSync;
    late final Future<void> sync;
    sync = _syncWithLease(user).whenComplete(() {
      if (identical(_activeSyncs[user.id], sync)) {
        _activeSyncs.remove(user.id);
      }
    });
    _activeSyncs[user.id] = sync;
    return sync;
  }

  Future<void> _syncWithLease(RetivoxUser user) async {
    final ownerId = const Uuid().v4();
    final acquired = await database.tryAcquireSaleSyncLock(
      accountId: user.id,
      ownerId: ownerId,
      expiresAt: DateTime.now().toUtc().add(const Duration(minutes: 30)),
    );
    if (!acquired) return;
    try {
      await _syncPending(user);
    } finally {
      await database.releaseSaleSyncLock(accountId: user.id, ownerId: ownerId);
    }
  }

  Future<void> _syncPending(RetivoxUser user) async {
    final supabase = client;
    if (supabase == null) return;
    final pending = await database.pendingSales(user.id);
    if (pending.isEmpty) return;

    try {
      final response = await supabase.auth.getUser();
      if (response.user?.id != user.id) {
        for (final row in pending) {
          await database.updateSale(
            localId: row.read<String>('local_id'),
            status: 'pending_sync',
            errorMessage:
                'Sign in online with this account to sync its saved sales.',
          );
        }
        return;
      }
    } catch (error) {
      for (final row in pending) {
        await database.updateSale(
          localId: row.read<String>('local_id'),
          status: 'pending_sync',
          errorMessage: error.toString(),
        );
      }
      return;
    }

    for (final row in pending) {
      final localId = row.read<String>('local_id');
      await database.updateSale(localId: localId, status: 'syncing');
      try {
        final payload = await vault.decryptForAccount(
          user.id,
          row.read<String>('encrypted_payload'),
        );
        final args = _rpcArguments(payload, localId);
        final rpc = user.role == RetivoxRole.employee
            ? 'employee_record_transaction_offline'
            : 'dashboard_record_transaction_offline';
        final result = await supabase.rpc(rpc, params: args);
        final resultRow = result is List ? result.firstOrNull : result;
        if (resultRow is! Map<String, dynamic> ||
            resultRow['transaction_id'] is! String) {
          throw const SaleRepositoryException(
            'The server did not acknowledge this sale.',
          );
        }
        final confirmedTotal = double.tryParse(
          resultRow['total_amount']?.toString() ?? '',
        );
        if (confirmedTotal == null ||
            !confirmedTotal.isFinite ||
            confirmedTotal < 0) {
          throw const SaleRepositoryException(
            'The server returned an invalid sale total.',
          );
        }
        final updatedPayload = await vault.decryptForAccount(
          user.id,
          row.read<String>('encrypted_payload'),
        );
        updatedPayload['previewTotal'] = confirmedTotal;
        await database.replaceSalePayload(
          localId,
          await vault.encryptForAccount(user.id, updatedPayload),
        );
        await database.updateSale(
          localId: localId,
          status: 'synced',
          serverId: resultRow['transaction_id'] as String,
        );
      } on PostgrestException catch (error) {
        await database.updateSale(
          localId: localId,
          status: 'needs_correction',
          errorMessage: error.message,
        );
      } on SocketException {
        await database.updateSale(localId: localId, status: 'pending_sync');
        return;
      } on TimeoutException {
        await database.updateSale(localId: localId, status: 'pending_sync');
        return;
      } catch (error) {
        if (_isNetworkError(error)) {
          await database.updateSale(
            localId: localId,
            status: 'pending_sync',
            errorMessage: error.toString(),
          );
          return;
        }
        await database.updateSale(
          localId: localId,
          status: 'needs_correction',
          errorMessage: error.toString(),
        );
      }
    }
  }

  Future<void> correctSale(
    String localId,
    String accountId,
    List<Map<String, dynamic>> items,
  ) async {
    if (items.isEmpty) {
      throw const SaleRepositoryException(
        'Keep at least one product or cancel the sale.',
      );
    }
    final sales = await database.salesForAccount(accountId);
    final row = sales
        .where((sale) => sale.read<String>('local_id') == localId)
        .firstOrNull;
    if (row == null) {
      throw const SaleRepositoryException('The saved sale could not be found.');
    }
    if (row.read<String>('status') != 'needs_correction') {
      throw const SaleRepositoryException(
        'Only a sale requiring correction can be edited.',
      );
    }
    final payload = await vault.decryptForAccount(
      accountId,
      row.read<String>('encrypted_payload'),
    );
    payload['items'] = items;
    payload['previewTotal'] = items.fold<double>(
      0,
      (total, item) => total + SaleProduct._number(item['previewLineTotal']),
    );
    await database.replaceSalePayload(
      localId,
      await vault.encryptForAccount(accountId, payload),
    );
    await database.updateSale(localId: localId, status: 'pending_sync');
  }

  Future<void> cancelSale(String localId) =>
      database.updateSale(localId: localId, status: 'cancelled');

  Future<List<LocalSale>> listSales(String accountId) async {
    final rows = await database.salesForAccount(accountId);
    final sales = <LocalSale>[];
    for (final row in rows) {
      final payload = await vault.decryptForAccount(
        accountId,
        row.read<String>('encrypted_payload'),
      );
      sales.add(
        LocalSale(
          localId: row.read<String>('local_id'),
          branchId: row.read<String>('branch_id'),
          status: row.read<String>('status'),
          recordedAt: row.read<String>('recorded_at'),
          totalAmount: SaleProduct._number(payload['previewTotal']),
          items: (payload['items'] as List? ?? const [])
              .whereType<Map<String, dynamic>>()
              .toList(),
          errorMessage: row.readNullable<String>('error_message'),
          serverId: row.readNullable<String>('server_id'),
        ),
      );
    }
    return sales;
  }

  Map<String, dynamic> _rpcArguments(
    Map<String, dynamic> payload,
    String localId,
  ) {
    final recordedAt = payload['recordedAt'] as String;
    final items = payload['items'];
    if (items is! List || items.isEmpty) {
      throw const SaleRepositoryException(
        'The saved sale has no valid line items.',
      );
    }
    final common = <String, dynamic>{
      'p_items': items,
      'p_payment_method': payload['paymentMethod'],
      'p_discount_amount': payload['discountAmount'],
      'p_customer_name': payload['customerName'],
      'p_customer_phone': payload['customerPhone'],
      'p_mpesa_ref_code': payload['mpesaRefCode'],
      'p_cash_deposit_code': payload['cashDepositCode'],
      'p_recorded_at': recordedAt,
      'p_local_id': localId,
    };
    if (payload['role'] == RetivoxRole.employee.name) return common;
    return {'p_branch_id': payload['branchId'], ...common};
  }

  bool _isNetworkError(Object error) {
    final message = error.toString().toLowerCase();
    return error is SocketException ||
        error is TimeoutException ||
        message.contains('failed host lookup') ||
        message.contains('socketexception') ||
        message.contains('clientexception') ||
        message.contains('network is unreachable') ||
        message.contains('connection refused') ||
        message.contains('connection reset') ||
        message.contains('connection timed out');
  }
}

class SaleRepositoryException implements Exception {
  const SaleRepositoryException(this.message);

  final String message;

  @override
  String toString() => message;
}
