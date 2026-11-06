import 'package:flutter/material.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';

class _PricePointDraft {
  _PricePointDraft({
    required this.uomId,
    String quantity = '1',
    String price = '',
    String maxDiscount = '0',
  }) : quantity = TextEditingController(text: quantity),
       price = TextEditingController(text: price),
       maxDiscount = TextEditingController(text: maxDiscount);

  String uomId;
  final TextEditingController quantity;
  final TextEditingController price;
  final TextEditingController maxDiscount;

  void dispose() {
    quantity.dispose();
    price.dispose();
    maxDiscount.dispose();
  }
}

class ProductFormDialog extends StatefulWidget {
  const ProductFormDialog({
    required this.user,
    required this.repository,
    required this.units,
    this.branches = const [],
    this.product,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;
  final List<Map<String, dynamic>> units;
  final List<Map<String, dynamic>> branches;
  final Map<String, dynamic>? product;

  @override
  State<ProductFormDialog> createState() => _ProductFormDialogState();
}

class _ProductFormDialogState extends State<ProductFormDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _sku;
  late final TextEditingController _category;
  late final TextEditingController _subcategory;
  late final TextEditingController _brandFamily;
  late final TextEditingController _description;
  late final TextEditingController _basePrice;
  late final TextEditingController _minPrice;
  late final TextEditingController _maxPrice;
  late final TextEditingController _unit;
  final Map<String, TextEditingController> _salePriceControllers = {};
  final List<_PricePointDraft> _pricePoints = [];
  String _productKind = 'fixed_package';
  String _pricingMethod = 'fixed_price';
  String _roundingRule = 'none';
  String _pricingBranchScope = 'all';
  final Set<String> _pricingBranchIds = {};
  String? _baseUnitId;
  String? _defaultPurchaseUnitId;
  String? _defaultSaleUnitId;
  final Set<String> _purchaseUnitIds = {};
  final Set<String> _saleUnitIds = {};
  bool _saving = false;

  bool get _isEditing => widget.product != null;

  @override
  void initState() {
    super.initState();
    final product = widget.product;
    final pricing = _nested(product?['product_pricing']);
    _name = TextEditingController(text: product?['name']?.toString() ?? '');
    _sku = TextEditingController(text: product?['sku']?.toString() ?? '');
    _category = TextEditingController(
      text: product?['category']?.toString() ?? '',
    );
    _subcategory = TextEditingController(
      text: product?['subcategory']?.toString() ?? '',
    );
    _brandFamily = TextEditingController(
      text: product?['brand_family']?.toString() ?? '',
    );
    _description = TextEditingController(
      text: product?['description']?.toString() ?? '',
    );
    _basePrice = TextEditingController(
      text: pricing?['base_price']?.toString() ?? '',
    );
    _minPrice = TextEditingController(
      text: pricing?['min_price']?.toString() ?? '',
    );
    _maxPrice = TextEditingController(
      text: pricing?['max_price']?.toString() ?? '',
    );
    _unit = TextEditingController(text: product?['unit']?.toString() ?? '');
    _productKind = product?['product_kind']?.toString() == 'measured_counted'
        ? 'measured_counted'
        : 'fixed_package';
    if (_isEditing) {
      final links = _rows(product?['product_uom_links']);
      final baseLink = links.where((link) => link['is_base_uom'] == true);
      final matchingUnit = widget.units.where(
        (unit) =>
            unit['name']?.toString().toLowerCase() ==
            product?['unit']?.toString().toLowerCase(),
      );
      final validBaseIds = widget.units
          .where(
            (unit) =>
                double.tryParse(unit['conversion_factor']?.toString() ?? '') ==
                1,
          )
          .map((unit) => unit['id']?.toString())
          .whereType<String>()
          .toSet();
      final linkedBaseId = baseLink.isNotEmpty
          ? baseLink.first['uom_id']?.toString()
          : null;
      final fallbackBaseId =
          linkedBaseId != null && validBaseIds.contains(linkedBaseId)
          ? linkedBaseId
          : matchingUnit.isNotEmpty &&
                validBaseIds.contains(matchingUnit.first['id']?.toString())
          ? matchingUnit.first['id']?.toString()
          : validBaseIds.isEmpty
          ? null
          : validBaseIds.first;
      _baseUnitId = fallbackBaseId;
      final hasAvailabilityFlags = links.any(
        (link) =>
            link['is_purchase_uom'] is bool || link['is_sale_uom'] is bool,
      );
      _purchaseUnitIds.addAll(
        links
            .where(
              (link) =>
                  !hasAvailabilityFlags || link['is_purchase_uom'] != false,
            )
            .map((link) => link['uom_id']?.toString())
            .whereType<String>(),
      );
      _saleUnitIds.addAll(
        links
            .where(
              (link) => !hasAvailabilityFlags || link['is_sale_uom'] != false,
            )
            .map((link) => link['uom_id']?.toString())
            .whereType<String>(),
      );
      if (_purchaseUnitIds.isEmpty && fallbackBaseId != null) {
        _purchaseUnitIds.add(fallbackBaseId);
      }
      if (_saleUnitIds.isEmpty && fallbackBaseId != null) {
        _saleUnitIds.add(fallbackBaseId);
      }
      _defaultPurchaseUnitId =
          links
              .where((link) => link['is_default_purchase_uom'] == true)
              .firstOrNull?['uom_id']
              ?.toString() ??
          fallbackBaseId;
      _defaultSaleUnitId =
          links
              .where((link) => link['is_default_sale_uom'] == true)
              .firstOrNull?['uom_id']
              ?.toString() ??
          fallbackBaseId;

      final models = _rows(product?['product_pricing_models'])
          .where(
            (model) =>
                model['status'] == 'approved' ||
                model['status'] == 'pending_approval',
          )
          .toList();
      final primaryModel = models.firstWhere(
        (model) => model['branch_id'] == null,
        orElse: () => models.isEmpty ? <String, dynamic>{} : models.first,
      );
      final modelPoints = _rows(primaryModel['product_price_points']);
      final uomOnlyPricingModel =
          primaryModel['pricing_method'] == 'assisted_pack' &&
          primaryModel['rounding_rule'] == 'none' &&
          modelPoints.isNotEmpty &&
          modelPoints.every(
            (point) =>
                double.tryParse(point['quantity_in_uom']?.toString() ?? '') ==
                1,
          );
      _pricingMethod = uomOnlyPricingModel
          ? 'fixed_price'
          : primaryModel['pricing_method']?.toString() ?? 'fixed_price';
      _roundingRule = uomOnlyPricingModel
          ? 'none'
          : primaryModel['rounding_rule']?.toString() ?? 'none';
      final branchModels = models
          .where((model) => model['branch_id'] != null)
          .toList();
      _pricingBranchScope = branchModels.isEmpty ? 'all' : 'branch';
      _pricingBranchIds.addAll(
        branchModels
            .map((model) => model['branch_id']?.toString())
            .whereType<String>(),
      );

      final defaultSaleId = _defaultSaleUnitId;
      for (final model in models) {
        for (final point in _rows(model['product_price_points'])) {
          final uomId = point['uom_id']?.toString();
          if (uomId == null ||
              uomId == defaultSaleId ||
              double.tryParse(point['quantity_in_uom']?.toString() ?? '') !=
                  1) {
            continue;
          }
          _salePriceController(uomId).text = point['price']?.toString() ?? '';
        }
      }
      if (!uomOnlyPricingModel) {
        for (final point in modelPoints) {
          final uomId = point['uom_id']?.toString() ?? fallbackBaseId;
          if (uomId == null) continue;
          _pricePoints.add(
            _PricePointDraft(
              uomId: uomId,
              quantity: point['quantity_in_uom']?.toString() ?? '1',
              price: point['price']?.toString() ?? '',
              maxDiscount: point['max_discount_amount']?.toString() ?? '0',
            ),
          );
        }
      }
    } else if (widget.units.isNotEmpty) {
      final baseUnits = widget.units
          .where(
            (unit) =>
                double.tryParse(unit['conversion_factor']?.toString() ?? '') ==
                1,
          )
          .toList();
      final base = baseUnits.firstWhere(
        (unit) => unit['is_base_unit'] == true,
        orElse: () => baseUnits.isEmpty ? <String, dynamic>{} : baseUnits.first,
      );
      final baseUnitId = base['id']?.toString();
      _baseUnitId = baseUnitId;
      _defaultPurchaseUnitId = baseUnitId;
      _defaultSaleUnitId = baseUnitId;
      if (baseUnitId != null) {
        _purchaseUnitIds.add(baseUnitId);
        _saleUnitIds.add(baseUnitId);
      }
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _sku.dispose();
    _category.dispose();
    _subcategory.dispose();
    _brandFamily.dispose();
    _description.dispose();
    _basePrice.dispose();
    _minPrice.dispose();
    _maxPrice.dispose();
    _unit.dispose();
    for (final controller in _salePriceControllers.values) {
      controller.dispose();
    }
    for (final point in _pricePoints) {
      point.dispose();
    }
    super.dispose();
  }

  static Map<String, dynamic>? _nested(Object? value) {
    if (value is Map<String, dynamic>) return value;
    if (value is List && value.isNotEmpty && value.first is Map) {
      return Map<String, dynamic>.from(value.first as Map);
    }
    return null;
  }

  static List<Map<String, dynamic>> _rows(Object? value) {
    if (value is! List) return const [];
    return value
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
  }

  double? _number(TextEditingController controller) =>
      double.tryParse(controller.text.trim());

  Future<void> _createUnit() async {
    final name = TextEditingController();
    final abbreviation = TextEditingController();
    final factor = TextEditingController(text: '1');
    var saving = false;
    String? error;
    try {
      final result = await showDialog<Map<String, dynamic>>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: const Text('Add unit or pack'),
            content: SizedBox(
              width: 420,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: name,
                    enabled: !saving,
                    maxLength: 120,
                    decoration: const InputDecoration(labelText: 'Unit name'),
                  ),
                  TextField(
                    controller: abbreviation,
                    enabled: !saving,
                    maxLength: 32,
                    decoration: const InputDecoration(
                      labelText: 'Abbreviation',
                    ),
                  ),
                  TextField(
                    controller: factor,
                    enabled: !saving,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'Base units per one of this unit',
                      helperText:
                          'Example: one carton contains 12 base-unit items.',
                    ),
                  ),
                  if (error != null)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: saving ? null : () => Navigator.pop(dialogContext),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: saving
                    ? null
                    : () async {
                        final conversion = double.tryParse(factor.text.trim());
                        if (conversion == null ||
                            !conversion.isFinite ||
                            conversion <= 0 ||
                            conversion >= 1000000 ||
                            (conversion * 10000).roundToDouble() !=
                                conversion * 10000) {
                          setDialogState(
                            () => error = 'Use a positive conversion factor with at most four decimal places.',
                          );
                          return;
                        }
                        setDialogState(() {
                          saving = true;
                          error = null;
                        });
                        try {
                          final id = await widget.repository
                              .createUnitOfMeasure(
                                widget.user,
                                name: name.text,
                                abbreviation: abbreviation.text,
                                conversionFactor: conversion,
                              );
                          if (!dialogContext.mounted) return;
                          Navigator.pop(dialogContext, {
                            'id': id,
                            'name': name.text.trim(),
                            'abbreviation': abbreviation.text.trim(),
                            'conversion_factor': conversion,
                            'is_base_unit': false,
                          });
                        } catch (exception) {
                          if (dialogContext.mounted) {
                            setDialogState(() {
                              saving = false;
                              error = exception.toString();
                            });
                          }
                        }
                      },
                child: saving
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Create unit'),
              ),
            ],
          ),
        ),
      );
      if (result == null || !mounted) return;
      final id = result['id']?.toString();
      if (id == null) return;
      final conversionFactor = result['conversion_factor'];
      setState(() {
        widget.units.add(result);
        _purchaseUnitIds.add(id);
        _saleUnitIds.add(id);
        _defaultPurchaseUnitId ??= id;
        _defaultSaleUnitId ??= id;
        if (_baseUnitId == null && conversionFactor == 1) {
          _baseUnitId = id;
          _unit.text =
              result['abbreviation']?.toString() ??
              result['name']?.toString() ??
              '';
        }
        _salePriceController(id);
      });
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Unit of measure created.')));
    } finally {
      name.dispose();
      abbreviation.dispose();
      factor.dispose();
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final basePrice = _number(_basePrice);
    final minPrice = _number(_minPrice);
    final maxPrice = _number(_maxPrice);
    if (basePrice == null || minPrice == null || maxPrice == null) return;
    final selectedUnit = widget.units.where(
      (unit) => unit['id']?.toString() == _baseUnitId,
    );
    final selectedSaleUnitIds = _saleUnitIds.toList();
    final salePrices = <String, double>{};
    for (final unitId in selectedSaleUnitIds) {
      if (unitId == _defaultSaleUnitId) continue;
      final price = _number(_salePriceControllers[unitId] ?? _basePrice);
      if (price == null) {
        final hasQuantityPrice =
            _isEditing &&
            _pricingMethod != 'fixed_price' &&
            _pricePoints.any(
              (point) =>
                  point.uomId == unitId &&
                  _number(point.quantity) != null &&
                  _number(point.quantity)! > 0,
            );
        if (hasQuantityPrice) continue;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Enter a price for each sale unit.')),
        );
        return;
      }
      salePrices[unitId] = price;
    }
    if (selectedUnit.isEmpty ||
        _purchaseUnitIds.isEmpty ||
        _saleUnitIds.isEmpty ||
        !_purchaseUnitIds.contains(_defaultPurchaseUnitId) ||
        !_saleUnitIds.contains(_defaultSaleUnitId)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Complete the product unit assignments.')),
      );
      return;
    }
    if (_pricingBranchScope == 'branch' && _pricingBranchIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Select at least one branch for product pricing.'),
        ),
      );
      return;
    }
    final pricePoints = <ProductPricePointInput>[];
    if (_pricingMethod != 'fixed_price') {
      for (final point in _pricePoints) {
        final quantity = _number(point.quantity);
        final price = _number(point.price);
        final maxDiscount = _number(point.maxDiscount);
        if (quantity == null ||
            quantity <= 0 ||
            price == null ||
            price < 0 ||
            maxDiscount == null ||
            maxDiscount < 0 ||
            !_saleUnitIds.contains(point.uomId)) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'Complete each quantity price point using a sale unit.',
              ),
            ),
          );
          return;
        }
        pricePoints.add(
          ProductPricePointInput(
            uomId: point.uomId,
            quantity: quantity,
            price: price,
            maxDiscountAmount: maxDiscount,
          ),
        );
      }
    }

    setState(() => _saving = true);
    try {
      final product = widget.product;
      if (product == null) {
        await widget.repository.createProduct(
          widget.user,
          name: _name.text,
          sku: _sku.text,
          category: _category.text,
          description: _description.text,
          productKind: _productKind,
          subcategory: _subcategory.text,
          brandFamily: _brandFamily.text,
          baseUnitId: _baseUnitId!,
          purchaseUnitIds: _purchaseUnitIds.toList(),
          saleUnitIds: selectedSaleUnitIds,
          defaultPurchaseUnitId: _defaultPurchaseUnitId!,
          defaultSaleUnitId: _defaultSaleUnitId!,
          salePrices: salePrices,
          pricePoints: pricePoints,
          pricingBranchIds: _pricingBranchScope == 'branch'
              ? _pricingBranchIds.toList()
              : const [],
          pricingMethod: _pricingMethod,
          roundingRule: _roundingRule,
          basePrice: basePrice,
          minPrice: minPrice,
          maxPrice: maxPrice,
        );
      } else {
        await widget.repository.updateProduct(
          widget.user,
          productId: product['id'].toString(),
          name: _name.text,
          sku: _sku.text,
          category: _category.text,
          unit: _unit.text,
          description: _description.text,
          productKind: _productKind,
          subcategory: _subcategory.text,
          brandFamily: _brandFamily.text,
          basePrice: basePrice,
          minPrice: minPrice,
          maxPrice: maxPrice,
          baseUnitId: _baseUnitId!,
          purchaseUnitIds: _purchaseUnitIds.toList(),
          saleUnitIds: selectedSaleUnitIds,
          defaultPurchaseUnitId: _defaultPurchaseUnitId!,
          defaultSaleUnitId: _defaultSaleUnitId!,
          salePrices: salePrices,
          pricePoints: pricePoints,
          pricingBranchIds: _pricingBranchScope == 'branch'
              ? _pricingBranchIds.toList()
              : const [],
          pricingMethod: _pricingMethod,
          roundingRule: _roundingRule,
        );
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not save product: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String? _required(String? value, String label) =>
      value == null || value.trim().isEmpty ? '$label is required.' : null;

  String? _positive(String? value, String label) {
    final number = double.tryParse(value?.trim() ?? '');
    return number == null || !number.isFinite || number <= 0
        ? '$label must be greater than zero.'
        : null;
  }

  String? _nonnegative(String? value, String label) {
    final number = double.tryParse(value?.trim() ?? '');
    return number == null || !number.isFinite || number < 0
        ? '$label cannot be negative.'
        : null;
  }

  TextEditingController _salePriceController(String unitId) =>
      _salePriceControllers.putIfAbsent(unitId, () => TextEditingController());

  void _addPricePoint() {
    if (_pricePoints.length >= 100) return;
    final unitId = _saleUnitIds.contains(_defaultSaleUnitId)
        ? _defaultSaleUnitId
        : _saleUnitIds.isEmpty
        ? null
        : _saleUnitIds.first;
    if (unitId == null) return;
    setState(() => _pricePoints.add(_PricePointDraft(uomId: unitId)));
  }

  void _toggleUnit(
    Set<String> selectedIds,
    String unitId,
    bool selected, {
    required bool isSaleUnit,
  }) {
    if (selected) {
      selectedIds.add(unitId);
      if (isSaleUnit && _defaultSaleUnitId == null) {
        _defaultSaleUnitId = unitId;
      } else if (!isSaleUnit && _defaultPurchaseUnitId == null) {
        _defaultPurchaseUnitId = unitId;
      }
    } else {
      if (selectedIds.length <= 1) return;
      selectedIds.remove(unitId);
      if (isSaleUnit && _defaultSaleUnitId == unitId) {
        _defaultSaleUnitId = selectedIds.first;
      } else if (!isSaleUnit && _defaultPurchaseUnitId == unitId) {
        _defaultPurchaseUnitId = selectedIds.first;
      }
      if (isSaleUnit) {
        for (final point in _pricePoints) {
          if (point.uomId == unitId) point.uomId = selectedIds.first;
        }
      }
    }
  }

  Widget _unitChoices(
    String title,
    Set<String> selectedIds,
    String unitType, {
    required bool isSaleUnit,
  }) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(title, style: Theme.of(context).textTheme.titleSmall),
      const SizedBox(height: 4),
      Wrap(
        spacing: 8,
        runSpacing: 4,
        children: widget.units.map((unit) {
          final id = unit['id']?.toString() ?? '';
          return FilterChip(
            label: Text(
              '${unit['name'] ?? 'Unit'} (${unit['abbreviation'] ?? ''})',
            ),
            selected: selectedIds.contains(id),
            onSelected: _saving
                ? null
                : (selected) => setState(
                    () => _toggleUnit(
                      selectedIds,
                      id,
                      selected,
                      isSaleUnit: isSaleUnit,
                    ),
                  ),
          );
        }).toList(),
      ),
      if (selectedIds.isEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text('Select at least one $unitType unit.'),
        ),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final unitsAvailable = widget.units.isNotEmpty;
    return AlertDialog(
      title: Text(_isEditing ? 'Edit product' : 'Add product'),
      content: SizedBox(
        width: 540,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: _name,
                  decoration: const InputDecoration(labelText: 'Product name'),
                  validator: (value) => _required(value, 'Product name'),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextFormField(
                        controller: _sku,
                        decoration: const InputDecoration(labelText: 'SKU'),
                        validator: (value) => _required(value, 'SKU'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextFormField(
                        controller: _category,
                        decoration: InputDecoration(labelText: 'Category'),
                        validator: (value) => _required(value, 'Category'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _productKind,
                  decoration: const InputDecoration(labelText: 'Product type'),
                  items: const [
                    DropdownMenuItem(
                      value: 'fixed_package',
                      child: Text('Fixed package'),
                    ),
                    DropdownMenuItem(
                      value: 'measured_counted',
                      child: Text('Measured / counted'),
                    ),
                  ],
                  onChanged: (value) {
                    if (value != null) setState(() => _productKind = value);
                  },
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: _baseUnitId,
                  decoration: const InputDecoration(
                    labelText: 'Base unit',
                    helperText: 'The base unit must have conversion factor 1.',
                  ),
                  items: widget.units
                      .where(
                        (unit) =>
                            double.tryParse(
                              unit['conversion_factor']?.toString() ?? '',
                            ) ==
                            1,
                      )
                      .map(
                        (unit) => DropdownMenuItem(
                          value: unit['id']?.toString(),
                          child: Text(
                            '${unit['name'] ?? 'Unit'}'
                            ' (${unit['abbreviation'] ?? ''})'
                            ' · 1 = ${unit['conversion_factor'] ?? 1} base',
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value == null) return;
                    final unit = widget.units.firstWhere(
                      (candidate) => candidate['id']?.toString() == value,
                    );
                    setState(() {
                      _baseUnitId = value;
                      _unit.text =
                          unit['abbreviation']?.toString() ??
                          unit['name']?.toString() ??
                          '';
                      _purchaseUnitIds.add(value);
                      _saleUnitIds.add(value);
                      _defaultPurchaseUnitId ??= value;
                      _defaultSaleUnitId ??= value;
                    });
                  },
                  validator: (value) => value == null
                      ? 'Select an active unit with conversion factor 1.'
                      : null,
                ),
                const SizedBox(height: 14),
                _unitChoices(
                  'Available purchase units',
                  _purchaseUnitIds,
                  'purchase',
                  isSaleUnit: false,
                ),
                if (_isEditing)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        'Unit assignment changes affect future stock and sales. '
                        'Existing transactions and inactive pricing models are retained.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                  ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: _saving ? null : _createUnit,
                    icon: const Icon(Icons.add),
                    label: const Text('Add unit or pack'),
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue:
                      widget.units.any(
                        (unit) =>
                            unit['id']?.toString() == _defaultPurchaseUnitId,
                      )
                      ? _defaultPurchaseUnitId
                      : null,
                  decoration: const InputDecoration(
                    labelText: 'Default purchase unit',
                  ),
                  items: widget.units
                      .where(
                        (unit) =>
                            _purchaseUnitIds.contains(unit['id']?.toString()),
                      )
                      .map(
                        (unit) => DropdownMenuItem(
                          value: unit['id']?.toString(),
                          child: Text(
                            '${unit['name'] ?? 'Unit'}'
                            ' (${unit['abbreviation'] ?? ''})',
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: (value) =>
                      setState(() => _defaultPurchaseUnitId = value),
                  validator: (value) =>
                      value == null ? 'Select a default purchase unit.' : null,
                ),
                const SizedBox(height: 14),
                _unitChoices(
                  'Available sale units',
                  _saleUnitIds,
                  'sale',
                  isSaleUnit: true,
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue:
                      widget.units.any(
                        (unit) => unit['id']?.toString() == _defaultSaleUnitId,
                      )
                      ? _defaultSaleUnitId
                      : null,
                  decoration: const InputDecoration(
                    labelText: 'Default sale unit',
                  ),
                  items: widget.units
                      .where(
                        (unit) => _saleUnitIds.contains(unit['id']?.toString()),
                      )
                      .map(
                        (unit) => DropdownMenuItem(
                          value: unit['id']?.toString(),
                          child: Text(
                            '${unit['name'] ?? 'Unit'}'
                            ' (${unit['abbreviation'] ?? ''})',
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: (value) =>
                      setState(() => _defaultSaleUnitId = value),
                  validator: (value) =>
                      value == null ? 'Select a default sale unit.' : null,
                ),
                if (!_isEditing && !unitsAvailable)
                  const Padding(
                    padding: EdgeInsets.only(top: 8),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        'Add a unit or pack above to start product setup. '
                        'Create a unit with conversion factor 1 to define a base unit.',
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _pricingMethod,
                  decoration: const InputDecoration(
                    labelText: 'Pricing method',
                    helperText: 'Fixed price for one price; assisted or manual for quantity points.',
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: 'fixed_price',
                      child: Text('Fixed price'),
                    ),
                    DropdownMenuItem(
                      value: 'assisted_pack',
                      child: Text('System assisted'),
                    ),
                    DropdownMenuItem(
                      value: 'manual_quantity',
                      child: Text('Manual quantity prices'),
                    ),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setState(() => _pricingMethod = value);
                    }
                  },
                ),
                if (_pricingMethod == 'assisted_pack')
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: DropdownButtonFormField<String>(
                      initialValue: _roundingRule,
                      decoration: const InputDecoration(
                        labelText: 'Assisted price rounding',
                      ),
                      items: const [
                        DropdownMenuItem(
                          value: 'none',
                          child: Text('No rounding'),
                        ),
                        DropdownMenuItem(
                          value: 'nearest_5',
                          child: Text('Nearest 5'),
                        ),
                        DropdownMenuItem(
                          value: 'up_5',
                          child: Text('Round up to 5'),
                        ),
                        DropdownMenuItem(
                          value: 'down_5',
                          child: Text('Round down to 5'),
                        ),
                        DropdownMenuItem(
                          value: 'nearest_10',
                          child: Text('Nearest 10'),
                        ),
                      ],
                      onChanged: (value) {
                        if (value != null) {
                          setState(() => _roundingRule = value);
                        }
                      },
                    ),
                  ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: _pricingBranchScope,
                  decoration: const InputDecoration(
                    labelText: 'Pricing applies to',
                  ),
                  items: const [
                    DropdownMenuItem(value: 'all', child: Text('All branches')),
                    DropdownMenuItem(
                      value: 'branch',
                      child: Text('Selected branches only'),
                    ),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setState(() {
                        _pricingBranchScope = value;
                        if (value == 'all') _pricingBranchIds.clear();
                      });
                    }
                  },
                ),
                if (_pricingBranchScope == 'branch')
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Container(
                      width: double.infinity,
                      constraints: const BoxConstraints(maxHeight: 160),
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        border: Border.all(
                          color: Theme.of(context).dividerColor,
                        ),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: widget.branches.isEmpty
                          ? const Text(
                              'No active branches are available for branch-specific pricing.',
                            )
                          : ListView(
                              shrinkWrap: true,
                              children: widget.branches.map((branch) {
                                final id = branch['id']?.toString() ?? '';
                                return CheckboxListTile(
                                  dense: true,
                                  contentPadding: EdgeInsets.zero,
                                  title: Text(
                                    branch['name']?.toString() ?? 'Branch',
                                  ),
                                  value: _pricingBranchIds.contains(id),
                                  onChanged: _saving
                                      ? null
                                      : (selected) {
                                          setState(() {
                                            if (selected == true) {
                                              _pricingBranchIds.add(id);
                                            } else {
                                              _pricingBranchIds.remove(id);
                                            }
                                          });
                                        },
                                );
                              }).toList(),
                            ),
                    ),
                  ),
                if (_pricingMethod != 'fixed_price') ...[
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      border: Border.all(color: Theme.of(context).dividerColor),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                _pricingMethod == 'assisted_pack'
                                    ? 'Pack prices for system assistance'
                                    : 'Manual quantity prices',
                                style: Theme.of(context).textTheme.titleSmall,
                              ),
                            ),
                            TextButton.icon(
                              onPressed: _saving || _pricePoints.length >= 100
                                  ? null
                                  : _addPricePoint,
                              icon: const Icon(Icons.add),
                              label: Text(
                                _pricingMethod == 'assisted_pack'
                                    ? 'Add pack'
                                    : 'Add price',
                              ),
                            ),
                          ],
                        ),
                        Text(
                          _pricingMethod == 'assisted_pack'
                              ? 'Intermediate quantities use the nearest lower pack rate.'
                              : 'Only the exact approved quantities can be sold.',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        for (
                          var index = 0;
                          index < _pricePoints.length;
                          index++
                        ) ...[
                          const SizedBox(height: 10),
                          DropdownButtonFormField<String>(
                            initialValue:
                                _saleUnitIds.contains(_pricePoints[index].uomId)
                                ? _pricePoints[index].uomId
                                : null,
                            decoration: const InputDecoration(
                              labelText: 'Sale unit',
                            ),
                            items: widget.units
                                .where(
                                  (unit) => _saleUnitIds.contains(
                                    unit['id']?.toString(),
                                  ),
                                )
                                .map(
                                  (unit) => DropdownMenuItem(
                                    value: unit['id']?.toString(),
                                    child: Text(
                                      '${unit['name'] ?? 'Unit'}'
                                      ' (${unit['abbreviation'] ?? ''})',
                                    ),
                                  ),
                                )
                                .toList(),
                            onChanged: (value) {
                              if (value != null) {
                                setState(
                                  () => _pricePoints[index].uomId = value,
                                );
                              }
                            },
                            validator: (value) => value == null
                                ? 'Select an available sale unit.'
                                : null,
                          ),
                          Row(
                            children: [
                              Expanded(
                                child: TextFormField(
                                  controller: _pricePoints[index].quantity,
                                  keyboardType:
                                      const TextInputType.numberWithOptions(
                                        decimal: true,
                                      ),
                                  decoration: const InputDecoration(
                                    labelText: 'Quantity',
                                  ),
                                  validator: (value) =>
                                      _positive(value, 'Quantity'),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: TextFormField(
                                  controller: _pricePoints[index].price,
                                  keyboardType:
                                      const TextInputType.numberWithOptions(
                                        decimal: true,
                                      ),
                                  decoration: const InputDecoration(
                                    labelText: 'Price',
                                  ),
                                  validator: (value) =>
                                      _nonnegative(value, 'Price'),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: TextFormField(
                                  controller: _pricePoints[index].maxDiscount,
                                  keyboardType:
                                      const TextInputType.numberWithOptions(
                                        decimal: true,
                                      ),
                                  decoration: const InputDecoration(
                                    labelText: 'Max discount',
                                  ),
                                  validator: (value) =>
                                      _nonnegative(value, 'Maximum discount'),
                                ),
                              ),
                              IconButton(
                                tooltip: 'Remove price point',
                                onPressed: _saving
                                    ? null
                                    : () {
                                        final point = _pricePoints.removeAt(
                                          index,
                                        );
                                        point.dispose();
                                        setState(() {});
                                      },
                                icon: const Icon(Icons.delete_outline),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextFormField(
                        controller: _basePrice,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: _isEditing
                              ? 'Base price'
                              : 'Default sale unit price',
                        ),
                        validator: (value) => _positive(value, 'Base price'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextFormField(
                        controller: _minPrice,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: const InputDecoration(
                          labelText: 'Minimum price',
                        ),
                        validator: (value) => _positive(value, 'Minimum price'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextFormField(
                        controller: _maxPrice,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: const InputDecoration(
                          labelText: 'Maximum price',
                        ),
                        validator: (value) => _positive(value, 'Maximum price'),
                      ),
                    ),
                  ],
                ),
                if (!_isEditing &&
                    _saleUnitIds.any(
                      (unitId) => unitId != _defaultSaleUnitId,
                    )) ...[
                  const SizedBox(height: 14),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Price for each additional sale unit',
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                  ),
                  const SizedBox(height: 6),
                  for (final unit in widget.units.where(
                    (unit) =>
                        _saleUnitIds.contains(unit['id']?.toString()) &&
                        unit['id']?.toString() != _defaultSaleUnitId,
                  )) ...[
                    const SizedBox(height: 6),
                    TextFormField(
                      controller: _salePriceController(unit['id'].toString()),
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: InputDecoration(
                        labelText:
                            'Price per ${unit['name'] ?? 'unit'} (${unit['abbreviation'] ?? ''})',
                      ),
                      validator: (value) =>
                          _positive(value, '${unit['name'] ?? 'Unit'} price'),
                    ),
                  ],
                ],
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: TextFormField(
                        controller: _subcategory,
                        decoration: const InputDecoration(
                          labelText: 'Subcategory (optional)',
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextFormField(
                        controller: _brandFamily,
                        decoration: const InputDecoration(
                          labelText: 'Brand (optional)',
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: _description,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Description (optional)',
                  ),
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
          onPressed: _saving || (!_isEditing && !unitsAvailable) ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(_isEditing ? 'Save changes' : 'Create product'),
        ),
      ],
    );
  }
}
