import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cryptography/cryptography.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../../core/auth/offline_account_vault.dart';
import '../../core/auth/retivox_user.dart';
import '../../core/database/app_database.dart';
import '../../core/network/backend_health_check.dart';
import '../dashboard/barcode_similarity.dart';

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

/// Applies locally recorded sales to a server catalog snapshot without
/// changing the saved server baseline. This keeps offline stock deterministic
/// across retries and process restarts.
List<Map<String, dynamic>> applyLocalSaleQuantities(
  List<Map<String, dynamic>> serverRows,
  Iterable<Map<String, dynamic>> salePayloads,
) {
  final remaining = serverRows
      .map((row) => Map<String, dynamic>.from(row))
      .toList();
  final deductions = <String, double>{};
  for (final sale in salePayloads) {
    final items = sale['items'];
    if (items is! List) continue;
    for (final rawItem in items.whereType<Map>()) {
      final item = Map<String, dynamic>.from(rawItem);
      final snapshot = item['productSnapshot'];
      final product = snapshot is Map
          ? Map<String, dynamic>.from(snapshot)
          : const <String, dynamic>{};
      final productId = item['productId']?.toString();
      final recoveryId = item['recoveryItemId']?.toString();
      final optionId =
          product['option_id']?.toString() ??
          (recoveryId == null || recoveryId.isEmpty
              ? (productId == null ? null : 'normal:$productId')
              : 'recovery:$recoveryId');
      if (optionId == null) continue;
      final uomRaw = item['uomSnapshot'];
      final uom = uomRaw is Map
          ? Map<String, dynamic>.from(uomRaw)
          : const <String, dynamic>{};
      final quantity = SaleProduct._number(item['quantity']);
      final conversion = SaleProduct._number(
        uom['conversionFactor'] ?? uom['conversion_factor'],
        fallback: 1,
      );
      if (quantity <= 0 || conversion <= 0) continue;
      deductions[optionId] =
          (deductions[optionId] ?? 0) + quantity * conversion;
    }
  }
  if (deductions.isEmpty) return remaining;
  return remaining.map((row) {
    final optionId = row['option_id']?.toString();
    final deduction = optionId == null ? null : deductions[optionId];
    if (deduction == null || deduction <= 0) return row;
    final onHand = SaleProduct._number(
      row['base_quantity_on_hand'] ?? row['quantity_on_hand'],
    );
    final next = (onHand - deduction).clamp(0, double.infinity).toDouble();
    return {...row, 'quantity_on_hand': next, 'base_quantity_on_hand': next};
  }).toList();
}

List<Map<String, dynamic>> applyLocalStockAdjustments(
  List<Map<String, dynamic>> serverRows, {
  required List<dynamic> cachedStockRows,
  required List<dynamic> pendingActions,
  required String branchId,
}) {
  final stockById = <String, Map<String, dynamic>>{};
  for (final raw in cachedStockRows.whereType<Map>()) {
    final stock = Map<String, dynamic>.from(raw);
    final id = stock['id']?.toString();
    if (id != null) stockById[id] = stock;
  }
  final adjustments = <String, double>{};
  for (final rawAction in pendingActions.whereType<Map>()) {
    final action = Map<String, dynamic>.from(rawAction);
    if (action['type'] != 'adjust_stock' ||
        (action['error']?.toString().trim().isNotEmpty ?? false)) {
      continue;
    }
    final payload = Map<String, dynamic>.from(action['payload'] as Map? ?? {});
    final stock = stockById[payload['stock_id']?.toString()];
    if (stock == null || stock['branch_id']?.toString() != branchId) continue;
    final productId = stock['product_id']?.toString();
    if (productId == null) continue;
    final quantity = SaleProduct._number(payload['quantity']);
    final delta = payload['operation'] == 'add' ? quantity : -quantity;
    adjustments[productId] = (adjustments[productId] ?? 0) + delta;
  }
  if (adjustments.isEmpty) {
    return serverRows.map((row) => Map<String, dynamic>.from(row)).toList();
  }
  return serverRows.map((original) {
    final row = Map<String, dynamic>.from(original);
    final delta = adjustments[row['product_id']?.toString()];
    if (delta == null || row['recovery_item_id'] != null) return row;
    final onHand = SaleProduct._number(
      row['base_quantity_on_hand'] ?? row['quantity_on_hand'],
    );
    final next = (onHand + delta).clamp(0, double.infinity).toDouble();
    return {...row, 'quantity_on_hand': next, 'base_quantity_on_hand': next};
  }).toList();
}

List<Map<String, dynamic>> applyLocalSupplierReceipts(
  List<Map<String, dynamic>> serverRows, {
  required List<dynamic> cachedTransferOptions,
  required List<dynamic> cachedDeliveries,
  required List<dynamic> pendingActions,
  required String branchId,
  required bool ownerCanReceiveImmediately,
}) {
  final options = cachedTransferOptions
      .whereType<Map>()
      .map(Map<String, dynamic>.from)
      .firstOrNull;
  final products = (options?['products'] as List? ?? const [])
      .whereType<Map>()
      .map(Map<String, dynamic>.from)
      .toList();
  final unitFactors = <String, Map<String, double>>{};
  for (final product in products) {
    final productId = product['id']?.toString();
    if (productId == null) continue;
    unitFactors[productId] = {
      for (final rawUnit
          in (product['uom_options'] as List? ?? const []).whereType<Map>())
        if (rawUnit['id'] != null)
          rawUnit['id'].toString(): SaleProduct._number(
            rawUnit['conversion_factor'],
            fallback: 1,
          ),
    };
  }
  final deliveries = cachedDeliveries
      .whereType<Map>()
      .map(Map<String, dynamic>.from)
      .toList();
  final additions = <String, double>{};
  for (final rawAction in pendingActions.whereType<Map>()) {
    final action = Map<String, dynamic>.from(rawAction);
    if ((action['error']?.toString().trim().isNotEmpty ?? false)) {
      continue;
    }
    final payload = Map<String, dynamic>.from(action['payload'] as Map? ?? {});
    if (action['type'] == 'record_supplier_delivery' &&
        ownerCanReceiveImmediately &&
        payload['branch_id']?.toString() == branchId) {
      for (final rawItem
          in (payload['items'] as List? ?? const []).whereType<Map>()) {
        final item = Map<String, dynamic>.from(rawItem);
        final productId = item['productId']?.toString();
        final uomId = item['uomId']?.toString();
        final factor = productId == null || uomId == null
            ? null
            : unitFactors[productId]?[uomId];
        final quantity = SaleProduct._number(item['quantity']);
        if (productId == null ||
            factor == null ||
            quantity <= 0 ||
            factor <= 0) {
          continue;
        }
        additions[productId] = (additions[productId] ?? 0) + quantity * factor;
      }
    } else if (action['type'] == 'acknowledge_supplier_delivery') {
      final delivery = deliveries
          .where(
            (row) =>
                row['id']?.toString() == payload['delivery_id']?.toString(),
          )
          .firstOrNull;
      if (delivery == null ||
          delivery['to_branch_id']?.toString() != branchId) {
        continue;
      }
      for (final rawItem
          in (delivery['items'] as List? ?? const []).whereType<Map>()) {
        final item = Map<String, dynamic>.from(rawItem);
        final productId = item['product_id']?.toString();
        final baseQuantity = SaleProduct._number(
          item['base_quantity_expected'] ?? item['base_quantity_received'],
        );
        if (productId == null || baseQuantity <= 0) continue;
        additions[productId] = (additions[productId] ?? 0) + baseQuantity;
      }
    }
  }
  return serverRows.map((original) {
    final row = Map<String, dynamic>.from(original);
    final addition = additions[row['product_id']?.toString()];
    if (addition == null || row['recovery_item_id'] != null) return row;
    final onHand = SaleProduct._number(
      row['base_quantity_on_hand'] ?? row['quantity_on_hand'],
    );
    final next = onHand + addition;
    return {...row, 'quantity_on_hand': next, 'base_quantity_on_hand': next};
  }).toList();
}

/// Applies queued edits to products already present in the branch-scoped POS
/// catalog. A locally-created product is deliberately not added here: it has
/// no server product ID or server branch-stock row until the existing create
/// and stock workflows synchronize.
List<Map<String, dynamic>> applyPendingProductCatalogActions(
  List<Map<String, dynamic>> catalogRows, {
  required List<dynamic> pendingActions,
  required List<dynamic> cachedUnits,
  required String branchId,
}) {
  var rows = catalogRows.map((row) => Map<String, dynamic>.from(row)).toList();
  final unavailableOptions = <String>{};
  final activeByProduct = <String, bool>{};
  final unitsById = {
    for (final raw in cachedUnits.whereType<Map>())
      if (raw['id'] != null)
        raw['id'].toString(): Map<String, dynamic>.from(raw),
  };

  for (final rawAction in pendingActions.whereType<Map>()) {
    final action = Map<String, dynamic>.from(rawAction);
    if ((action['error']?.toString().trim().isNotEmpty ?? false)) continue;
    final type = action['type']?.toString();
    final payload = Map<String, dynamic>.from(action['payload'] as Map? ?? {});
    if (type == 'create_product') {
      // The queued product still has a temporary local ID. Sale payloads and
      // the existing server RPC require the server UUID, so keep it out of POS.
      continue;
    }
    if (type == 'set_product_active') {
      final productId = payload['product_id']?.toString();
      if (productId != null) {
        activeByProduct[productId] = payload['is_active'] == true;
      }
      continue;
    }
    if (type != 'update_product') continue;

    final productId = payload['product_id']?.toString();
    if (productId == null || productId.isEmpty) continue;
    for (var index = 0; index < rows.length; index++) {
      final row = rows[index];
      if (row['product_id']?.toString() != productId) continue;
      final optionId = row['option_id']?.toString();
      if (row['recovery_item_id'] != null) {
        // Recovery inventory keeps its batch price and UOM. Product identity
        // and barcode metadata still follow the queued product edit.
        rows[index] = {
          ...row,
          'name': payload['name']?.toString() ?? row['name'],
          'sku': payload['sku']?.toString() ?? row['sku'],
          'barcodes': _stringValues(payload['barcodes']),
        };
        continue;
      }
      final updated = _saleRowForPendingProductEdit(
        row,
        payload,
        unitsById,
        branchId,
      );
      if (updated == null) {
        if (optionId != null) unavailableOptions.add(optionId);
      } else {
        rows[index] = updated;
        if (optionId != null) unavailableOptions.remove(optionId);
      }
    }
  }

  return rows.where((row) {
    final optionId = row['option_id']?.toString();
    final productId = row['product_id']?.toString();
    return (optionId == null || !unavailableOptions.contains(optionId)) &&
        (productId == null || activeByProduct[productId] != false);
  }).toList();
}

Map<String, dynamic>? _saleRowForPendingProductEdit(
  Map<String, dynamic> current,
  Map<String, dynamic> payload,
  Map<String, Map<String, dynamic>> unitsById,
  String branchId,
) {
  final scopedBranches = _stringValues(payload['pricing_branch_ids']);
  if (scopedBranches.isNotEmpty && !scopedBranches.contains(branchId)) {
    return null;
  }

  final saleUnitIds = _stringValues(payload['sale_unit_ids']);
  final defaultSaleUnitId = payload['default_sale_unit_id']?.toString();
  if (saleUnitIds.isEmpty ||
      defaultSaleUnitId == null ||
      !saleUnitIds.contains(defaultSaleUnitId)) {
    return null;
  }

  final uomOptions = <Map<String, dynamic>>[];
  final conversionByUnit = <String, double>{};
  for (final id in saleUnitIds) {
    final unit = unitsById[id];
    final conversion = SaleProduct._number(unit?['conversion_factor']);
    if (unit == null ||
        unit['is_active'] == false ||
        !conversion.isFinite ||
        conversion <= 0) {
      return null;
    }
    conversionByUnit[id] = conversion;
    uomOptions.add({
      'id': id,
      'name': unit['name'],
      'abbreviation': unit['abbreviation'],
      'conversionFactor': conversion,
      'isBaseUnit': unit['is_base_unit'] == true,
      'isBaseUom': (conversion - 1).abs() < 0.0001,
      'isDefaultSaleUom': id == defaultSaleUnitId,
      'isDefaultPurchaseUom':
          id == payload['default_purchase_unit_id']?.toString(),
    });
  }

  final rawMethod = payload['pricing_method']?.toString() ?? 'fixed_price';
  if (!const [
    'fixed_price',
    'assisted_pack',
    'manual_quantity',
  ].contains(rawMethod)) {
    return null;
  }
  final usesAssistedPacks =
      rawMethod == 'fixed_price' && saleUnitIds.length > 1;
  final modelMethod = usesAssistedPacks ? 'assisted_pack' : rawMethod;
  final modelRounding = usesAssistedPacks
      ? 'none'
      : (payload['rounding_rule']?.toString() ?? 'nearest_5');
  final salePrices = payload['sale_prices'] as Map? ?? const {};
  final rawPricePoints = (payload['price_points'] as List? ?? const [])
      .whereType<Map>()
      .map(Map<String, dynamic>.from)
      .toList();
  final pricePointsByKey = <String, Map<String, dynamic>>{};

  for (final id in saleUnitIds) {
    final priceValue = id == defaultSaleUnitId
        ? payload['base_price']
        : salePrices[id] ?? salePrices[id.toString()];
    final hasExplicitPoint = rawPricePoints.any(
      (point) => point['uom_id']?.toString() == id,
    );
    if (priceValue == null && hasExplicitPoint) continue;
    final price = SaleProduct._number(priceValue, fallback: double.nan);
    final conversion = conversionByUnit[id]!;
    if (!price.isFinite || price <= 0) return null;
    pricePointsByKey['$id:$conversion'] = {
      'quantity': 1.0,
      'baseQuantity': conversion,
      'price': price,
      'maxDiscountAmount': 0.0,
      'uomId': id,
    };
  }

  for (final point in rawPricePoints) {
    final id = point['uom_id']?.toString();
    final quantity = SaleProduct._number(
      point['quantity'],
      fallback: double.nan,
    );
    final price = SaleProduct._number(point['price'], fallback: double.nan);
    final maxDiscount = SaleProduct._number(
      point['max_discount_amount'],
      fallback: double.nan,
    );
    final conversion = id == null ? null : conversionByUnit[id];
    if (id == null ||
        conversion == null ||
        !quantity.isFinite ||
        quantity <= 0 ||
        !price.isFinite ||
        price < 0 ||
        !maxDiscount.isFinite ||
        maxDiscount < 0) {
      return null;
    }
    final baseQuantity = double.parse(
      (quantity * conversion).toStringAsFixed(4),
    );
    pricePointsByKey['$id:$baseQuantity'] = {
      'quantity': quantity,
      'baseQuantity': baseQuantity,
      'price': price,
      'maxDiscountAmount': maxDiscount,
      'uomId': id,
    };
  }

  final points = pricePointsByKey.values.toList()
    ..sort((first, second) {
      final firstIsDefault = first['uomId'] == defaultSaleUnitId;
      final secondIsDefault = second['uomId'] == defaultSaleUnitId;
      if (firstIsDefault != secondIsDefault) return firstIsDefault ? -1 : 1;
      return SaleProduct._number(first['baseQuantity'])
          .compareTo(SaleProduct._number(second['baseQuantity']));
    });
  final serverMethod =
      modelMethod == 'assisted_pack' &&
          modelRounding == 'none' &&
          !points.any((point) => SaleProduct._number(point['quantity']) != 1)
      ? 'fixed_price'
      : modelMethod;
  final insertedPricePoints = modelMethod == 'fixed_price'
      ? const <Map<String, dynamic>>[]
      : points;
  final sellingPrice = insertedPricePoints.isEmpty
      ? SaleProduct._number(payload['base_price'])
      : SaleProduct._number(insertedPricePoints.first['price']);
  if (!sellingPrice.isFinite || sellingPrice <= 0) return null;

  return {
    ...current,
    'name': payload['name']?.toString() ?? current['name'],
    'sku': payload['sku']?.toString() ?? current['sku'],
    'selling_price': sellingPrice,
    'pricing_method': serverMethod,
    'rounding_rule': modelRounding,
    'pricing_options': insertedPricePoints,
    'uom_options': uomOptions,
    'barcodes': _stringValues(payload['barcodes']),
  };
}

List<String> _stringValues(Object? value) =>
    value is List ? value.map((item) => item.toString()).toList() : <String>[];

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
    this.paymentPhone,
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
  final String? paymentPhone;

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

class OfflineSalesSummary {
  const OfflineSalesSummary({
    required this.pendingCount,
    required this.pendingValue,
    required this.failedCount,
    required this.failedValue,
    required this.syncedCount,
    required this.lastSyncedAt,
  });

  final int pendingCount;
  final double pendingValue;
  final int failedCount;
  final double failedValue;
  final int syncedCount;
  final DateTime? lastSyncedAt;
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
  final Map<String, String?> _indexedBarcodeCatalogVersions = {};
  final Map<String, Future<List<SaleProduct>>> _activeCatalogLoads = {};
  final Map<String, Future<List<SaleProduct>>> _latestCatalogLoadsByScope = {};
  final Map<String, Future<void>> _catalogCacheWrites = {};
  final Map<String, int> _catalogRequestGenerations = {};
  static final Sha256 _barcodeHasher = Sha256();

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
    if (supabase == null) return _cachedProducts(user, branchId);

    final scope = _catalogScopeKey(user, branchId);
    final permissionScope = _catalogPermissionSignature(user);
    final localState = await _catalogLocalStateSignature(user, branchId);
    final requestKey = '$scope|$permissionScope|$localState';
    final existing = _activeCatalogLoads[requestKey];
    if (existing != null) return existing;

    final generation = (_catalogRequestGenerations[scope] ?? 0) + 1;
    _catalogRequestGenerations[scope] = generation;
    late final Future<List<SaleProduct>> request;
    request =
        _loadProductsForRequest(
          user,
          branchId,
          scope: scope,
          localState: localState,
          generation: generation,
        ).whenComplete(() {
          if (identical(_activeCatalogLoads[requestKey], request)) {
            _activeCatalogLoads.remove(requestKey);
          }
          if (identical(_latestCatalogLoadsByScope[scope], request)) {
            _latestCatalogLoadsByScope.remove(scope);
          }
        });
    _activeCatalogLoads[requestKey] = request;
    _latestCatalogLoadsByScope[scope] = request;
    return request;
  }

  String _catalogScopeKey(RetivoxUser user, String branchId) {
    return jsonEncode([user.id, user.businessId, branchId]);
  }

  String _catalogPermissionSignature(RetivoxUser user) {
    final permissions =
        user.branches.map((branch) => '${branch.id}:${branch.role}').toList()
          ..sort();
    return jsonEncode([user.role.name, permissions]);
  }

  Future<String> _catalogLocalStateSignature(
    RetivoxUser user,
    String branchId,
  ) async {
    final pendingActionsUpdatedAt = await vault.cachedValueUpdatedAt(
      user,
      'dashboard:pending_actions',
    );
    final pendingSales = await database.inventoryAffectingSales(
      user.id,
      branchId,
    );
    final pendingSalesSignature = pendingSales
        .map(
          (row) =>
              '${row.read<String>('local_id')}:${row.read<String>('status')}:${row.read<String>('encrypted_payload')}',
        )
        .join(',');
    return '${pendingActionsUpdatedAt?.toUtc().microsecondsSinceEpoch ?? '-'}|$pendingSalesSignature';
  }

  Future<bool> _catalogRequestIsCurrent({
    required RetivoxUser user,
    required String branchId,
    required String scope,
    required String localState,
    required int generation,
  }) async {
    if (_catalogRequestGenerations[scope] != generation) return false;
    return await _catalogLocalStateSignature(user, branchId) == localState;
  }

  Future<List<SaleProduct>> _newestCatalogResult({
    required RetivoxUser user,
    required String branchId,
    required String scope,
    required int generation,
  }) {
    final latest = _latestCatalogLoadsByScope[scope];
    final currentGeneration = _catalogRequestGenerations[scope] ?? generation;
    if (currentGeneration > generation) {
      return latest ?? _cachedProducts(user, branchId);
    }
    return loadProducts(user, branchId);
  }

  Future<List<SaleProduct>> _loadProductsForRequest(
    RetivoxUser user,
    String branchId, {
    required String scope,
    required String localState,
    required int generation,
  }) async {
    final supabase = client;
    if (supabase == null) return _cachedProducts(user, branchId);
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
      if (!await _catalogRequestIsCurrent(
        user: user,
        branchId: branchId,
        scope: scope,
        localState: localState,
        generation: generation,
      )) {
        return await _newestCatalogResult(
          user: user,
          branchId: branchId,
          scope: scope,
          generation: generation,
        );
      }

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
      final available = await _productsWithPendingLocalSales(
        user,
        branchId,
        rows.map((row) => row.toJson()).toList(),
        appliedLocalSaleIds: const {},
      );
      if (!await _catalogRequestIsCurrent(
        user: user,
        branchId: branchId,
        scope: scope,
        localState: localState,
        generation: generation,
      )) {
        return await _newestCatalogResult(
          user: user,
          branchId: branchId,
          scope: scope,
          generation: generation,
        );
      }
      final products = available.map(SaleProduct.fromCachedJson).toList();
      final previousWrite = _catalogCacheWrites[scope] ?? Future<void>.value();
      late final Future<void> cacheWrite;
      cacheWrite = previousWrite.catchError((Object _) {}).then((_) async {
        if (!await _catalogRequestIsCurrent(
          user: user,
          branchId: branchId,
          scope: scope,
          localState: localState,
          generation: generation,
        )) {
          return;
        }
        await _storeServerProductSnapshot(user, branchId, rows);
        if (!await _catalogRequestIsCurrent(
          user: user,
          branchId: branchId,
          scope: scope,
          localState: localState,
          generation: generation,
        )) {
          return;
        }
        await vault.cacheValue(user, 'sale-products:$branchId', available);
        await _refreshBarcodeIndex(user, branchId, products);
      });
      _catalogCacheWrites[scope] = cacheWrite;
      try {
        await cacheWrite;
      } finally {
        if (identical(_catalogCacheWrites[scope], cacheWrite)) {
          _catalogCacheWrites.remove(scope);
        }
      }
      if (!await _catalogRequestIsCurrent(
        user: user,
        branchId: branchId,
        scope: scope,
        localState: localState,
        generation: generation,
      )) {
        return await _newestCatalogResult(
          user: user,
          branchId: branchId,
          scope: scope,
          generation: generation,
        );
      }
      return products;
    } catch (error) {
      if (!await _catalogRequestIsCurrent(
        user: user,
        branchId: branchId,
        scope: scope,
        localState: localState,
        generation: generation,
      )) {
        return _newestCatalogResult(
          user: user,
          branchId: branchId,
          scope: scope,
          generation: generation,
        );
      }
      if (_isNetworkError(error)) return _cachedProducts(user, branchId);
      rethrow;
    }
  }

  Future<List<SaleProduct>> _cachedProducts(
    RetivoxUser user,
    String branchId,
  ) async {
    final savedSnapshot = await vault.readCachedValue<Map<String, dynamic>>(
      user,
      'sale-products-server:$branchId',
    );
    final legacyCached = await vault.readCachedValue<List<dynamic>>(
      user,
      'sale-products:$branchId',
    );
    final baseline = savedSnapshot == null
        ? legacyCached
        : savedSnapshot['rows'] as List<dynamic>?;
    if (baseline == null) {
      throw const SaleRepositoryException(
        'No product data is cached for this branch. Connect to the internet to refresh it before recording a sale.',
      );
    }
    if (savedSnapshot == null) {
      await _storeServerProductSnapshot(
        user,
        branchId,
        baseline
            .whereType<Map>()
            .map(
              (row) =>
                  SaleProduct.fromCachedJson(Map<String, dynamic>.from(row)),
            )
            .toList(),
      );
    }
    final available = await _productsWithPendingLocalSales(
      user,
      branchId,
      baseline
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList(),
    );
    await vault.cacheValue(user, 'sale-products:$branchId', available);
    final products = available
        .whereType<Map<String, dynamic>>()
        .map(SaleProduct.fromCachedJson)
        .toList();
    await _refreshBarcodeIndex(user, branchId, products);
    return products;
  }

  Future<void> _storeServerProductSnapshot(
    RetivoxUser user,
    String branchId,
    List<SaleProduct> products,
  ) async {
    final previous = await vault.readCachedValue<Map<String, dynamic>>(
      user,
      'sale-products-server:$branchId',
    );
    await vault.cacheValue(user, 'sale-products-server:$branchId', {
      'rows': products.map((row) => row.toJson()).toList(),
      'applied_local_sale_ids': <String>[],
      'inactive_product_ids': previous?['inactive_product_ids'] ?? const [],
    });
  }

  Future<List<Map<String, dynamic>>> _productsWithPendingLocalSales(
    RetivoxUser user,
    String branchId,
    List<Map<String, dynamic>> serverRows, {
    Set<String>? appliedLocalSaleIds,
  }) async {
    final snapshot = await vault.readCachedValue<Map<String, dynamic>>(
      user,
      'sale-products-server:$branchId',
    );
    final appliedIds =
        appliedLocalSaleIds ??
        (snapshot?['applied_local_sale_ids'] as List? ?? const [])
            .map((id) => id.toString())
            .toSet();
    final pendingPayloads = <Map<String, dynamic>>[];
    for (final row in await database.inventoryAffectingSales(
      user.id,
      branchId,
    )) {
      final localId = row.read<String>('local_id');
      if (appliedIds.contains(localId)) continue;
      try {
        pendingPayloads.add(
          await vault.decryptForAccount(
            user.id,
            row.read<String>('encrypted_payload'),
          ),
        );
      } catch (_) {
        // Keep a damaged sale visible in history; do not invent an item
        // deduction when its encrypted item list cannot be authenticated.
      }
    }
    var availableRows = applyLocalSaleQuantities(serverRows, pendingPayloads);
    availableRows = await _applyPendingStockAdjustments(
      user,
      branchId,
      availableRows,
    );
    return availableRows;
  }

  Future<List<Map<String, dynamic>>> _applyPendingStockAdjustments(
    RetivoxUser user,
    String branchId,
    List<Map<String, dynamic>> rows,
  ) async {
    final stockRows = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:stock',
    );
    final actions =
        await vault.readCachedValue<List<dynamic>>(
          user,
          'dashboard:pending_actions',
        ) ??
        const <dynamic>[];
    var updatedRows = stockRows == null
        ? rows
        : applyLocalStockAdjustments(
            rows,
            cachedStockRows: stockRows,
            pendingActions: actions,
            branchId: branchId,
          );
    if (user.role == RetivoxRole.owner) {
      final transferOptions = await vault.readCachedValue<List<dynamic>>(
        user,
        'dashboard:transfer-options',
      );
      final deliveries = await vault.readCachedValue<List<dynamic>>(
        user,
        'dashboard:deliveries',
      );
      updatedRows = applyLocalSupplierReceipts(
        updatedRows,
        cachedTransferOptions: transferOptions ?? const [],
        cachedDeliveries: deliveries ?? const [],
        pendingActions: actions,
        branchId: branchId,
        ownerCanReceiveImmediately: user.role == RetivoxRole.owner,
      );
    }
    final snapshot = await vault.readCachedValue<Map<String, dynamic>>(
      user,
      'sale-products-server:$branchId',
    );
    final inactiveProductIds =
        (snapshot?['inactive_product_ids'] as List? ?? const [])
            .map((id) => id.toString())
            .toSet();
    final productActions = <dynamic>[
      for (final productId in inactiveProductIds)
        {
          'type': 'set_product_active',
          'payload': {'product_id': productId, 'is_active': false},
        },
      ...actions,
    ];
    final hasPendingProductEdits = productActions.any((raw) {
      if (raw is! Map) return false;
      final type = raw['type']?.toString();
      return type == 'update_product' || type == 'set_product_active';
    });
    if (!hasPendingProductEdits) return updatedRows;
    final productOptions = await vault.readCachedValue<List<dynamic>>(
      user,
      'dashboard:product-options',
    );
    final options = productOptions
        ?.whereType<Map>()
        .map(Map<String, dynamic>.from)
        .firstOrNull;
    return applyPendingProductCatalogActions(
      updatedRows,
      pendingActions: productActions,
      cachedUnits: (options?['units'] as List? ?? const []),
      branchId: branchId,
    );
  }

  Future<void> _recordConfirmedLocalSale(
    RetivoxUser user,
    String branchId,
    String localId,
    Map<String, dynamic> payload,
  ) async {
    final key = 'sale-products-server:$branchId';
    var snapshot = await vault.readCachedValue<Map<String, dynamic>>(user, key);
    if (snapshot == null) {
      final cached = await vault.readCachedValue<List<dynamic>>(
        user,
        'sale-products:$branchId',
      );
      if (cached == null) return;
      snapshot = {'rows': cached, 'applied_local_sale_ids': <String>[]};
    }
    final appliedIds = (snapshot['applied_local_sale_ids'] as List? ?? const [])
        .map((id) => id.toString())
        .toSet();
    if (appliedIds.add(localId)) {
      final rows = (snapshot['rows'] as List? ?? const [])
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      snapshot['rows'] = applyLocalSaleQuantities(rows, [payload]);
      snapshot['applied_local_sale_ids'] = appliedIds.toList();
      await vault.cacheValue(user, key, snapshot);
    }
  }

  Future<void> _forgetAppliedLocalSaleId(
    RetivoxUser user,
    String branchId,
    String localId,
  ) async {
    final key = 'sale-products-server:$branchId';
    final snapshot = await vault.readCachedValue<Map<String, dynamic>>(
      user,
      key,
    );
    if (snapshot == null) return;
    snapshot['applied_local_sale_ids'] =
        (snapshot['applied_local_sale_ids'] as List? ?? const [])
            .map((id) => id.toString())
            .where((id) => id != localId)
            .toList();
    await vault.cacheValue(user, key, snapshot);
  }

  Future<SaleProduct?> findProductByBarcode({
    required RetivoxUser user,
    required String branchId,
    required Iterable<SaleProduct> products,
    required String barcode,
  }) async {
    final normalized = normalizeBarcode(barcode);
    if (normalized.isEmpty) return null;
    final hash = await _barcodeHash(normalized);
    final optionId = await database.productOptionForBarcodeHash(
      user.id,
      branchId,
      hash,
    );
    if (optionId != null) {
      for (final product in products) {
        if (product.optionId == optionId) return product;
      }
    }
    // The in-memory catalog is a safe fallback for a damaged/old index. The
    // next catalog load rebuilds the SQLite index from the encrypted cache.
    return findSaleProductByBarcode(products, normalized);
  }

  Future<void> savePosDraft(
    RetivoxUser user,
    String branchId,
    Map<String, dynamic> draft,
  ) => vault.cacheValue(user, 'pos-draft:$branchId', draft);

  Future<Map<String, dynamic>?> loadPosDraft(
    RetivoxUser user,
    String branchId,
  ) => vault.readCachedValue<Map<String, dynamic>>(user, 'pos-draft:$branchId');

  Future<void> clearPosDraft(RetivoxUser user, String branchId) =>
      database.deleteCachedValue(user.id, 'pos-draft:$branchId');

  Future<void> _refreshBarcodeIndex(
    RetivoxUser user,
    String branchId,
    Iterable<SaleProduct> products,
  ) async {
    final cacheKey = 'sale-products:$branchId';
    final catalogVersion = await database.cachedValueUpdatedAt(
      user.id,
      cacheKey,
    );
    final versionKey = '${user.id}:$branchId';
    if (catalogVersion != null &&
        _indexedBarcodeCatalogVersions[versionKey] == catalogVersion) {
      return;
    }
    final entries = <Map<String, String>>[];
    for (final product in products) {
      for (final barcode in product.barcodes) {
        final normalized = normalizeBarcode(barcode);
        if (normalized.isEmpty) continue;
        entries.add({
          'barcode_hash': await _barcodeHash(normalized),
          'product_option_id': product.optionId,
        });
      }
    }
    await database.replaceProductBarcodeIndex(user.id, branchId, entries);
    _indexedBarcodeCatalogVersions[versionKey] = catalogVersion;
  }

  Future<void> refreshCachedBarcodeIndex(
    RetivoxUser user,
    String branchId,
    Iterable<Map<String, dynamic>> rows,
  ) => _refreshBarcodeIndex(
    user,
    branchId,
    rows.map(SaleProduct.fromCachedJson),
  );

  static Future<String> _barcodeHash(String normalizedBarcode) async {
    final digest = await _barcodeHasher.hash(utf8.encode(normalizedBarcode));
    return digest.bytes
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
  }

  Future<String> recordSale({
    required RetivoxUser user,
    required String branchId,
    required List<Map<String, dynamic>> items,
    required String paymentMethod,
    required String mpesaReference,
    String? paymentPhone,
    String? manualPaymentMethodId,
    int? manualPaymentMethodVersion,
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
      'paymentPhone': paymentMethod == 'mpesa_stk'
          ? _optionalString(paymentPhone)
          : null,
      'manualPaymentMethodId': paymentMethod == 'mpesa_manual'
          ? _optionalString(manualPaymentMethodId)
          : null,
      'manualPaymentMethodVersion': paymentMethod == 'mpesa_manual'
          ? manualPaymentMethodVersion
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
      await _cachedProducts(user, branchId);
    } catch (_) {
      // The sale is already safely queued. A missing/invalid catalog cache
      // must not make the local transaction appear unsaved.
    }
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
            ? 'employee_record_transaction_offline_with_payment_method_v1'
            : 'dashboard_record_transaction_offline_with_payment_method_v1';
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
        await _recordConfirmedLocalSale(
          user,
          row.read<String>('branch_id'),
          localId,
          updatedPayload,
        );
        await database.updateSale(
          accountId: user.id,
          localId: localId,
          status: 'synced',
          serverId: resultRow['transaction_id'] as String,
        );
        await _forgetAppliedLocalSaleId(
          user,
          row.read<String>('branch_id'),
          localId,
        );
        try {
          await _cachedProducts(user, row.read<String>('branch_id'));
        } catch (_) {
          // The server-confirmed sale remains synced even if the local catalog
          // needs an online refresh before it can be rebuilt.
        }
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

  Future<Map<String, dynamic>?> paymentAttemptForLocalSale(
    RetivoxUser user,
    String localId,
  ) async {
    final rows = await database.salesForAccount(user.id);
    final row = rows
        .where((sale) => sale.read<String>('local_id') == localId)
        .firstOrNull;
    final transactionId = row?.readNullable<String>('server_id');
    final supabase = client;
    if (transactionId == null || supabase == null) return null;
    final stkResponse = await supabase
        .from('payments')
        .select('id,provider_checkout_started_at')
        .eq('business_id', user.businessId)
        .eq('transaction_id', transactionId)
        .eq('payment_method', 'mpesa_stk')
        .order('payment_at', ascending: false)
        .limit(1)
        .maybeSingle();
    if (stkResponse != null) return Map<String, dynamic>.from(stkResponse);
    final pendingResponse = await supabase
        .from('payments')
        .select('id,provider_checkout_started_at')
        .eq('business_id', user.businessId)
        .eq('transaction_id', transactionId)
        .eq('reference_code', 'STK-PENDING:$localId')
        .eq('status', 'pending_verify')
        .maybeSingle();
    return pendingResponse == null
        ? null
        : Map<String, dynamic>.from(pendingResponse);
  }

  Future<String?> paymentIdForLocalSale(
    RetivoxUser user,
    String localId,
  ) async =>
      (await paymentAttemptForLocalSale(user, localId))?['id']?.toString();

  Future<Map<String, dynamic>?> loadPaymentAttemptStatus(
    RetivoxUser user,
    String paymentId,
  ) async {
    final supabase = client;
    if (supabase == null || !await isBackendReachable()) return null;
    final response = await supabase.rpc(
      'business_payment_attempt_status',
      params: {'p_payment_id': paymentId},
    );
    final row = response is List ? response.firstOrNull : response;
    if (row is! Map) return null;
    return Map<String, dynamic>.from(row);
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

  Future<OfflineSalesSummary> offlineSalesSummary(String accountId) async {
    final counts = await database.offlineSalesOverviewCounts(accountId);
    final sales = await _decodeSales(
      await database.actionableSales(accountId),
      accountId,
    );
    final pending = sales.where(
      (sale) => sale.status == 'pending_sync' || sale.status == 'syncing',
    );
    final failed = sales.where((sale) => sale.status == 'needs_correction');
    final lastSynced = DateTime.tryParse(
      counts.readNullable<String>('last_synced_at') ?? '',
    );
    return OfflineSalesSummary(
      pendingCount: counts.read<int>('pending_count'),
      pendingValue: pending.fold<double>(
        0,
        (total, sale) => total + sale.totalAmount,
      ),
      failedCount: counts.read<int>('failed_count'),
      failedValue: failed.fold<double>(
        0,
        (total, sale) => total + sale.totalAmount,
      ),
      syncedCount: counts.read<int>('synced_count'),
      lastSyncedAt: lastSynced,
    );
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
            paymentPhone: payload['paymentPhone']?.toString(),
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
      'p_payment_method': payload['paymentMethod'] == 'mpesa_stk'
          ? 'mpesa_manual'
          : payload['paymentMethod'],
      'p_amount_paid': payload['amountPaid'],
      'p_amount_tendered': payload['amountTendered'],
      'p_customer_email': payload['customerEmail'],
      'p_due_date': _optionalString(payload['dueDate']),
      'p_is_credit': payload['isCredit'] ?? false,
      'p_discount_amount': payload['discountAmount'],
      'p_customer_name': payload['customerName'],
      'p_customer_phone': payload['customerPhone'],
      'p_reference_code': payload['paymentMethod'] == 'mpesa_stk'
          ? 'STK-PENDING:$localId'
          : payload['mpesaRefCode'],
      'p_recorded_at': recordedAt,
      'p_local_id': localId,
      'p_manual_payment_method_id': _optionalString(
        payload['manualPaymentMethodId'],
      ),
      'p_manual_payment_method_version': int.tryParse(
        payload['manualPaymentMethodVersion']?.toString() ?? '',
      ),
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
