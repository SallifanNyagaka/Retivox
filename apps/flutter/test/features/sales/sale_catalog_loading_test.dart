import 'dart:async';
import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:retivox_client/core/auth/offline_account_vault.dart';
import 'package:retivox_client/core/auth/retivox_user.dart';
import 'package:retivox_client/core/database/app_database.dart';
import 'package:retivox_client/core/network/backend_health_check.dart';
import 'package:retivox_client/features/sales/sale_repository.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _user = RetivoxUser(
  id: '11111111-1111-4111-8111-111111111111',
  businessId: '22222222-2222-4222-8222-222222222222',
  name: 'Owner',
  email: 'owner@example.test',
  businessName: 'Sample business',
  role: RetivoxRole.owner,
  branches: [BranchAccess(id: 'branch-1', name: 'Branch 1', role: 'owner')],
  currency: 'KES',
);

Map<String, dynamic> _serverProduct(String name) => {
  'product_id': '33333333-3333-4333-8333-333333333333',
  'name': name,
  'sku': 'SKU-1',
  'selling_price': 10,
  'pricing_method': 'fixed_price',
  'rounding_rule': 'none',
  'pricing_options': const [],
  'uom_options': const [
    {
      'id': '44444444-4444-4444-8444-444444444444',
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
};

void main() {
  late AppDatabase database;
  late OfflineAccountVault vault;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    database = AppDatabase(executor: NativeDatabase.memory());
    await database.customSelect('SELECT 1').getSingle();
    vault = OfflineAccountVault(database: database);
    await vault.authorizeAccount(_user);
  });

  tearDown(() async {
    await database.close();
  });

  test(
    'shares equivalent in-flight requests but allows a later fresh request',
    () async {
      final firstRpcStarted = Completer<void>();
      final releaseFirstRpc = Completer<void>();
      var rpcCount = 0;
      var barcodeCount = 0;
      final client = SupabaseClient(
        'http://localhost:54321',
        'test-publishable-key',
        httpClient: MockClient((request) async {
          if (request.url.path == '/rest/v1/rpc/employee_available_products') {
            rpcCount++;
            if (rpcCount == 1) {
              firstRpcStarted.complete();
              await releaseFirstRpc.future;
            }
            return http.Response(
              jsonEncode([_serverProduct('Fresh $rpcCount')]),
              200,
              headers: {'content-type': 'application/json'},
              request: request,
            );
          }
          if (request.url.path == '/rest/v1/product_barcodes') {
            barcodeCount++;
            return http.Response(
              '[]',
              200,
              headers: {'content-type': 'application/json'},
              request: request,
            );
          }
          throw StateError('Unexpected request: ${request.url}');
        }),
      );
      final repository = SaleRepository(
        database: database,
        vault: vault,
        client: client,
        backendHealthCheck: BackendHealthCheck(
          supabaseUrl: '',
          publishableKey: '',
        ),
      );

      final first = repository.loadProducts(_user, 'branch-1');
      await firstRpcStarted.future;
      final second = repository.loadProducts(_user, 'branch-1');
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(rpcCount, 1);
      releaseFirstRpc.complete();
      final results = await Future.wait([first, second]);

      expect(results[0].single.name, 'Fresh 1');
      expect(results[1].single.name, 'Fresh 1');
      expect(rpcCount, 1);
      expect(barcodeCount, 1);

      final later = await repository.loadProducts(_user, 'branch-1');
      expect(later.single.name, 'Fresh 2');
      expect(rpcCount, 2);
      expect(barcodeCount, 2);
    },
  );

  test(
    'a stale response cannot overwrite a newer queued product edit result',
    () async {
      final firstRpcStarted = Completer<void>();
      final secondRpcStarted = Completer<void>();
      final releaseFirstRpc = Completer<void>();
      var rpcCount = 0;
      final client = SupabaseClient(
        'http://localhost:54321',
        'test-publishable-key',
        httpClient: MockClient((request) async {
          if (request.url.path == '/rest/v1/rpc/employee_available_products') {
            rpcCount++;
            if (rpcCount == 1) {
              firstRpcStarted.complete();
              await releaseFirstRpc.future;
              return http.Response(
                jsonEncode([_serverProduct('Old response')]),
                200,
                headers: {'content-type': 'application/json'},
                request: request,
              );
            }
            secondRpcStarted.complete();
            return http.Response(
              jsonEncode([_serverProduct('New response')]),
              200,
              headers: {'content-type': 'application/json'},
              request: request,
            );
          }
          if (request.url.path == '/rest/v1/product_barcodes') {
            return http.Response(
              '[]',
              200,
              headers: {'content-type': 'application/json'},
              request: request,
            );
          }
          throw StateError('Unexpected request: ${request.url}');
        }),
      );
      final repository = SaleRepository(
        database: database,
        vault: vault,
        client: client,
        backendHealthCheck: BackendHealthCheck(
          supabaseUrl: '',
          publishableKey: '',
        ),
      );

      final oldRequest = repository.loadProducts(_user, 'branch-1');
      await firstRpcStarted.future;
      await vault.cacheValue(_user, 'dashboard:product-options', [
        {
          'units': [
            {
              'id': '44444444-4444-4444-8444-444444444444',
              'name': 'Each',
              'abbreviation': 'ea',
              'conversion_factor': 1,
              'is_base_unit': true,
              'is_active': true,
            },
          ],
        },
      ]);
      await vault.cacheValue(_user, 'dashboard:pending_actions', [
        {
          'id': 'queued-edit',
          'type': 'update_product',
          'status': 'pending_sync',
          'payload': {
            'product_id': '33333333-3333-4333-8333-333333333333',
            'name': 'Queued edit',
            'sku': 'EDIT-1',
            'barcodes': ['EDIT-123'],
            'base_unit_id': '44444444-4444-4444-8444-444444444444',
            'sale_unit_ids': ['44444444-4444-4444-8444-444444444444'],
            'default_sale_unit_id': '44444444-4444-4444-8444-444444444444',
            'default_purchase_unit_id': '44444444-4444-4444-8444-444444444444',
            'pricing_branch_ids': ['branch-1'],
            'pricing_method': 'fixed_price',
            'rounding_rule': 'none',
            'base_price': 15,
            'sale_prices': {'44444444-4444-4444-8444-444444444444': 15},
            'price_points': [],
          },
        },
      ]);

      final newerRequest = repository.loadProducts(_user, 'branch-1');
      await secondRpcStarted.future;
      final newerProducts = await newerRequest;
      expect(newerProducts.single.name, 'Queued edit');
      releaseFirstRpc.complete();
      final olderProducts = await oldRequest;

      expect(olderProducts.single.name, 'Queued edit');
      expect(rpcCount, 2);
      final savedServerSnapshot = await vault
          .readCachedValue<Map<String, dynamic>>(
            _user,
            'sale-products-server:branch-1',
          );
      final savedRows = (savedServerSnapshot?['rows'] as List)
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .toList();
      expect(savedRows.single['name'], 'New response');
    },
  );

  test('offline cached edits rebuild the local barcode lookup index', () async {
    await vault.cacheValue(_user, 'sale-products-server:branch-1', {
      'rows': [_serverProduct('Before edit')],
      'applied_local_sale_ids': <String>[],
    });
    await vault.cacheValue(_user, 'dashboard:product-options', [
      {
        'units': [
          {
            'id': '44444444-4444-4444-8444-444444444444',
            'name': 'Each',
            'abbreviation': 'ea',
            'conversion_factor': 1,
            'is_base_unit': true,
            'is_active': true,
          },
        ],
      },
    ]);
    await vault.cacheValue(_user, 'dashboard:pending_actions', [
      {
        'id': 'queued-edit',
        'type': 'update_product',
        'status': 'pending_sync',
        'payload': {
          'product_id': '33333333-3333-4333-8333-333333333333',
          'name': 'After edit',
          'sku': 'SKU-2',
          'barcodes': ['NEW-123'],
          'base_unit_id': '44444444-4444-4444-8444-444444444444',
          'sale_unit_ids': ['44444444-4444-4444-8444-444444444444'],
          'default_sale_unit_id': '44444444-4444-4444-8444-444444444444',
          'default_purchase_unit_id': '44444444-4444-4444-8444-444444444444',
          'pricing_branch_ids': ['branch-1'],
          'pricing_method': 'fixed_price',
          'rounding_rule': 'none',
          'base_price': 15,
          'sale_prices': {'44444444-4444-4444-8444-444444444444': 15},
          'price_points': [],
        },
      },
    ]);
    final repository = SaleRepository(
      database: database,
      vault: vault,
      client: null,
      backendHealthCheck: BackendHealthCheck(
        supabaseUrl: '',
        publishableKey: '',
      ),
    );

    final products = await repository.loadProducts(_user, 'branch-1');
    final matched = await repository.findProductByBarcode(
      user: _user,
      branchId: 'branch-1',
      products: products,
      barcode: 'new-123',
    );

    expect(products.single.name, 'After edit');
    expect(products.single.sellingPrice, 15);
    expect(matched?.productId, '33333333-3333-4333-8333-333333333333');
  });

  test('does not share requests across accounts or branches', () async {
    final thirdRequestStarted = Completer<void>();
    final releaseRequests = Completer<void>();
    var rpcCount = 0;
    final client = SupabaseClient(
      'http://localhost:54321',
      'test-publishable-key',
      httpClient: MockClient((request) async {
        if (request.url.path == '/rest/v1/rpc/employee_available_products') {
          rpcCount++;
          if (rpcCount == 3) thirdRequestStarted.complete();
          await releaseRequests.future;
          return http.Response(
            jsonEncode([_serverProduct('Product')]),
            200,
            headers: {'content-type': 'application/json'},
            request: request,
          );
        }
        if (request.url.path == '/rest/v1/product_barcodes') {
          return http.Response(
            '[]',
            200,
            headers: {'content-type': 'application/json'},
            request: request,
          );
        }
        throw StateError('Unexpected request: ${request.url}');
      }),
    );
    final repository = SaleRepository(
      database: database,
      vault: vault,
      client: client,
      backendHealthCheck: BackendHealthCheck(
        supabaseUrl: '',
        publishableKey: '',
      ),
    );
    const twoBranchUser = RetivoxUser(
      id: '11111111-1111-4111-8111-111111111111',
      businessId: '22222222-2222-4222-8222-222222222222',
      name: 'Owner',
      email: 'owner@example.test',
      businessName: 'Sample business',
      role: RetivoxRole.owner,
      branches: [
        BranchAccess(id: 'branch-1', name: 'Branch 1', role: 'owner'),
        BranchAccess(id: 'branch-2', name: 'Branch 2', role: 'owner'),
      ],
      currency: 'KES',
    );
    const otherAccount = RetivoxUser(
      id: '55555555-5555-4555-8555-555555555555',
      businessId: '66666666-6666-4666-8666-666666666666',
      name: 'Other owner',
      email: 'other@example.test',
      businessName: 'Other business',
      role: RetivoxRole.owner,
      branches: [BranchAccess(id: 'branch-1', name: 'Branch 1', role: 'owner')],
      currency: 'KES',
    );
    await vault.authorizeAccount(otherAccount);

    final requests = [
      repository.loadProducts(twoBranchUser, 'branch-1'),
      repository.loadProducts(twoBranchUser, 'branch-2'),
      repository.loadProducts(otherAccount, 'branch-1'),
    ];
    await thirdRequestStarted.future.timeout(const Duration(seconds: 2));
    expect(rpcCount, 3);
    releaseRequests.complete();
    await Future.wait(requests);
  });
}
