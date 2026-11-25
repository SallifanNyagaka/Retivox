import 'package:flutter_test/flutter_test.dart';
import 'package:retivox_client/features/sales/sale_repository.dart';

void main() {
  const uom = {'id': 'unit-id', 'conversionFactor': 1};

  SaleProduct product({
    required String method,
    required List<Map<String, dynamic>> options,
    String rounding = 'none',
    List<String> barcodes = const [],
  }) {
    return SaleProduct(
      optionId: 'normal:product-id',
      productId: 'product-id',
      name: 'Test product',
      sku: 'TEST-1',
      sellingPrice: 10,
      pricingMethod: method,
      roundingRule: rounding,
      pricingOptions: options,
      uomOptions: const [uom],
      quantityOnHand: 10,
      quantityReserved: 0,
      baseQuantityOnHand: 10,
      baseQuantityReserved: 0,
      recoveryItemId: null,
      stockSource: 'normal',
      barcodes: barcodes,
    );
  }

  group('findSaleProductByBarcode', () {
    test('matches normalized barcode from the local catalog', () {
      final item = product(
        method: 'fixed_price',
        options: const [],
        barcodes: const ['  Ab-123  '],
      );

      expect(findSaleProductByBarcode([item], 'ab-123'), same(item));
    });

    test('returns null for an unknown or empty barcode', () {
      final item = product(
        method: 'fixed_price',
        options: const [],
        barcodes: const ['AB-123'],
      );

      expect(findSaleProductByBarcode([item], 'unknown'), isNull);
      expect(findSaleProductByBarcode([item], '  '), isNull);
    });
  });

  group('SaleProduct.previewPrice', () {
    test('manual quantity only previews configured quantities', () {
      final item = product(
        method: 'manual_quantity',
        options: [
          {'uomId': 'unit-id', 'baseQuantity': 1, 'price': 10},
          {'uomId': 'unit-id', 'baseQuantity': 2, 'price': 18},
        ],
      );

      expect(item.previewPrice(2, uom), 18);
      expect(item.previewPrice(3, uom), isNull);
    });

    test('assisted quantity applies the configured rounding rule', () {
      final item = product(
        method: 'assisted_pack',
        rounding: 'up_5',
        options: [
          {'uomId': 'unit-id', 'baseQuantity': 1, 'price': 11},
        ],
      );

      expect(item.previewPrice(2, uom), 25);
    });
  });

  group('applyLocalSaleQuantities', () {
    test('deducts pending sale quantities using the saved UOM conversion', () {
      final serverRow = product(
        method: 'fixed_price',
        options: const [],
      ).toJson();
      final result = applyLocalSaleQuantities(
        [
          serverRow,
          {
            ...serverRow,
            'option_id': 'normal:another-product',
            'product_id': 'another-product',
            'base_quantity_on_hand': 4,
            'quantity_on_hand': 4,
          },
        ],
        [
          {
            'items': [
              {
                'productId': 'product-id',
                'quantity': 2,
                'productSnapshot': {'option_id': 'normal:product-id'},
                'uomSnapshot': {'conversionFactor': 3},
              },
            ],
          },
        ],
      );

      expect(result.first['base_quantity_on_hand'], 4);
      expect(result.first['quantity_on_hand'], 4);
      expect(result.last['base_quantity_on_hand'], 4);
      expect(serverRow['base_quantity_on_hand'], 10);
    });

    test('never reports negative cached stock after pending sales', () {
      final serverRow = {
        ...product(method: 'fixed_price', options: const []).toJson(),
        'base_quantity_on_hand': 2,
        'quantity_on_hand': 2,
      };
      final result = applyLocalSaleQuantities(
        [serverRow],
        [
          {
            'items': [
              {
                'productId': 'product-id',
                'quantity': 3,
                'productSnapshot': {'option_id': 'normal:product-id'},
                'uomSnapshot': {'conversionFactor': 1},
              },
            ],
          },
        ],
      );

      expect(result.single['base_quantity_on_hand'], 0);
      expect(result.single['quantity_on_hand'], 0);
    });

    test('does not mutate the saved server catalog rows', () {
      final serverRow = product(
        method: 'fixed_price',
        options: const [],
      ).toJson();
      applyLocalSaleQuantities(
        [serverRow],
        [
          {
            'items': [
              {
                'productId': 'product-id',
                'quantity': 1,
                'productSnapshot': {'option_id': 'normal:product-id'},
                'uomSnapshot': {'conversionFactor': 1},
              },
            ],
          },
        ],
      );

      expect(serverRow['base_quantity_on_hand'], 10);
    });
  });

  group('applyLocalStockAdjustments', () {
    test('applies queued add/remove actions only to the selected branch', () {
      final result = applyLocalStockAdjustments(
        [
          {
            'product_id': 'product-id',
            'base_quantity_on_hand': 10,
            'quantity_on_hand': 10,
          },
          {
            'product_id': 'other-product',
            'base_quantity_on_hand': 8,
            'quantity_on_hand': 8,
          },
        ],
        cachedStockRows: const [
          {
            'id': 'stock-1',
            'branch_id': 'branch-1',
            'product_id': 'product-id',
          },
          {
            'id': 'stock-2',
            'branch_id': 'branch-2',
            'product_id': 'other-product',
          },
        ],
        pendingActions: const [
          {
            'type': 'adjust_stock',
            'payload': {
              'stock_id': 'stock-1',
              'quantity': 3,
              'operation': 'add',
            },
          },
          {
            'type': 'adjust_stock',
            'payload': {
              'stock_id': 'stock-2',
              'quantity': 5,
              'operation': 'remove',
            },
          },
        ],
        branchId: 'branch-1',
      );

      expect(result.first['base_quantity_on_hand'], 13);
      expect(result.last['base_quantity_on_hand'], 8);
    });

    test('clamps queued removals at zero', () {
      final result = applyLocalStockAdjustments(
        [
          {'product_id': 'product-id', 'base_quantity_on_hand': 2},
        ],
        cachedStockRows: const [
          {
            'id': 'stock-1',
            'branch_id': 'branch-1',
            'product_id': 'product-id',
          },
        ],
        pendingActions: const [
          {
            'type': 'adjust_stock',
            'payload': {
              'stock_id': 'stock-1',
              'quantity': 7,
              'operation': 'remove',
            },
          },
        ],
        branchId: 'branch-1',
      );

      expect(result.single['base_quantity_on_hand'], 0);
    });
  });

  group('applyLocalSupplierReceipts', () {
    test('reflects owner receipts using the saved purchase UOM factor', () {
      final result = applyLocalSupplierReceipts(
        [
          {
            'product_id': 'product-id',
            'base_quantity_on_hand': 10,
            'quantity_on_hand': 10,
          },
        ],
        cachedTransferOptions: const [
          {
            'products': [
              {
                'id': 'product-id',
                'uom_options': [
                  {'id': 'case', 'conversion_factor': 12},
                ],
              },
            ],
          },
        ],
        cachedDeliveries: const [],
        pendingActions: const [
          {
            'type': 'record_supplier_delivery',
            'payload': {
              'branch_id': 'branch-1',
              'items': [
                {'productId': 'product-id', 'uomId': 'case', 'quantity': 2},
              ],
            },
          },
        ],
        branchId: 'branch-1',
        ownerCanReceiveImmediately: true,
      );

      expect(result.single['base_quantity_on_hand'], 34);
    });

    test('does not expose unapproved admin receipts as sellable stock', () {
      final result = applyLocalSupplierReceipts(
        [
          {'product_id': 'product-id', 'base_quantity_on_hand': 10},
        ],
        cachedTransferOptions: const [],
        cachedDeliveries: const [],
        pendingActions: const [],
        branchId: 'branch-1',
        ownerCanReceiveImmediately: false,
      );

      expect(result.single['base_quantity_on_hand'], 10);
    });

    test(
      'includes cached approved deliveries after offline acknowledgement',
      () {
        final result = applyLocalSupplierReceipts(
          [
            {'product_id': 'product-id', 'base_quantity_on_hand': 10},
          ],
          cachedTransferOptions: const [],
          cachedDeliveries: const [
            {
              'id': 'delivery-id',
              'to_branch_id': 'branch-1',
              'items': [
                {'product_id': 'product-id', 'base_quantity_expected': 6},
              ],
            },
          ],
          pendingActions: const [
            {
              'type': 'acknowledge_supplier_delivery',
              'payload': {'delivery_id': 'delivery-id'},
            },
          ],
          branchId: 'branch-1',
          ownerCanReceiveImmediately: false,
        );

        expect(result.single['base_quantity_on_hand'], 16);
      },
    );
  });

  group('applyPendingProductCatalogActions', () {
    final units = [
      {
        'id': 'unit-id',
        'name': 'Each',
        'abbreviation': 'ea',
        'conversion_factor': 1,
        'is_base_unit': true,
        'is_active': true,
      },
      {
        'id': 'case-id',
        'name': 'Case',
        'abbreviation': 'cs',
        'conversion_factor': 12,
        'is_base_unit': false,
        'is_active': true,
      },
    ];

    Map<String, dynamic> editPayload({
      List<String> saleUnitIds = const ['unit-id'],
      List<String> pricingBranchIds = const ['branch-1'],
      List<String> barcodes = const ['NEW-123'],
    }) => {
      'product_id': 'product-id',
      'name': 'Updated product',
      'sku': 'UPDATED-1',
      'barcodes': barcodes,
      'base_unit_id': 'unit-id',
      'sale_unit_ids': saleUnitIds,
      'default_sale_unit_id': 'unit-id',
      'default_purchase_unit_id': 'unit-id',
      'pricing_branch_ids': pricingBranchIds,
      'pricing_method': 'manual_quantity',
      'rounding_rule': 'none',
      'base_price': 15.0,
      'sale_prices': <String, double>{'unit-id': 15},
      'price_points': [
        {
          'uom_id': 'unit-id',
          'quantity': 2,
          'price': 28,
          'max_discount_amount': 1,
        },
      ],
    };

    test(
      'reflects queued name, price, UOM and barcode edits on the branch',
      () {
        final original = product(
          method: 'fixed_price',
          options: const [],
          barcodes: const ['OLD-123'],
        ).toJson();
        original['base_quantity_on_hand'] = 17;
        original['quantity_on_hand'] = 17;

        final result = applyPendingProductCatalogActions(
          [original],
          pendingActions: [
            {'type': 'update_product', 'payload': editPayload()},
          ],
          cachedUnits: units,
          branchId: 'branch-1',
        );

        final updated = SaleProduct.fromCachedJson(result.single);
        expect(updated.name, 'Updated product');
        expect(updated.sku, 'UPDATED-1');
        expect(updated.barcodes, ['NEW-123']);
        expect(updated.sellingPrice, 15);
        expect(updated.previewPrice(2, updated.uomOptions.first), 28);
        expect(updated.baseQuantityOnHand, 17);
        expect(updated.uomOptions.single['id'], 'unit-id');
      },
    );

    test('removes normal item when new price scope excludes its branch', () {
      final original = product(
        method: 'fixed_price',
        options: const [],
      ).toJson();
      final result = applyPendingProductCatalogActions(
        [original],
        pendingActions: [
          {
            'type': 'update_product',
            'payload': editPayload(pricingBranchIds: const ['branch-2']),
          },
        ],
        cachedUnits: units,
        branchId: 'branch-1',
      );

      expect(result, isEmpty);
    });

    test(
      'deactivation hides an existing item and local creation is not sellable',
      () {
        final original = product(
          method: 'fixed_price',
          options: const [],
        ).toJson();
        final result = applyPendingProductCatalogActions(
          [original],
          pendingActions: const [
            {
              'type': 'create_product',
              'payload': {'local_product_id': 'local-product:pending'},
            },
            {
              'type': 'set_product_active',
              'payload': {'product_id': 'product-id', 'is_active': false},
            },
          ],
          cachedUnits: units,
          branchId: 'branch-1',
        );

        expect(result, isEmpty);
      },
    );

    test('does not apply a rejected product edit', () {
      final original = product(
        method: 'fixed_price',
        options: const [],
        barcodes: const ['OLD-123'],
      ).toJson();
      final result = applyPendingProductCatalogActions(
        [original],
        pendingActions: [
          {
            'type': 'update_product',
            'error': 'The update was rejected.',
            'payload': editPayload(),
          },
        ],
        cachedUnits: units,
        branchId: 'branch-1',
      );

      expect(result.single['name'], 'Test product');
      expect(result.single['barcodes'], ['OLD-123']);
    });
  });
}
