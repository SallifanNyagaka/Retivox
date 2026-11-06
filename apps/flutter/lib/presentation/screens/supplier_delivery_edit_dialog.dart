import 'package:flutter/material.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';

class SupplierDeliveryEditDialog extends StatefulWidget {
  const SupplierDeliveryEditDialog({
    required this.user,
    required this.repository,
    required this.delivery,
    required this.options,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;
  final Map<String, dynamic> delivery;
  final TransferOptionsSnapshot options;

  @override
  State<SupplierDeliveryEditDialog> createState() =>
      _SupplierDeliveryEditDialogState();
}

class _SupplierDeliveryEditDialogState
    extends State<SupplierDeliveryEditDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _supplierName;
  late final TextEditingController _referenceCode;
  late final TextEditingController _reason;
  late final List<_DeliveryItemDraft> _items;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _supplierName = TextEditingController(
      text: widget.delivery['supplier_name']?.toString() ?? '',
    );
    _referenceCode = TextEditingController(
      text: widget.delivery['reference_code']?.toString() ?? '',
    );
    _reason = TextEditingController();
    _items = (widget.delivery['items'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map((item) {
          final product = _nested(item['products']);
          final unit = _nested(item['units_of_measure']);
          final productId = item['product_id']?.toString() ?? '';
          final stock = widget.options.stockRows.where(
            (row) => row['product_id']?.toString() == productId,
          );
          final units = stock.isEmpty
              ? <Map<String, dynamic>>[]
              : (stock.first['uom_options'] as List? ?? const [])
                    .whereType<Map<String, dynamic>>()
                    .where((option) => option['is_purchase_uom'] == true)
                    .toList();
          final currentUnitId = item['uom_id']?.toString();
          if (currentUnitId != null &&
              currentUnitId.isNotEmpty &&
              !units.any(
                (option) => option['id']?.toString() == currentUnitId,
              )) {
            units.add({
              'id': currentUnitId,
              'name': unit?['name'] ?? unit?['abbreviation'] ?? 'Current unit',
              'abbreviation': unit?['abbreviation'] ?? '',
              'is_purchase_uom': true,
            });
          }
          return _DeliveryItemDraft(
            id: item['id']?.toString() ?? '',
            productId: productId,
            productName: product?['name']?.toString() ?? 'Product',
            unitId: currentUnitId,
            units: units,
            quantity: TextEditingController(
              text:
                  item['quantity_in_uom']?.toString() ??
                  item['base_quantity_received']?.toString() ??
                  item['base_quantity_expected']?.toString() ??
                  '',
            ),
            totalCost: TextEditingController(
              text: item['total_cost']?.toString() ?? '',
            ),
            notes: TextEditingController(text: item['notes']?.toString() ?? ''),
          );
        })
        .toList();
  }

  @override
  void dispose() {
    _supplierName.dispose();
    _referenceCode.dispose();
    _reason.dispose();
    for (final item in _items) {
      item.dispose();
    }
    super.dispose();
  }

  static Map<String, dynamic>? _nested(Object? value) =>
      value is Map<String, dynamic> ? value : null;

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    for (final item in _items) {
      final quantity = double.tryParse(item.quantity.text.trim());
      final costText = item.totalCost.text.trim();
      final cost = costText.isEmpty ? null : double.tryParse(costText);
      if (item.unitId == null ||
          quantity == null ||
          !quantity.isFinite ||
          quantity <= 0 ||
          (costText.isNotEmpty &&
              (cost == null || !cost.isFinite || cost < 0))) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Enter a valid purchase unit, quantity, and cost for each line.',
            ),
          ),
        );
        return;
      }
    }
    setState(() => _saving = true);
    try {
      await widget.repository.editSupplierDelivery(
        widget.user,
        deliveryId: widget.delivery['id'].toString(),
        supplierName: _supplierName.text,
        referenceCode: _referenceCode.text,
        reason: _reason.text,
        items: _items.map((item) {
          final cost = double.tryParse(item.totalCost.text.trim());
          final payload = <String, Object?>{
            'deliveryItemId': item.id,
            'productId': item.productId,
            'uomId': item.unitId,
            'quantity': double.parse(item.quantity.text.trim()),
            'costs': const <Map<String, Object?>>[],
            'notes': item.notes.text.trim(),
          };
          if (cost != null) payload['unitCost'] = cost;
          return payload;
        }).toList(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not submit delivery edit: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Edit supplier delivery'),
    content: SizedBox(
      width: 660,
      child: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _supplierName,
                decoration: const InputDecoration(labelText: 'Supplier name'),
                validator: (value) => value == null || value.trim().isEmpty
                    ? 'Supplier name is required.'
                    : null,
              ),
              const SizedBox(height: 10),
              TextFormField(
                controller: _referenceCode,
                decoration: const InputDecoration(labelText: 'Reference'),
              ),
              const SizedBox(height: 14),
              for (final item in _items)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          item.productName,
                          style: Theme.of(context).textTheme.titleSmall,
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: DropdownButtonFormField<String>(
                                initialValue: item.unitId,
                                decoration: const InputDecoration(
                                  labelText: 'Purchase unit',
                                ),
                                items: item.units
                                    .map(
                                      (unit) => DropdownMenuItem(
                                        value: unit['id']?.toString(),
                                        child: Text(
                                          unit['abbreviation']?.toString() ??
                                              unit['name']?.toString() ??
                                              'Unit',
                                        ),
                                      ),
                                    )
                                    .toList(),
                                onChanged: (value) =>
                                    setState(() => item.unitId = value),
                                validator: (value) => value == null
                                    ? 'No purchase unit available.'
                                    : null,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: TextFormField(
                                controller: item.quantity,
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                      decimal: true,
                                    ),
                                decoration: const InputDecoration(
                                  labelText: 'Quantity',
                                ),
                                validator: (value) {
                                  final number = double.tryParse(
                                    value?.trim() ?? '',
                                  );
                                  return number == null ||
                                          !number.isFinite ||
                                          number <= 0
                                      ? 'Enter a positive quantity.'
                                      : null;
                                },
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: TextFormField(
                                controller: item.totalCost,
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                      decimal: true,
                                    ),
                                decoration: const InputDecoration(
                                  labelText: 'Total cost',
                                ),
                                validator: (value) {
                                  if (value == null || value.trim().isEmpty) {
                                    return null;
                                  }
                                  final number = double.tryParse(value.trim());
                                  return number == null ||
                                          !number.isFinite ||
                                          number < 0
                                      ? 'Enter a non-negative cost.'
                                      : null;
                                },
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        TextFormField(
                          controller: item.notes,
                          decoration: const InputDecoration(
                            labelText: 'Notes (optional)',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              if (widget.user.role == RetivoxRole.admin)
                TextFormField(
                  controller: _reason,
                  maxLength: 500,
                  decoration: const InputDecoration(
                    labelText: 'Reason for owner review (optional)',
                  ),
                ),
              Text(
                widget.user.role == RetivoxRole.owner
                    ? 'Saving applies the changes immediately and adjusts received stock.'
                    : 'Your changes will be sent to the owner for approval.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: _saving ? null : () => Navigator.of(context).pop(false),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: _saving || _items.isEmpty ? null : _save,
        child: _saving
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Text(
                widget.user.role == RetivoxRole.owner
                    ? 'Save changes'
                    : 'Request edit',
              ),
      ),
    ],
  );
}

class _DeliveryItemDraft {
  _DeliveryItemDraft({
    required this.id,
    required this.productId,
    required this.productName,
    required this.unitId,
    required this.units,
    required this.quantity,
    required this.totalCost,
    required this.notes,
  });

  final String id;
  final String productId;
  final String productName;
  String? unitId;
  final List<Map<String, dynamic>> units;
  final TextEditingController quantity;
  final TextEditingController totalCost;
  final TextEditingController notes;

  void dispose() {
    quantity.dispose();
    totalCost.dispose();
    notes.dispose();
  }
}
