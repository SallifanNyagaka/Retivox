import 'package:flutter/material.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';

class InventoryLossDialog extends StatefulWidget {
  const InventoryLossDialog({
    required this.user,
    required this.repository,
    required this.options,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;
  final DamageReportOptionsSnapshot options;

  @override
  State<InventoryLossDialog> createState() => _InventoryLossDialogState();
}

class _InventoryLossDialogState extends State<InventoryLossDialog> {
  late String? _branchId;
  String? _productId;
  String? _uomId;
  final _quantity = TextEditingController();
  final _reason = TextEditingController();
  final _recoveryPrice = TextEditingController();
  String _lossType = 'breakage';
  bool _isSaving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _branchId = widget.options.rows.firstOrNull?['branch_id']?.toString();
    _selectFirstProduct();
  }

  @override
  void dispose() {
    _quantity.dispose();
    _reason.dispose();
    _recoveryPrice.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _branchRows => widget.options.rows
      .where((row) => row['branch_id']?.toString() == _branchId)
      .toList();

  Map<String, dynamic>? get _selectedProduct => _branchRows
      .where((row) => row['product_id']?.toString() == _productId)
      .firstOrNull;

  List<Map<String, dynamic>> get _uoms =>
      _selectedProduct?['uom_options'] is List
      ? (_selectedProduct!['uom_options'] as List)
            .whereType<Map<String, dynamic>>()
            .toList()
      : const [];

  void _selectFirstProduct() {
    final first = _branchRows.firstOrNull;
    _productId = first?['product_id']?.toString();
    final uoms = first?['uom_options'] is List
        ? (first!['uom_options'] as List).whereType<Map<String, dynamic>>()
        : const <Map<String, dynamic>>[];
    _uomId = uoms.firstOrNull?['id']?.toString();
  }

  @override
  Widget build(BuildContext context) {
    final branches = <String, String>{};
    for (final row in widget.options.rows) {
      final id = row['branch_id']?.toString();
      if (id != null) {
        branches[id] = row['branch_name']?.toString() ?? 'Branch';
      }
    }
    final selectedUom = _uoms
        .where((uom) => uom['id']?.toString() == _uomId)
        .firstOrNull;
    final conversion = _number(selectedUom?['conversionFactor']);
    final selectedProduct = _selectedProduct;
    final available = _number(selectedProduct?['base_quantity_available']);
    final requestedBase = _number(_quantity.text) * conversion;
    final isOwner = widget.user.role == RetivoxRole.owner;
    return AlertDialog(
      title: Text(isOwner ? 'Record inventory loss' : 'Report damaged stock'),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (branches.length > 1)
                DropdownButtonFormField<String>(
                  initialValue: _branchId,
                  decoration: const InputDecoration(labelText: 'Branch'),
                  items: branches.entries
                      .map(
                        (entry) => DropdownMenuItem(
                          value: entry.key,
                          child: Text(entry.value),
                        ),
                      )
                      .toList(),
                  onChanged: _isSaving
                      ? null
                      : (value) => setState(() {
                          _branchId = value;
                          _selectFirstProduct();
                        }),
                ),
              DropdownButtonFormField<String>(
                initialValue: _productId,
                decoration: const InputDecoration(labelText: 'Product'),
                items: _branchRows
                    .map(
                      (row) => DropdownMenuItem(
                        value: row['product_id']?.toString(),
                        child: Text(
                          '${row['name'] ?? 'Product'}'
                          '${row['sku'] == null ? '' : ' · ${row['sku']}'}'
                          ' · ${_formatQuantity(_number(row['base_quantity_available']))} available',
                        ),
                      ),
                    )
                    .toList(),
                onChanged: _isSaving
                    ? null
                    : (value) => setState(() {
                        _productId = value;
                        final options = _uoms;
                        _uomId = options.firstOrNull?['id']?.toString();
                      }),
              ),
              DropdownButtonFormField<String>(
                initialValue:
                    _uoms.any((uom) => uom['id']?.toString() == _uomId)
                    ? _uomId
                    : null,
                decoration: const InputDecoration(labelText: 'Unit'),
                items: _uoms
                    .map(
                      (uom) => DropdownMenuItem(
                        value: uom['id']?.toString(),
                        child: Text(
                          uom['abbreviation']?.toString() ??
                              uom['name']?.toString() ??
                              'Unit',
                        ),
                      ),
                    )
                    .toList(),
                onChanged: _isSaving
                    ? null
                    : (value) => setState(() => _uomId = value),
              ),
              TextField(
                controller: _quantity,
                enabled: !_isSaving,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'Quantity affected',
                ),
              ),
              if (selectedUom != null)
                Align(
                  alignment: Alignment.centerLeft,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      'Available: ${_formatQuantity(available)} base units'
                      '${conversion > 0 ? ' · requested ${_formatQuantity(requestedBase)} base units' : ''}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: requestedBase > available
                            ? Theme.of(context).colorScheme.error
                            : null,
                      ),
                    ),
                  ),
                ),
              DropdownButtonFormField<String>(
                initialValue: _lossType,
                decoration: const InputDecoration(labelText: 'Loss type'),
                items:
                    const [
                          ('breakage', 'Breakage'),
                          ('spoilage', 'Spoilage'),
                          ('theft', 'Theft'),
                          ('markdown_damage', 'Markdown damage'),
                          ('other', 'Other'),
                        ]
                        .map(
                          (entry) => DropdownMenuItem(
                            value: entry.$1,
                            child: Text(entry.$2),
                          ),
                        )
                        .toList(),
                onChanged: _isSaving
                    ? null
                    : (value) => setState(() => _lossType = value ?? 'other'),
              ),
              TextField(
                controller: _reason,
                enabled: !_isSaving,
                maxLength: 240,
                maxLines: 2,
                decoration: const InputDecoration(labelText: 'Reason'),
              ),
              if (isOwner)
                TextField(
                  controller: _recoveryPrice,
                  enabled: !_isSaving,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText:
                        'Recovery sale price per selected unit (optional)',
                  ),
                ),
              if (_error != null)
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _isSaving ? null : _submit,
          child: _isSaving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(isOwner ? 'Record loss' : 'Submit report'),
        ),
      ],
    );
  }

  Future<void> _submit() async {
    final product = _selectedProduct;
    final quantity = double.tryParse(_quantity.text.trim());
    final recoveryPrice = double.tryParse(_recoveryPrice.text.trim()) ?? 0;
    if (_branchId == null ||
        product == null ||
        _uomId == null ||
        quantity == null ||
        !quantity.isFinite ||
        quantity <= 0 ||
        _reason.text.trim().isEmpty) {
      setState(
        () => _error = 'Complete all required fields with valid values.',
      );
      return;
    }
    final selectedUom = _uoms
        .where((uom) => uom['id']?.toString() == _uomId)
        .firstOrNull;
    final requestedBase = quantity * _number(selectedUom?['conversionFactor']);
    if (requestedBase > _number(product['base_quantity_available'])) {
      setState(() => _error = 'Quantity exceeds available stock.');
      return;
    }
    if (widget.user.role == RetivoxRole.owner) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Record inventory loss?'),
          content: const Text(
            'This will immediately deduct the reported quantity from branch stock. Continue?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Record loss'),
            ),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;
    }
    setState(() {
      _isSaving = true;
      _error = null;
    });
    try {
      if (widget.user.role == RetivoxRole.owner) {
        await widget.repository.recordInventoryLoss(
          widget.user,
          branchId: _branchId!,
          productId: _productId!,
          uomId: _uomId!,
          quantity: quantity,
          lossType: _lossType,
          reason: _reason.text,
          recoverySalePrice: recoveryPrice,
        );
      } else {
        await widget.repository.submitDamageReport(
          widget.user,
          branchId: _branchId!,
          productId: _productId!,
          uomId: _uomId!,
          quantity: quantity,
          lossType: _lossType,
          reason: _reason.text,
        );
      }
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  double _number(Object? value) {
    final result = double.tryParse(value?.toString() ?? '');
    return result == null || !result.isFinite ? 0 : result;
  }

  String _formatQuantity(double value) => value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toStringAsFixed(2);
}
