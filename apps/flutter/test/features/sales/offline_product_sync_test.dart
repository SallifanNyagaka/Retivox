import 'dart:convert';

import 'package:drift/drift.dart' hide isNotNull, isNull;
import 'package:drift/native.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:retivox_client/core/auth/offline_account_vault.dart';
import 'package:retivox_client/core/auth/retivox_user.dart';
import 'package:retivox_client/core/database/app_database.dart';
import 'package:retivox_client/core/network/backend_health_check.dart';
import 'package:retivox_client/features/dashboard/dashboard_repository.dart';
import 'package:retivox_client/features/sales/sale_repository.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _userId = '11111111-1111-4111-8111-111111111111';
const _businessId = '22222222-2222-4222-8222-222222222222';
const _productId = '33333333-3333-4333-8333-333333333333';
const _unitId = '44444444-4444-4444-8444-444444444444';
const _owner = RetivoxUser(
  id: _userId,
  businessId: _businessId,
  name: 'Owner',
  email: 'owner@example.test',
  businessName: 'Sample business',
  role: RetivoxRole.owner,
  branches: [BranchAccess(id: 'branch-1', name: 'Branch 1', role: 'owner')],
  currency: 'KES',
);

Map<String, dynamic> _cachedSaleProduct() => {
  'option_id': 'normal:$_productId',
  'product_id': _productId,
  'name': 'Old name',
  'sku': 'OLD-SKU',
  'selling_price': 10,
  'pricing_method': 'fixed_price',
  'rounding_rule': 'none',
  'pricing_options': const [],
  'uom_options': const [
    {
      'id': _unitId,
      'name': 'Each',
      'abbreviation': 'ea',
      'conversionFactor': 1,
      'isBaseUnit': true,
      'isBaseUom': true,
      'isDefaultSaleUom': true,
      'isDefaultPurchaseUom': true,
    },
  ],
  'quantity_on_hand': 10,
  'quantity_reserved': 0,
  'base_quantity_on_hand': 10,
  'base_quantity_reserved': 0,
  'recovery_item_id': null,
  'stock_source': 'normal',
  'barcodes': ['OLD-123'],
};

String _base64UrlJson(Map<String, Object> value) =>
    base64Url.encode(utf8.encode(jsonEncode(value))).replaceAll('=', '');

void main() {
  late AppDatabase database;
  late OfflineAccountVault vault;
  late SupabaseClient supabase;
  late List<Uri> requests;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    database = AppDatabase(executor: NativeDatabase.memory());
    await database.customSelect('SELECT 1').getSingle();
    vault = OfflineAccountVault(database: database);
    await vault.authorizeAccount(_owner);
    requests = [];

    supabase = SupabaseClient(
      'http://localhost:54321',
      'test-publishable-key',
      httpClient: MockClient((request) async {
        requests.add(request.url);
        final path = request.url.path;
        Object? body;
        if (path == '/auth/v1/user') {
          body = {
            'id': _userId,
            'app_metadata': <String, dynamic>{},
            'user_metadata': <String, dynamic>{},
            'aud': 'authenticated',
            'role': 'authenticated',
            'email': 'owner@example.test',
            'created_at': '2025-01-01T00:00:00.000Z',
          };
        } else if (path == '/rest/v1/units_of_measure') {
          body = [
            {
              'id': _unitId,
              'name': 'Each',
              'abbreviation': 'ea',
              'conversion_factor': 1,
            },
          ];
        } else if (path == '/rest/v1/branches') {
          body = [
            {'id': 'branch-1'},
          ];
        } else if (path == '/rest/v1/rpc/owner_update_product' ||
            path == '/rest/v1/rpc/owner_toggle_product_status' ||
            path == '/rest/v1/rpc/dashboard_adjust_stock_idempotent_v1') {
          body = null;
        } else if (path == '/rest/v1/products') {
          body = {'id': _productId};
        } else if (path == '/rest/v1/product_barcodes' &&
            request.method == 'GET') {
          body = [
            {
              'id': '55555555-5555-4555-8555-555555555555',
              'code': 'OLD-123',
              'product_id': _productId,
              'is_active': true,
            },
          ];
        } else if (path == '/rest/v1/product_pricing_models' &&
            request.method == 'POST') {
          body = [
            {
              'id': '66666666-6666-4666-8666-666666666666',
              'branch_id': 'branch-1',
            },
          ];
        } else if (path == '/rest/v1/product_pricing_models' ||
            path == '/rest/v1/product_barcodes' ||
            path == '/rest/v1/product_uom_links') {
          body = [];
        } else {
          throw StateError(
            'Unexpected request: ${request.method} ${request.url}',
          );
        }
        return http.Response(
          jsonEncode(body),
          200,
          headers: {'content-type': 'application/json'},
          request: request,
        );
      }),
    );
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final accessToken =
        '${_base64UrlJson({'alg': 'HS256', 'typ': 'JWT'})}.'
        '${_base64UrlJson({'sub': _userId, 'exp': now + 3600, 'iat': now, 'aud': 'authenticated'})}.'
        'dGVzdA';
    await supabase.auth.setSession(
      'test-refresh-token',
      accessToken: accessToken,
    );
  });

  tearDown(() async {
    await supabase.dispose();
    await database.close();
  });

  test(
    'offline product edit survives sync and offline return without stale data',
    () async {
      await vault.cacheValue(_owner, 'dashboard:product-options', [
        {
          'units': [
            {
              'id': _unitId,
              'name': 'Each',
              'abbreviation': 'ea',
              'conversion_factor': 1,
              'is_base_unit': true,
              'is_active': true,
            },
          ],
          'branches': [
            {'id': 'branch-1'},
          ],
        },
      ]);
      await vault.cacheValue(_owner, 'sale-products-server:branch-1', {
        'rows': [_cachedSaleProduct()],
        'applied_local_sale_ids': <String>[],
      });
      await vault.cacheValue(_owner, 'dashboard:stock', [
        {
          'id': '77777777-7777-4777-8777-777777777777',
          'branch_id': 'branch-1',
          'product_id': _productId,
        },
      ]);

      final offlineDashboard = DashboardRepository(
        vault: vault,
        client: null,
        backendHealthCheck: BackendHealthCheck(
          supabaseUrl: '',
          publishableKey: '',
        ),
      );
      await offlineDashboard.updateProduct(
        _owner,
        productId: _productId,
        name: 'Updated name',
        sku: 'NEW-SKU',
        category: 'Food',
        unit: 'ea',
        description: 'Updated offline',
        productKind: 'measured_counted',
        subcategory: '',
        brandFamily: '',
        basePrice: 15,
        minPrice: 5,
        maxPrice: 30,
        baseUnitId: _unitId,
        purchaseUnitIds: const [_unitId],
        saleUnitIds: const [_unitId],
        defaultPurchaseUnitId: _unitId,
        defaultSaleUnitId: _unitId,
        salePrices: const {},
        pricePoints: const [],
        pricingBranchIds: const ['branch-1'],
        pricingMethod: 'fixed_price',
        roundingRule: 'none',
        barcodes: const ['NEW-123'],
      );

      final offlineSales = SaleRepository(
        database: database,
        vault: vault,
        client: null,
        backendHealthCheck: BackendHealthCheck(
          supabaseUrl: '',
          publishableKey: '',
        ),
      );
      final editedBeforeSync = await offlineSales.loadProducts(
        _owner,
        'branch-1',
      );
      expect(editedBeforeSync.single.name, 'Updated name');
      expect(editedBeforeSync.single.sku, 'NEW-SKU');
      expect(editedBeforeSync.single.sellingPrice, 15);
      expect(editedBeforeSync.single.barcodes, ['NEW-123']);
      expect(editedBeforeSync.single.baseQuantityOnHand, 10);

      final pendingBeforeSync = await vault.readCachedValue<List<dynamic>>(
        _owner,
        'dashboard:pending_actions',
      );
      expect(pendingBeforeSync, hasLength(1));

      final onlineDashboard = DashboardRepository(
        vault: vault,
        client: supabase,
        backendHealthCheck: BackendHealthCheck(
          supabaseUrl: 'http://localhost:54321',
          publishableKey: 'test-publishable-key',
        ),
      );
      await onlineDashboard.syncPendingDashboardActions(_owner);

      final actionsAfterSync = await vault.readCachedValue<List<dynamic>>(
        _owner,
        'dashboard:pending_actions',
      );
      expect(actionsAfterSync, isEmpty);

      // A local stock adjustment remains pending while the device returns
      // offline, and must be applied to the refreshed product cache once.
      await offlineDashboard.adjustStock(
        _owner,
        stockId: '77777777-7777-4777-8777-777777777777',
        quantity: 3,
        operation: 'add',
      );
      final editedAfterSync = await offlineSales.loadProducts(
        _owner,
        'branch-1',
      );
      expect(editedAfterSync.single.name, 'Updated name');
      expect(editedAfterSync.single.sellingPrice, 15);
      expect(editedAfterSync.single.barcodes, ['NEW-123']);
      expect(editedAfterSync.single.baseQuantityOnHand, 13);
      final stockBeforeDeactivation = await vault.readCachedValue<List<dynamic>>(
        _owner,
        'dashboard:stock',
      );
      final serverSnapshotBeforeDeactivation = await vault
          .readCachedValue<Map<String, dynamic>>(
            _owner,
            'sale-products-server:branch-1',
          );

      // Deactivation is a separate queued action and must not revert to the
      // server snapshot's old active state after successful synchronization.
      await offlineDashboard.setProductActive(
        _owner,
        productId: _productId,
        isActive: false,
      );
      expect(await offlineSales.loadProducts(_owner, 'branch-1'), isEmpty);
      final pendingWithDeactivation = await vault
          .readCachedValue<List<dynamic>>(_owner, 'dashboard:pending_actions');
      expect(
        pendingWithDeactivation
            ?.whereType<Map>()
            .where((action) => action['type'] == 'adjust_stock')
            .single['payload'],
        {
          'stock_id': '77777777-7777-4777-8777-777777777777',
          'quantity': 3,
          'operation': 'add',
        },
      );
      await onlineDashboard.syncPendingDashboardActions(_owner);
      expect(
        await vault.readCachedValue<List<dynamic>>(
          _owner,
          'dashboard:pending_actions',
        ),
        isEmpty,
      );

      final offlineAfterDeactivationSync = await offlineSales.loadProducts(
        _owner,
        'branch-1',
      );
      expect(offlineAfterDeactivationSync, isEmpty);
      final inactiveSnapshot = await vault
          .readCachedValue<Map<String, dynamic>>(
            _owner,
            'sale-products-server:branch-1',
          );
      expect(
        (inactiveSnapshot?['inactive_product_ids'] as List).cast<String>(),
        contains(_productId),
      );
      expect(
        await vault.readCachedValue<List<dynamic>>(
          _owner,
          'sale-products:branch-1',
        ),
        isEmpty,
      );
      expect(
        await offlineSales.findProductByBarcode(
          user: _owner,
          branchId: 'branch-1',
          products: offlineAfterDeactivationSync,
          barcode: 'NEW-123',
        ),
        isNull,
      );
      expect(await _barcodeIndexCount(database), 0);
      final inactiveServerRows = (inactiveSnapshot?['rows'] as List)
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .toList();
      expect(inactiveServerRows, serverSnapshotBeforeDeactivation?['rows']);
      expect(
        await vault.readCachedValue<List<dynamic>>(_owner, 'dashboard:stock'),
        stockBeforeDeactivation,
      );

      // Reactivation removes the persisted offline restriction. The cached
      // server row remains available for the offline catalog to rebuild from.
      await offlineDashboard.setProductActive(
        _owner,
        productId: _productId,
        isActive: true,
      );
      expect(
        (await offlineSales.loadProducts(_owner, 'branch-1')).single.name,
        'Updated name',
      );
      await onlineDashboard.syncPendingDashboardActions(_owner);
      expect(
        await vault.readCachedValue<List<dynamic>>(
          _owner,
          'dashboard:pending_actions',
        ),
        isEmpty,
      );
      final offlineAfterReactivationSync = await offlineSales.loadProducts(
        _owner,
        'branch-1',
      );
      expect(offlineAfterReactivationSync.single.name, 'Updated name');
      final activeSnapshot = await vault.readCachedValue<Map<String, dynamic>>(
        _owner,
        'sale-products-server:branch-1',
      );
      expect(activeSnapshot?['inactive_product_ids'], isEmpty);
      expect(
        await vault.readCachedValue<List<dynamic>>(
          _owner,
          'sale-products:branch-1',
        ),
        hasLength(1),
      );
      expect(
        await offlineSales.findProductByBarcode(
          user: _owner,
          branchId: 'branch-1',
          products: offlineAfterReactivationSync,
          barcode: 'NEW-123',
        ),
        isNotNull,
      );
      expect(await _barcodeIndexCount(database), 1);

      expect(
        requests.where(
          (uri) => uri.path == '/rest/v1/rpc/owner_update_product',
        ),
        hasLength(1),
      );
      expect(
        requests.where(
          (uri) => uri.path == '/rest/v1/rpc/owner_toggle_product_status',
        ),
        hasLength(2),
      );
    },
  );
}

Future<int> _barcodeIndexCount(AppDatabase database) async {
  final row = await database
      .customSelect(
        '''
        SELECT COUNT(*) AS count FROM product_barcode_index
        WHERE account_id = ? AND branch_id = ?
        ''',
        variables: [
          Variable.withString(_userId),
          Variable.withString('branch-1'),
        ],
      )
      .getSingle();
  return row.read<int>('count');
}
