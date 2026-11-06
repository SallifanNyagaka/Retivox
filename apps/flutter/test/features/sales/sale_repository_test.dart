import 'package:flutter_test/flutter_test.dart';
import 'package:retivox_client/features/sales/sale_repository.dart';

void main() {
  const uom = {'id': 'unit-id', 'conversionFactor': 1};

  SaleProduct product({
    required String method,
    required List<Map<String, dynamic>> options,
    String rounding = 'none',
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
    );
  }

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
}
