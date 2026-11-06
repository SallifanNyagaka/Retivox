import 'package:flutter/material.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';

class TransferInitiateDialog extends StatefulWidget {
  const TransferInitiateDialog({
    required this.user,
    required this.repository,
    required this.options,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;
  final TransferOptionsSnapshot options;

  @override
  State<TransferInitiateDialog> createState() => _TransferInitiateDialogState();
}

class _TransferInitiateDialogState extends State<TransferInitiateDialog> {
  late final List<Map<String, dynamic>> _sourceBranches;
  late String? _fromBranchId;
  String? _toBranchId;
  String _notes = '';
  String? _error;
  bool _isSaving = false;
  final List<_TransferDraftLine> _lines = [_TransferDraftLine()];

  @override
  void initState() {
    super.initState();
    _sourceBranches = widget.options.branches.where((branch) {
      final id = branch['id']?.toString();
      return widget.user.branches.any(
        (access) =>
            access.id == id &&
            (access.role == 'admin' || access.role == 'owner'),
      );
    }).toList();
    _fromBranchId = _sourceBranches.firstOrNull?['id']?.toString();
    _toBranchId = widget.options.branches
        .where((branch) => branch['id']?.toString() != _fromBranchId)
        .firstOrNull?['id']
        ?.toString();
  }

  @override
  void dispose() {
    for (final line in _lines) {
      line.quantity.dispose();
    }
    super.dispose();
  }

  List<Map<String, dynamic>> get _sourceStockRows => widget.options.stockRows
      .where((row) => row['branch_id']?.toString() == _fromBranchId)
      .toList();

  List<Map<String, dynamic>> _purchaseUoms(Map<String, dynamic> stock) {
    final options = stock['uom_options'] is List
        ? (stock['uom_options'] as List)
              .whereType<Map<String, dynamic>>()
              .toList()
        : <Map<String, dynamic>>[];
    final purchaseOptions = options
        .where((uom) => uom['is_purchase_uom'] == true)
        .toList();
    return purchaseOptions.isEmpty ? options : purchaseOptions;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Initiate stock transfer'),
      content: SizedBox(
        width: 720,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              DropdownButtonFormField<String>(
                initialValue: _fromBranchId,
                decoration: const InputDecoration(labelText: 'From branch'),
                items: _sourceBranches
                    .map(
                      (branch) => DropdownMenuItem(
                        value: branch['id'].toString(),
                        child: Text(branch['name']?.toString() ?? 'Branch'),
                      ),
                    )
                    .toList(),
                onChanged: _isSaving
                    ? null
                    : (value) => setState(() {
                        _fromBranchId = value;
                        _toBranchId = widget.options.branches
                            .where(
                              (branch) => branch['id']?.toString() != value,
                            )
                            .firstOrNull?['id']
                            ?.toString();
                        for (final line in _lines) {
                          line.productStockId = null;
                          line.uomId = null;
                          line.quantity.clear();
                        }
                      }),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _toBranchId,
                decoration: const InputDecoration(labelText: 'To branch'),
                items: widget.options.branches
                    .where(
                      (branch) => branch['id']?.toString() != _fromBranchId,
                    )
                    .map(
                      (branch) => DropdownMenuItem(
                        value: branch['id'].toString(),
                        child: Text(branch['name']?.toString() ?? 'Branch'),
                      ),
                    )
                    .toList(),
                onChanged: _isSaving
                    ? null
                    : (value) => setState(() => _toBranchId = value),
              ),
              const SizedBox(height: 18),
              if (_sourceStockRows.isEmpty)
                const Card(
                  child: ListTile(
                    leading: Icon(Icons.inventory_2_outlined),
                    title: Text('No source stock is available'),
                    subtitle: Text(
                      'Choose a branch with stock loaded and an active admin assignment.',
                    ),
                  ),
                ),
              for (var index = 0; index < _lines.length; index++)
                _buildLine(index),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _isSaving
                      ? null
                      : () => setState(() => _lines.add(_TransferDraftLine())),
                  icon: const Icon(Icons.add),
                  label: const Text('Add product'),
                ),
              ),
              const SizedBox(height: 8),
              TextFormField(
                enabled: !_isSaving,
                maxLength: 1000,
                decoration: const InputDecoration(
                  labelText: 'Notes (optional)',
                  alignLabelWithHint: true,
                ),
                maxLines: 3,
                onChanged: (value) => _notes = value,
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _isSaving || _sourceStockRows.isEmpty ? null : _submit,
          child: _isSaving
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Initiate transfer'),
        ),
      ],
    );
  }

  Widget _buildLine(int index) {
    final line = _lines[index];
    final stockRows = _sourceStockRows;
    final stock = stockRows
        .where((row) => row['id']?.toString() == line.productStockId)
        .firstOrNull;
    final uoms = stock == null
        ? <Map<String, dynamic>>[]
        : _purchaseUoms(stock);
    final selectedUom = uoms
        .where((option) => option['id']?.toString() == line.uomId)
        .firstOrNull;
    final available = _available(stock);
    final product = _nested(stock?['products']);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: line.productStockId,
                    decoration: const InputDecoration(labelText: 'Product'),
                    items: stockRows.map((row) {
                      final rowProduct = _nested(row['products']);
                      final quantity = _available(row);
                      return DropdownMenuItem(
                        value: row['id']?.toString(),
                        child: Text(
                          '${rowProduct?['name'] ?? 'Product'}'
                          '${rowProduct?['sku'] == null ? '' : ' · ${rowProduct?['sku']}'}'
                          ' · ${_quantity(quantity)} base units available',
                        ),
                      );
                    }).toList(),
                    onChanged: _isSaving
                        ? null
                        : (value) => setState(() {
                            line.productStockId = value;
                            final selected = stockRows
                                .where((row) => row['id']?.toString() == value)
                                .firstOrNull;
                            final options = selected == null
                                ? <Map<String, dynamic>>[]
                                : _purchaseUoms(selected);
                            final defaultUom = options
                                .where(
                                  (option) =>
                                      option['is_default_purchase_uom'] == true,
                                )
                                .firstOrNull;
                            line.uomId =
                                defaultUom?['id']?.toString() ??
                                options.firstOrNull?['id']?.toString();
                          }),
                  ),
                ),
                if (_lines.length > 1)
                  IconButton(
                    tooltip: 'Remove product',
                    onPressed: _isSaving
                        ? null
                        : () => setState(() {
                            _lines.removeAt(index).quantity.dispose();
                          }),
                    icon: const Icon(Icons.delete_outline),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue:
                        uoms.any(
                          (option) => option['id']?.toString() == line.uomId,
                        )
                        ? line.uomId
                        : null,
                    decoration: const InputDecoration(
                      labelText: 'Transfer unit',
                    ),
                    items: uoms
                        .map(
                          (option) => DropdownMenuItem(
                            value: option['id']?.toString(),
                            child: Text(
                              option['abbreviation']?.toString() ??
                                  option['name']?.toString() ??
                                  'Unit',
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: _isSaving
                        ? null
                        : (value) => setState(() => line.uomId = value),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: line.quantity,
                    enabled: !_isSaving,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'Quantity',
                      hintText: 'e.g. 2',
                    ),
                  ),
                ),
              ],
            ),
            if (stock != null && selectedUom != null)
              Align(
                alignment: Alignment.centerLeft,
                child: Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    'Available: ${_quantity(available)} base units'
                    ' · 1 ${selectedUom['abbreviation'] ?? selectedUom['name']} = ${_quantity(_number(selectedUom['conversion_factor']))} base units'
                    '${product == null ? '' : ' · ${product['name']}'}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    if (_fromBranchId == null ||
        _toBranchId == null ||
        _fromBranchId == _toBranchId) {
      setState(
        () => _error = 'Choose different source and destination branches.',
      );
      return;
    }
    if (_lines.isEmpty) {
      setState(() => _error = 'Add at least one product.');
      return;
    }
    final items = <Map<String, Object?>>[];
    for (final line in _lines) {
      final stock = _sourceStockRows
          .where((row) => row['id']?.toString() == line.productStockId)
          .firstOrNull;
      final productId = stock?['product_id']?.toString();
      final quantity = double.tryParse(line.quantity.text.trim());
      final uom = stock == null
          ? null
          : _purchaseUoms(stock)
                .where((option) => option['id']?.toString() == line.uomId)
                .firstOrNull;
      if (productId == null || line.uomId == null || uom == null) {
        setState(
          () => _error =
              'Choose a stocked product and transfer unit for every row.',
        );
        return;
      }
      if (quantity == null || !quantity.isFinite || quantity <= 0) {
        setState(
          () => _error = 'Enter a quantity greater than zero for every row.',
        );
        return;
      }
      final requestedBase = quantity * _number(uom['conversion_factor']);
      if (requestedBase > _available(stock)) {
        setState(() {
          _error =
              'Insufficient available stock for ${_nested(stock?['products'])?['name'] ?? 'a selected product'}.';
        });
        return;
      }
      items.add({
        'productId': productId,
        'uomId': line.uomId,
        'quantity': quantity,
      });
    }

    setState(() {
      _isSaving = true;
      _error = null;
    });
    try {
      await widget.repository.initiateTransfer(
        widget.user,
        fromBranchId: _fromBranchId!,
        toBranchId: _toBranchId!,
        items: items,
        notes: _notes,
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  double _available(Map<String, dynamic>? stock) =>
      _number(stock?['base_quantity_on_hand'] ?? stock?['quantity_on_hand']) -
      _number(stock?['base_quantity_reserved'] ?? stock?['quantity_reserved']);

  Map<String, dynamic>? _nested(Object? value) {
    if (value is Map<String, dynamic>) return value;
    if (value is List &&
        value.isNotEmpty &&
        value.first is Map<String, dynamic>) {
      return value.first as Map<String, dynamic>;
    }
    return null;
  }

  double _number(Object? value) {
    final number = double.tryParse(value?.toString() ?? '');
    return number == null || !number.isFinite ? 0 : number;
  }

  String _quantity(double value) => value == value.roundToDouble()
      ? value.toInt().toString()
      : value
            .toStringAsFixed(4)
            .replaceFirst(RegExp(r'0+$'), '')
            .replaceFirst(RegExp(r'\.$'), '');
}

class _TransferDraftLine {
  String? productStockId;
  String? uomId;
  final TextEditingController quantity = TextEditingController(text: '1');
}
