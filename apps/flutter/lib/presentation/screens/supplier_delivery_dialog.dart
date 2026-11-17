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
  static const _newSupplier = '__new_supplier__';
  final _formKey = GlobalKey<FormState>();
  final _supplierName = TextEditingController();
  final _reference = TextEditingController();
  final _ratingNote = TextEditingController();
  final _quantity = TextEditingController();
  final _itemNotes = TextEditingController();
  final _supplierLotCode = TextEditingController();
  late final List<Map<String, dynamic>> _branches;
  late final List<Map<String, dynamic>> _products;
  final List<Map<String, TextEditingController>> _costDrafts = [
    _newCostDraft(),
  ];
  final List<Map<String, Object?>> _items = [];
  String? _branchId;
  String? _supplierId;
  String? _productId;
  String? _uomId;
  DateTime? _expiresOn;
  String _priceRating = '';
  String _qualityRating = '';
  String _availabilityRating = '';
  bool _saving = false;

  static Map<String, TextEditingController> _newCostDraft() => {
    'description': TextEditingController(),
    'amount': TextEditingController(),
  };

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
    final productRows = widget.options.products.isNotEmpty
        ? widget.options.products
        : widget.options.stockRows;
    for (final row in productRows) {
      final product = _nested(row['products']) ?? row;
      final id = row['product_id']?.toString() ?? row['id']?.toString();
      if (id == null || product == null || productsById.containsKey(id)) {
        continue;
      }
      final units = (row['uom_options'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .where((unit) => unit['is_purchase_uom'] == true)
          .toList();
      productsById[id] = {
        'id': id,
        'name': product['name']?.toString() ?? 'Product',
        'sku': product['sku']?.toString(),
        'uom_options': units,
      };
    }
    _products = productsById.values.toList()
      ..sort((a, b) => (a['name'] as String).compareTo(b['name'] as String));
    if (_branches.isNotEmpty) _branchId = _branches.first['id']?.toString();
    final supplier = widget.suppliers
        .where((row) => row['is_active'] == true)
        .firstOrNull;
    if (supplier != null) {
      _supplierId = supplier['is_pending_sync'] == true
          ? null
          : supplier['id']?.toString();
      _supplierName.text = supplier['name']?.toString() ?? '';
    }
    if (_products.isNotEmpty) _selectProduct(_products.first['id']?.toString());
  }

  @override
  void dispose() {
    _supplierName.dispose();
    _reference.dispose();
    _ratingNote.dispose();
    _quantity.dispose();
    _itemNotes.dispose();
    _supplierLotCode.dispose();
    for (final cost in _costDrafts) {
      cost['description']!.dispose();
      cost['amount']!.dispose();
    }
    super.dispose();
  }

  static Map<String, dynamic>? _nested(Object? value) =>
      value is Map<String, dynamic> ? value : null;

  Map<String, dynamic>? get _selectedProduct => _products
      .where((product) => product['id']?.toString() == _productId)
      .firstOrNull;

  List<Map<String, dynamic>> get _selectedUnits =>
      (_selectedProduct?['uom_options'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList();

  void _selectProduct(String? id) {
    setState(() {
      _productId = id;
      _expiresOn = null;
      _supplierLotCode.clear();
      final units = _selectedUnits;
      final defaultUnit = units
          .where((unit) => unit['is_default_purchase_uom'] == true)
          .firstOrNull;
      _uomId = (defaultUnit ?? (units.isEmpty ? null : units.first))?['id']
          ?.toString();
    });
  }

  void _addItem() {
    final quantity = double.tryParse(_quantity.text.trim());
    if (_productId == null ||
        _uomId == null ||
        quantity == null ||
        quantity <= 0) {
      _message(
        'Select a product and receiving unit, then enter a valid quantity.',
      );
      return;
    }
    final costs = <Map<String, Object?>>[];
    for (final draft in _costDrafts) {
      final description = draft['description']!.text.trim();
      final amountText = draft['amount']!.text.trim();
      if (description.isEmpty && amountText.isEmpty) continue;
      final amount = double.tryParse(amountText);
      if (description.isEmpty || amount == null || amount < 0) {
        _message('Complete each cost description and enter a valid amount.');
        return;
      }
      costs.add({'description': description, 'amount': amount});
    }
    final product = _selectedProduct!;
    if (product['tracks_expiry'] == true && _expiresOn == null) {
      _message('Choose an expiry date for this expiry-tracked product.');
      return;
    }
    final unit = _selectedUnits.firstWhere(
      (row) => row['id']?.toString() == _uomId,
    );
    final costTotal = costs.fold<double>(
      0,
      (total, cost) => total + (cost['amount'] as double),
    );
    setState(() {
      _items.add({
        'productId': _productId,
        'uomId': _uomId,
        'quantity': quantity,
        'expiresOn': _expiresOn?.toIso8601String().substring(0, 10) ?? '',
        'supplierLotCode': _supplierLotCode.text.trim(),
        'costs': costs,
        'notes': _itemNotes.text.trim(),
        '_label':
            '${product['name']} · $quantity ${unit['abbreviation'] ?? unit['name'] ?? ''}',
        '_cost_total': costTotal,
      });
      _quantity.clear();
      _itemNotes.clear();
      _supplierLotCode.clear();
      _expiresOn = null;
      for (final cost in _costDrafts) {
        cost['description']!.dispose();
        cost['amount']!.dispose();
      }
      _costDrafts
        ..clear()
        ..add(_newCostDraft());
    });
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_items.isEmpty) {
      _message('Add at least one product to the delivery.');
      return;
    }
    if (_supplierName.text.trim().isEmpty) {
      _message('Enter a supplier name.');
      return;
    }
    setState(() => _saving = true);
    try {
      final selectedSupplier = widget.suppliers
          .where((row) => row['id']?.toString() == _supplierId)
          .firstOrNull;
      final pendingSync = await widget.repository.recordSupplierDelivery(
        widget.user,
        branchId: _branchId!,
        supplierId: _supplierId ?? '',
        supplierName: _supplierName.text.trim(),
        referenceCode: _reference.text.trim(),
        items: _items
            .map(
              (item) => Map<String, Object?>.fromEntries(
                item.entries.where((entry) => !entry.key.startsWith('_')),
              ),
            )
            .toList(),
        supplierPhone: selectedSupplier?['phone']?.toString(),
        supplierEmail: selectedSupplier?['email']?.toString(),
        supplierContactPerson: selectedSupplier?['contact_person']?.toString(),
        supplierNotes: selectedSupplier?['notes']?.toString(),
        priceRating: int.tryParse(_priceRating),
        stockQualityRating: int.tryParse(_qualityRating),
        availabilityRating: int.tryParse(_availabilityRating),
        ratingNote: _ratingNote.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(pendingSync);
    } catch (error) {
      if (mounted) _message('Delivery was not saved: $error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _message(String text) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Widget _ratingField(
    String label,
    String value,
    ValueChanged<String?> onChanged,
  ) => DropdownButtonFormField<String>(
    initialValue: value,
    decoration: InputDecoration(labelText: label),
    items: [
      const DropdownMenuItem(value: '', child: Text('Not rated')),
      for (var rating = 1; rating <= 5; rating++)
        DropdownMenuItem(value: '$rating', child: Text('$rating / 5')),
    ],
    onChanged: _saving ? null : onChanged,
  );

  @override
  Widget build(BuildContext context) {
    final activeSuppliers = widget.suppliers
        .where((row) => row['is_active'] == true)
        .toList();
    final hasOptions = _branches.isNotEmpty && _products.isNotEmpty;
    return AlertDialog(
      title: const Text('Supplier delivery'),
      content: SizedBox(
        width: 900,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (!hasOptions)
                  const Card(
                    child: ListTile(
                      leading: Icon(Icons.info_outline),
                      title: Text('Delivery options unavailable'),
                      subtitle: Text(
                        'Connect once to cache managed branches and products before recording deliveries offline.',
                      ),
                    ),
                  ),
                LayoutBuilder(
                  builder: (context, constraints) {
                    final width = (constraints.maxWidth - 20) / 3;
                    return Wrap(
                      spacing: 10,
                      runSpacing: 8,
                      children: [
                        SizedBox(
                          width: width,
                          child: DropdownButtonFormField<String>(
                            initialValue: _branchId,
                            decoration: const InputDecoration(
                              labelText: 'Branch',
                            ),
                            items: _branches
                                .map(
                                  (row) => DropdownMenuItem(
                                    value: row['id']?.toString(),
                                    child: Text(
                                      row['name']?.toString() ?? 'Branch',
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                )
                                .toList(),
                            onChanged: _saving
                                ? null
                                : (value) => setState(() => _branchId = value),
                            validator: (value) =>
                                value == null ? 'Select a branch.' : null,
                          ),
                        ),
                        SizedBox(
                          width: width,
                          child: DropdownButtonFormField<String>(
                            initialValue: _supplierId ?? _newSupplier,
                            decoration: const InputDecoration(
                              labelText: 'Supplier',
                            ),
                            items: [
                              const DropdownMenuItem(
                                value: _newSupplier,
                                child: Text('New supplier'),
                              ),
                              ...activeSuppliers.map(
                                (row) => DropdownMenuItem(
                                  value: row['is_pending_sync'] == true
                                      ? 'pending:${row['id']}'
                                      : row['id']?.toString(),
                                  child: Text(
                                    row['name']?.toString() ?? 'Supplier',
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ),
                            ],
                            onChanged: _saving
                                ? null
                                : (value) => setState(() {
                                    if (value == _newSupplier) {
                                      _supplierId = null;
                                      _supplierName.clear();
                                    } else {
                                      final selected = activeSuppliers
                                          .firstWhere(
                                            (row) =>
                                                row['id']?.toString() ==
                                                    value ||
                                                'pending:${row['id']}' == value,
                                          );
                                      _supplierId =
                                          value?.startsWith('pending:') == true
                                          ? null
                                          : value;
                                      _supplierName.text =
                                          selected['name']?.toString() ?? '';
                                    }
                                  }),
                          ),
                        ),
                        SizedBox(
                          width: width,
                          child: TextFormField(
                            controller: _reference,
                            maxLength: 80,
                            decoration: const InputDecoration(
                              labelText: 'Reference (optional)',
                              helperText: 'Supplier invoice or delivery note',
                            ),
                          ),
                        ),
                      ],
                    );
                  },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _supplierName,
                  maxLength: 120,
                  decoration: const InputDecoration(labelText: 'Supplier name'),
                  validator: (value) => (value?.trim().isEmpty ?? true)
                      ? 'Enter a supplier name.'
                      : null,
                  onChanged: (_) {
                    if (_supplierId != null) setState(() => _supplierId = null);
                  },
                ),
                const SizedBox(height: 10),
                LayoutBuilder(
                  builder: (context, constraints) {
                    final width = (constraints.maxWidth - 24) / 4;
                    return Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        SizedBox(
                          width: width,
                          child: _ratingField(
                            'Price rating',
                            _priceRating,
                            (value) =>
                                setState(() => _priceRating = value ?? ''),
                          ),
                        ),
                        SizedBox(
                          width: width,
                          child: _ratingField(
                            'Stock quality',
                            _qualityRating,
                            (value) =>
                                setState(() => _qualityRating = value ?? ''),
                          ),
                        ),
                        SizedBox(
                          width: width,
                          child: _ratingField(
                            'Availability',
                            _availabilityRating,
                            (value) => setState(
                              () => _availabilityRating = value ?? '',
                            ),
                          ),
                        ),
                        SizedBox(
                          width: width,
                          child: TextField(
                            controller: _ratingNote,
                            decoration: const InputDecoration(
                              labelText: 'Supplier note (optional)',
                            ),
                          ),
                        ),
                        SizedBox(
                          width: width,
                          child: InkWell(
                            onTap: _saving
                                ? null
                                : () async {
                                    final selected = await showDatePicker(
                                      context: context,
                                      initialDate: _expiresOn ?? DateTime.now().add(const Duration(days: 30)),
                                      firstDate: DateTime.now(),
                                      lastDate: DateTime.now().add(const Duration(days: 365 * 20)),
                                    );
                                    if (selected != null && mounted) {
                                      setState(() => _expiresOn = selected);
                                    }
                                  },
                            child: InputDecorator(
                              decoration: InputDecoration(
                                labelText: _selectedProduct?['tracks_expiry'] == true
                                    ? 'Expiry date (required)'
                                    : 'Expiry date (optional)',
                                suffixIcon: const Icon(Icons.calendar_month_outlined),
                              ),
                              child: Text(
                                _expiresOn == null
                                    ? 'Select date'
                                    : '${_expiresOn!.year.toString().padLeft(4, '0')}-${_expiresOn!.month.toString().padLeft(2, '0')}-${_expiresOn!.day.toString().padLeft(2, '0')}',
                              ),
                            ),
                          ),
                        ),
                        SizedBox(
                          width: width,
                          child: TextField(
                            controller: _supplierLotCode,
                            maxLength: 100,
                            decoration: const InputDecoration(
                              labelText: 'Supplier batch code (optional)',
                              counterText: '',
                            ),
                          ),
                        ),
                      ],
                    );
                  },
                ),
                const SizedBox(height: 16),
                Text(
                  'Delivery items',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                LayoutBuilder(
                  builder: (context, constraints) {
                    final width = constraints.maxWidth >= 700
                        ? (constraints.maxWidth - 24) / 4
                        : constraints.maxWidth;
                    return Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        SizedBox(
                          width:
                              width * (constraints.maxWidth >= 700 ? 1.5 : 1),
                          child: DropdownButtonFormField<String>(
                            initialValue: _productId,
                            decoration: const InputDecoration(
                              labelText: 'Product',
                            ),
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
                            onChanged: _saving ? null : _selectProduct,
                          ),
                        ),
                        SizedBox(
                          width: width,
                          child: DropdownButtonFormField<String>(
                            initialValue: _uomId,
                            decoration: const InputDecoration(
                              labelText: 'Receive as',
                            ),
                            items: _selectedUnits
                                .map(
                                  (unit) => DropdownMenuItem(
                                    value: unit['id']?.toString(),
                                    child: Text(
                                      '${unit['name'] ?? unit['abbreviation'] ?? 'Unit'}${unit['conversion_factor'] == null ? '' : ' (${unit['conversion_factor']} base units)'}',
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                )
                                .toList(),
                            onChanged: _saving
                                ? null
                                : (value) => setState(() => _uomId = value),
                          ),
                        ),
                        SizedBox(
                          width: width,
                          child: TextField(
                            controller: _quantity,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            decoration: const InputDecoration(
                              labelText: 'Quantity',
                            ),
                          ),
                        ),
                      ],
                    );
                  },
                ),
                const SizedBox(height: 12),
                Text(
                  'Costs / expenses',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                for (var index = 0; index < _costDrafts.length; index++)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _costDrafts[index]['description'],
                            decoration: const InputDecoration(
                              labelText: 'Description, e.g. transport',
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        SizedBox(
                          width: 180,
                          child: TextField(
                            controller: _costDrafts[index]['amount'],
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            decoration: const InputDecoration(
                              labelText: 'Amount',
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Remove cost',
                          onPressed: _saving || _costDrafts.length == 1
                              ? null
                              : () => setState(() {
                                  final removed = _costDrafts.removeAt(index);
                                  removed['description']!.dispose();
                                  removed['amount']!.dispose();
                                }),
                          icon: const Icon(Icons.close),
                        ),
                      ],
                    ),
                  ),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: _saving
                        ? null
                        : () =>
                              setState(() => _costDrafts.add(_newCostDraft())),
                    icon: const Icon(Icons.add),
                    label: const Text('Add another cost'),
                  ),
                ),
                TextField(
                  controller: _itemNotes,
                  decoration: const InputDecoration(
                    labelText: 'Product notes (optional)',
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 12, bottom: 8),
                  child: Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton.tonalIcon(
                      onPressed: _saving || !hasOptions ? null : _addItem,
                      icon: const Icon(Icons.add),
                      label: const Text('Add another product'),
                    ),
                  ),
                ),
                for (var index = 0; index < _items.length; index++)
                  Card(
                    child: ListTile(
                      title: Text(
                        _items[index]['_label']?.toString() ?? 'Product',
                      ),
                      subtitle: Text(
                        'Costs: ${_items[index]['_cost_total']} · ${(_items[index]['notes'] as String).isEmpty ? 'No item note' : _items[index]['notes']}',
                      ),
                      trailing: IconButton(
                        tooltip: 'Remove item',
                        onPressed: _saving
                            ? null
                            : () => setState(() => _items.removeAt(index)),
                        icon: const Icon(Icons.delete_outline),
                      ),
                    ),
                  ),
                const SizedBox(height: 8),
                Text(
                  widget.user.role == RetivoxRole.owner
                      ? 'As owner, this delivery will be recorded and received into stock.'
                      : 'This delivery will be queued for owner approval before stock is updated.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const Text(
                  'If offline, the delivery is saved securely on this device and synced when the server is reachable.',
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(null),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _saving || !hasOptions || _branchId == null ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Save delivery'),
        ),
      ],
    );
  }
}
