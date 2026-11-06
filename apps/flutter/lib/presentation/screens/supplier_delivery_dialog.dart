import 'package:flutter/material.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';

class SupplierDeliveryDialog extends StatefulWidget {
  const SupplierDeliveryDialog({
    required this.user,
    required this.repository,
    required this.options,
    required this.suppliers,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;
  final TransferOptionsSnapshot options;
  final List<Map<String, dynamic>> suppliers;

  @override
  State<SupplierDeliveryDialog> createState() => _SupplierDeliveryDialogState();
}

class _SupplierDeliveryDialogState extends State<SupplierDeliveryDialog> {
  final _formKey = GlobalKey<FormState>();
  final _referenceController = TextEditingController();
  final _quantityController = TextEditingController();
  final _costController = TextEditingController();
  late final List<Map<String, dynamic>> _branches;
  late final List<Map<String, dynamic>> _products;
  String? _branchId;
  String? _supplierId;
  String? _productId;
  String? _uomId;
  final List<Map<String, Object?>> _items = [];
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    final managedIds = widget.user.branches
        .where((branch) => branch.role == 'admin' || branch.role == 'owner')
        .map((branch) => branch.id)
        .toSet();
    _branches = widget.user.role == RetivoxRole.owner
        ? widget.options.branches
        : widget.options.branches
              .where((branch) => managedIds.contains(branch['id']?.toString()))
              .toList();
    final productsById = <String, Map<String, dynamic>>{};
    for (final row in widget.options.stockRows) {
      final product = _nested(row['products']);
      final id = row['product_id']?.toString();
      if (id == null || product == null || productsById.containsKey(id)) {
        continue;
      }
      final purchaseUnits = (row['uom_options'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .where((unit) => unit['is_purchase_uom'] == true)
          .toList();
      productsById[id] = {
        'id': id,
        'name': product['name']?.toString() ?? 'Product',
        'sku': product['sku']?.toString(),
        'uom_options': purchaseUnits,
      };
    }
    _products = productsById.values.toList()
      ..sort((a, b) => (a['name'] as String).compareTo(b['name'] as String));
    if (_branches.isNotEmpty) _branchId = _branches.first['id']?.toString();
    final activeSuppliers = widget.suppliers
        .where((supplier) => supplier['is_active'] == true)
        .toList();
    if (activeSuppliers.isNotEmpty) {
      _supplierId = activeSuppliers.first['id']?.toString();
    }
  }

  @override
  void dispose() {
    _referenceController.dispose();
    _quantityController.dispose();
    _costController.dispose();
    super.dispose();
  }

  static Map<String, dynamic>? _nested(Object? value) =>
      value is Map<String, dynamic> ? value : null;

  Map<String, dynamic>? get _selectedProduct {
    for (final product in _products) {
      if (product['id'] == _productId) return product;
    }
    return null;
  }

  List<Map<String, dynamic>> get _selectedUnits =>
      (_selectedProduct?['uom_options'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList();

  void _selectProduct(String? id) {
    setState(() {
      _productId = id;
      final units = _selectedUnits;
      _uomId = units.isEmpty ? null : units.first['id']?.toString();
    });
  }

  void _addItem() {
    final quantity = double.tryParse(_quantityController.text.trim());
    if (_productId == null ||
        _uomId == null ||
        quantity == null ||
        quantity <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Select a product and unit, then enter a valid quantity.',
          ),
        ),
      );
      return;
    }
    final costText = _costController.text.trim();
    final cost = costText.isEmpty ? null : double.tryParse(costText);
    if (costText.isNotEmpty && (cost == null || cost < 0)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid non-negative total cost.')),
      );
      return;
    }
    final product = _selectedProduct!;
    final unit = _selectedUnits.firstWhere(
      (item) => item['id']?.toString() == _uomId,
    );
    setState(() {
      final item = <String, Object?>{
        'productId': _productId,
        'uomId': _uomId,
        'quantity': quantity,
        '_label':
            '${product['name']} · $quantity ${unit['abbreviation'] ?? unit['name'] ?? ''}',
      };
      if (cost != null) item['unitCost'] = cost;
      _items.add(item);
      _quantityController.clear();
      _costController.clear();
    });
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Add at least one product to the delivery.'),
        ),
      );
      return;
    }
    final supplier = widget.suppliers.firstWhere(
      (row) => row['id']?.toString() == _supplierId,
    );
    setState(() => _isSaving = true);
    try {
      await widget.repository.recordSupplierDelivery(
        widget.user,
        branchId: _branchId!,
        supplierId: _supplierId!,
        supplierName: supplier['name']?.toString() ?? '',
        referenceCode: _referenceController.text,
        items: _items
            .map(
              (item) => Map<String, Object?>.fromEntries(
                item.entries.where((entry) => !entry.key.startsWith('_')),
              ),
            )
            .toList(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not record delivery: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final activeSuppliers = widget.suppliers
        .where((supplier) => supplier['is_active'] == true)
        .toList();
    return AlertDialog(
      title: const Text('Record supplier delivery'),
      content: SizedBox(
        width: 620,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_branches.isEmpty ||
                    activeSuppliers.isEmpty ||
                    _products.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 12),
                    child: Text(
                      'A managed branch, active supplier, and stocked product with a purchase unit are required.',
                    ),
                  ),
                DropdownButtonFormField<String>(
                  initialValue: _branchId,
                  decoration: const InputDecoration(labelText: 'Branch'),
                  items: _branches
                      .map(
                        (row) => DropdownMenuItem(
                          value: row['id']?.toString(),
                          child: Text(row['name']?.toString() ?? 'Branch'),
                        ),
                      )
                      .toList(),
                  onChanged: (value) => setState(() => _branchId = value),
                  validator: (value) =>
                      value == null ? 'Select a branch.' : null,
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _supplierId,
                  decoration: const InputDecoration(labelText: 'Supplier'),
                  items: activeSuppliers
                      .map(
                        (row) => DropdownMenuItem(
                          value: row['id']?.toString(),
                          child: Text(row['name']?.toString() ?? 'Supplier'),
                        ),
                      )
                      .toList(),
                  onChanged: (value) => setState(() => _supplierId = value),
                  validator: (value) =>
                      value == null ? 'Select an active supplier.' : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _referenceController,
                  decoration: const InputDecoration(
                    labelText: 'Delivery reference (optional)',
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Delivery items',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: _productId,
                  decoration: const InputDecoration(labelText: 'Product'),
                  items: _products
                      .map(
                        (row) => DropdownMenuItem(
                          value: row['id']?.toString(),
                          child: Text(
                            '${row['name']}${row['sku'] == null ? '' : ' · ${row['sku']}'}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: _selectProduct,
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _uomId,
                        decoration: const InputDecoration(
                          labelText: 'Purchase unit',
                        ),
                        items: _selectedUnits
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
                        onChanged: (value) => setState(() => _uomId = value),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _quantityController,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: const InputDecoration(
                          labelText: 'Quantity',
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _costController,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: const InputDecoration(
                          labelText: 'Total cost (optional)',
                        ),
                      ),
                    ),
                  ],
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: _products.isEmpty ? null : _addItem,
                    icon: const Icon(Icons.add),
                    label: const Text('Add item'),
                  ),
                ),
                for (var index = 0; index < _items.length; index++)
                  ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(_items[index]['_label']?.toString() ?? ''),
                    trailing: IconButton(
                      tooltip: 'Remove item',
                      onPressed: () => setState(() => _items.removeAt(index)),
                      icon: const Icon(Icons.close),
                    ),
                  ),
                const SizedBox(height: 8),
                Text(
                  widget.user.role == RetivoxRole.owner
                      ? 'Recording as owner immediately receives the delivery into stock.'
                      : 'This delivery will be sent to the owner for approval before stock is updated.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed:
              _isSaving ||
                  _branches.isEmpty ||
                  activeSuppliers.isEmpty ||
                  _products.isEmpty
              ? null
              : _save,
          child: _isSaving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Record delivery'),
        ),
      ],
    );
  }
}
