import 'dart:async';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../core/auth/offline_account_vault.dart';
import '../../core/auth/retivox_user.dart';
import '../../core/database/app_database.dart';
import '../../core/network/backend_health_check.dart';

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
    this.barcodes = const [],
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
  final List<String> barcodes;

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
      barcodes: (row['barcodes'] as List? ?? const [])
          .map((value) => value.toString())
          .toList(),
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
    'barcodes': barcodes,
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
      barcodes: product.barcodes,
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

/// Resolves a barcode against the locally loaded catalog. Keep this lookup
/// independent of Supabase so camera and keyboard scans continue working
/// while the device is offline.
SaleProduct? findSaleProductByBarcode(
  Iterable<SaleProduct> products,
  String barcode,
) {
  final normalized = barcode.trim().toUpperCase();
  if (normalized.isEmpty) return null;
  for (final product in products) {
    if (product.barcodes.any(
      (candidate) => candidate.trim().toUpperCase() == normalized,
    )) {
      return product;
    }
  }
  return null;
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
    this.payloadReadable = true,
    this.serverId,
    this.paymentMethod = 'cash',
    this.mpesaReference,
  });

  final String localId;
  final String branchId;
  final String status;
  final String recordedAt;
  final double totalAmount;
  final List<Map<String, dynamic>> items;
  final String? errorMessage;
  final bool payloadReadable;
  final String? serverId;
  final String paymentMethod;
  final String? mpesaReference;

  String get receiptNumber {
    final compact = localId
        .replaceAll(RegExp(r'[^a-fA-F0-9]'), '')
        .toUpperCase();
    final suffix = compact.length >= 16
        ? compact.substring(0, 16)
        : localId
              .toUpperCase()
              .replaceAll(RegExp(r'[^A-Z0-9]'), '')
              .padRight(16, '0')
              .substring(0, 16);
    return 'RVX-$suffix';
  }
}

class SaleRepository {
  SaleRepository({
    required this.database,
    required this.vault,
    required this.client,
    required this.backendHealthCheck,
  });

  final AppDatabase database;
  final OfflineAccountVault vault;
  final SupabaseClient? client;
  final BackendHealthCheck backendHealthCheck;
  final Map<String, Future<void>> _activeSyncs = {};

  Future<bool> isBackendReachable() =>
      client != null && backendHealthCheck.isConfigured
      ? backendHealthCheck.isReachable()
      : Future.value(false);

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
        final rawRows = response.whereType<Map<String, dynamic>>().toList();
        final productIds = rawRows
            .map((row) => row['product_id']?.toString())
            .whereType<String>()
            .toSet()
            .toList();
        final rawBarcodeRows = productIds.isEmpty
            ? const <dynamic>[]
            : await supabase
                  .from('product_barcodes')
                  .select('product_id, code')
                  .eq('business_id', user.businessId)
                  .eq('is_active', true)
                  .inFilter('product_id', productIds);
        final barcodeRows = rawBarcodeRows
            .whereType<Map>()
            .map(Map<String, dynamic>.from)
            .toList();
        final barcodesByProduct = <String, List<String>>{};
        for (final barcode in barcodeRows) {
          final productId = barcode['product_id']?.toString();
          final code = barcode['code']?.toString();
          if (productId != null && code != null) {
            (barcodesByProduct[productId] ??= <String>[]).add(code);
          }
        }
        final rows = rawRows
            .map(
              (row) => SaleProduct.fromJson({
                ...row,
                'barcodes':
                    barcodesByProduct[row['product_id']?.toString()] ??
                    const <String>[],
              }),
            )
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
    double? amountPaid,
    double? amountTendered,
    bool isCredit = false,
    String? customerName,
    String? customerPhone,
    String? customerEmail,
    String? dueDate,
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
      'amountPaid': isCredit ? (amountPaid ?? 0) : null,
      'amountTendered': amountTendered,
      'isCredit': isCredit,
      'discountAmount': 0,
      'customerName': customerName,
      'customerPhone': customerPhone,
      'customerEmail': customerEmail,
      'dueDate': _optionalString(dueDate),
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
        accountId: user.id,
        localId: localId,
        status: 'pending_sync',
        errorMessage: 'Saved locally; sync could not complete: $error',
      );
    }
    return localId;
  }

  Future<void> syncPending(RetivoxUser user, {String? localId}) {
    final activeSync = _activeSyncs[user.id];
    if (activeSync != null) return activeSync;
    late final Future<void> sync;
    sync = _syncWithLease(user, localId: localId).whenComplete(() {
      if (identical(_activeSyncs[user.id], sync)) {
        _activeSyncs.remove(user.id);
      }
    });
    _activeSyncs[user.id] = sync;
    return sync;
  }

  Future<void> _syncWithLease(RetivoxUser user, {String? localId}) async {
    final ownerId = const Uuid().v4();
    final acquired = await database.tryAcquireSaleSyncLock(
      accountId: user.id,
      ownerId: ownerId,
      expiresAt: DateTime.now().toUtc().add(const Duration(minutes: 30)),
    );
    if (!acquired) return;
    try {
      await _syncPending(user, localId: localId);
    } finally {
      await database.releaseSaleSyncLock(accountId: user.id, ownerId: ownerId);
    }
  }

  Future<void> _syncPending(RetivoxUser user, {String? localId}) async {
    final supabase = client;
    if (supabase == null) return;

    // Repair only known cash-only failures from older desktop builds: blank
    // date casts and the retired requirement for a per-sale deposit code.
    await _retryKnownLegacyCashFailures(user);

    final pending = await database.pendingSales(user.id, localId: localId);
    if (pending.isEmpty) return;

    try {
      final response = await supabase.auth.getUser();
      if (response.user?.id != user.id) {
        for (final row in pending) {
          await database.updateSale(
            accountId: user.id,
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
          accountId: user.id,
          localId: row.read<String>('local_id'),
          status: 'pending_sync',
          errorMessage: error.toString(),
        );
      }
      return;
    }

    for (final row in pending) {
      final localId = row.read<String>('local_id');
      await database.updateSale(
        accountId: user.id,
        localId: localId,
        status: 'syncing',
      );
      try {
        final payload = await vault.decryptForAccount(
          user.id,
          row.read<String>('encrypted_payload'),
        );
        final args = _rpcArguments(payload, localId);
        final rpc = user.role == RetivoxRole.employee
            ? 'employee_record_transaction_offline_v2'
            : 'dashboard_record_transaction_offline_v2';
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
          accountId: user.id,
          localId: localId,
          encryptedPayload: await vault.encryptForAccount(
            user.id,
            updatedPayload,
          ),
        );
        await database.updateSale(
          accountId: user.id,
          localId: localId,
          status: 'synced',
          serverId: resultRow['transaction_id'] as String,
        );
      } on PostgrestException catch (error) {
        await database.updateSale(
          accountId: user.id,
          localId: localId,
          status: 'needs_correction',
          errorMessage: error.message,
        );
      } on SocketException {
        await database.updateSale(
          accountId: user.id,
          localId: localId,
          status: 'pending_sync',
        );
        return;
      } on TimeoutException {
        await database.updateSale(
          accountId: user.id,
          localId: localId,
          status: 'pending_sync',
        );
        return;
      } catch (error) {
        if (_isNetworkError(error)) {
          await database.updateSale(
            accountId: user.id,
            localId: localId,
            status: 'pending_sync',
            errorMessage: error.toString(),
          );
          return;
        }
        await database.updateSale(
          accountId: user.id,
          localId: localId,
          status: 'needs_correction',
          errorMessage: error.toString(),
        );
      }
    }
  }

  Future<void> _retryKnownLegacyCashFailures(RetivoxUser user) async {
    final failed = await database.cashSalesNeedingLegacyRetry(user.id);
    for (final row in failed) {
      final localId = row.read<String>('local_id');
      try {
        final payload = await vault.decryptForAccount(
          user.id,
          row.read<String>('encrypted_payload'),
        );
        final dueDate = payload['dueDate']?.toString().trim() ?? '';
        final message =
            row.readNullable<String>('error_message')?.toLowerCase() ?? '';
        final isEmptyDateError = message.contains(
          'invalid input syntax for type date',
        );
        final isObsoleteCashCodeError = message.contains(
          'cash deposit/reference code',
        );
        final isAmbiguousTransactionIdError =
            message.contains('transaction_id') && message.contains('ambiguous');
        if (payload['paymentMethod'] != 'cash' ||
            payload['isCredit'] == true ||
            (!isObsoleteCashCodeError &&
                !isAmbiguousTransactionIdError &&
                !(isEmptyDateError && dueDate.isEmpty))) {
          continue;
        }
        if (dueDate.isEmpty) payload['dueDate'] = null;
        await database.replaceSalePayload(
          accountId: user.id,
          localId: localId,
          encryptedPayload: await vault.encryptForAccount(user.id, payload),
        );
        await database.updateSale(
          accountId: user.id,
          localId: localId,
          status: 'pending_sync',
        );
      } catch (_) {
        // Leave the failed record visible for correction if it cannot be
        // decrypted or safely repaired.
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
      accountId: accountId,
      localId: localId,
      encryptedPayload: await vault.encryptForAccount(accountId, payload),
    );
    await database.updateSale(
      accountId: accountId,
      localId: localId,
      status: 'pending_sync',
      errorMessage: null,
    );
  }

  Future<void> retrySale(RetivoxUser user, String localId) async {
    final rows = await database.salesForAccount(user.id);
    final row = rows
        .where((sale) => sale.read<String>('local_id') == localId)
        .firstOrNull;
    if (row == null) {
      throw const SaleRepositoryException('The saved sale could not be found.');
    }
    final status = row.read<String>('status');
    if (status == 'synced' || status == 'cancelled') {
      throw const SaleRepositoryException(
        'Only an unsynced sale can be retried.',
      );
    }

    try {
      await vault.decryptForAccount(
        user.id,
        row.read<String>('encrypted_payload'),
      );
    } catch (error) {
      final message =
          'This local sale could not be authenticated and is still preserved. '
          'It cannot sync until its saved data is recovered. You can cancel it.';
      await database.updateSale(
        accountId: user.id,
        localId: localId,
        status: 'needs_correction',
        errorMessage: message,
      );
      throw SaleRepositoryException(message);
    }

    await database.updateSale(
      accountId: user.id,
      localId: localId,
      status: 'pending_sync',
      errorMessage: null,
    );
    await syncPending(user, localId: localId);
  }

  Future<bool> cancelSale(String accountId, String localId) =>
      database.cancelPendingSale(accountId: accountId, localId: localId);

  Future<List<LocalSale>> listSales(String accountId) async {
    final rows = await database.salesForAccount(accountId);
    return _decodeSales(rows, accountId);
  }

  Future<List<LocalSale>> listPendingSales(String accountId) async {
    final rows = await database.actionableSales(accountId);
    return _decodeSales(rows, accountId);
  }

  Future<List<LocalSale>> _decodeSales(dynamic rows, String accountId) async {
    final sales = <LocalSale>[];
    for (final row in rows) {
      final localId = row.read<String>('local_id');
      final branchId = row.read<String>('branch_id');
      final status = row.read<String>('status');
      final recordedAt = row.read<String>('recorded_at');
      try {
        final payload = await vault.decryptForAccount(
          accountId,
          row.read<String>('encrypted_payload'),
        );
        sales.add(
          LocalSale(
            localId: localId,
            branchId: branchId,
            status: status,
            recordedAt: recordedAt,
            totalAmount: SaleProduct._number(payload['previewTotal']),
            items: (payload['items'] as List? ?? const [])
                .whereType<Map<String, dynamic>>()
                .toList(),
            errorMessage: row.readNullable<String>('error_message'),
            serverId: row.readNullable<String>('server_id'),
            paymentMethod: payload['paymentMethod']?.toString() ?? 'cash',
            mpesaReference: payload['mpesaRefCode']?.toString(),
          ),
        );
      } catch (error) {
        // A single damaged local row must never hide the rest of an account's
        // sales or prevent the POS screen from opening. Keep its identifiers
        // and status so staff can safely cancel it without decrypting it.
        sales.add(
          LocalSale(
            localId: localId,
            branchId: branchId,
            status: status,
            recordedAt: recordedAt,
            totalAmount: 0,
            items: const [],
            errorMessage: error.toString(),
            serverId: row.readNullable<String>('server_id'),
            paymentMethod: 'unknown',
            payloadReadable: false,
          ),
        );
      }
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
      'p_amount_paid': payload['amountPaid'],
      'p_amount_tendered': payload['amountTendered'],
      'p_customer_email': payload['customerEmail'],
      'p_due_date': _optionalString(payload['dueDate']),
      'p_is_credit': payload['isCredit'] ?? false,
      'p_discount_amount': payload['discountAmount'],
      'p_customer_name': payload['customerName'],
      'p_customer_phone': payload['customerPhone'],
      'p_reference_code': payload['mpesaRefCode'],
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

  String? _optionalString(Object? value) {
    final normalized = value?.toString().trim();
    return normalized == null || normalized.isEmpty ? null : normalized;
  }
}

class SaleRepositoryException implements Exception {
  const SaleRepositoryException(this.message);

  final String message;

  @override
  String toString() => message;
}
