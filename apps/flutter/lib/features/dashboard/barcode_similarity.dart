String normalizeBarcode(String value) => value.trim().toUpperCase();

String barcodeConfusableKey(String value) => normalizeBarcode(value)
    .replaceAllMapped(
      RegExp(r'[OQILSBZGT]'),
      (match) => const {
        'O': '0',
        'Q': '0',
        'I': '1',
        'L': '1',
        'S': '5',
        'B': '8',
        'Z': '2',
        'G': '6',
        'T': '7',
      }[match.group(0)]!,
    );

Map<String, dynamic>? findConfusableBarcodeOwner(
  String code,
  Iterable<Map<String, dynamic>> products, {
  String? excludedProductId,
}) {
  final normalized = normalizeBarcode(code);
  if (normalized.isEmpty) return null;
  final key = barcodeConfusableKey(code);
  for (final product in products) {
    if (product['id']?.toString() == excludedProductId) continue;
    final barcodes = product['barcodes'];
    if (barcodes is! List) continue;
    for (final value in barcodes) {
      final existing = value.toString();
      if (normalizeBarcode(existing) != normalized &&
          barcodeConfusableKey(existing) == key) {
        return {
          'product_name': product['name']?.toString() ?? 'another product',
          'code': existing,
        };
      }
    }
  }
  return null;
}
