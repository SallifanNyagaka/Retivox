import 'dart:async';
import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/sales/sale_repository.dart';

class PosScreen extends StatefulWidget {
  const PosScreen({
    required this.user,
    required this.repository,
    required this.onSignOut,
    this.embedded = false,
    super.key,
  });

  final RetivoxUser user;
  final SaleRepository repository;
  final VoidCallback onSignOut;
  final bool embedded;

  @override
  State<PosScreen> createState() => _PosScreenState();
}

class _PosScreenState extends State<PosScreen> with WidgetsBindingObserver {
  final _searchController = TextEditingController();
  final _connectivity = Connectivity();
  final _money = NumberFormat('#,##0.00', 'en_KE');
  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  Timer? _syncTimer;
  String? _branchId;
  String _search = '';
  String? _catalogError;
  String? _actionError;
  bool _isLoadingCatalog = false;
  bool _isSyncing = false;
  bool _isConnected = false;
  DateTime? _catalogUpdatedAt;
  List<SaleProduct> _products = [];
  final List<_CartLine> _cart = [];
  List<LocalSale> _sales = [];

  double get _cartTotal => _cart.fold(0, (total, line) => total + line.total);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (widget.user.branches.isNotEmpty) {
      _branchId = widget.user.branches.first.id;
      unawaited(_loadBranchData());
    }
    _connectivitySubscription = _connectivity.onConnectivityChanged.listen(
      (results) {
        final connected = results.any(
          (result) => result != ConnectivityResult.none,
        );
        if (mounted) {
          setState(() => _isConnected = connected);
        }
        if (connected) unawaited(_syncPending());
      },
      onError: (Object error, StackTrace stackTrace) {
        if (mounted) {
          setState(
            () => _actionError = 'Connection status is unavailable: $error',
          );
        }
      },
    );
    unawaited(_checkConnectivity());
    _syncTimer = Timer.periodic(const Duration(seconds: 45), (_) {
      unawaited(_syncPending());
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _searchController.dispose();
    _connectivitySubscription?.cancel();
    _syncTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_loadBranchData());
      unawaited(_syncPending());
    }
  }

  Future<void> _checkConnectivity() async {
    try {
      final results = await _connectivity.checkConnectivity();
      if (mounted) {
        setState(
          () => _isConnected = results.any(
            (result) => result != ConnectivityResult.none,
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        setState(
          () => _actionError = 'Connection status is unavailable: $error',
        );
      }
    }
  }

  Future<void> _loadBranchData() async {
    final branchId = _branchId;
    if (branchId == null) return;
    setState(() {
      _isLoadingCatalog = true;
      _catalogError = null;
    });
    try {
      final products = await widget.repository.loadProducts(
        widget.user,
        branchId,
      );
      final updatedAt = await widget.repository.productCatalogUpdatedAt(
        widget.user,
        branchId,
      );
      if (mounted && branchId == _branchId) {
        setState(() {
          _products = products;
          _catalogUpdatedAt = updatedAt;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _catalogError = error.toString());
    } finally {
      if (mounted) setState(() => _isLoadingCatalog = false);
      await _loadSales();
    }
  }

  Future<void> _loadSales() async {
    try {
      final sales = await widget.repository.listSales(widget.user.id);
      if (mounted) setState(() => _sales = sales);
    } catch (error) {
      if (mounted) {
        setState(() => _actionError = 'Could not load saved sales: $error');
      }
    }
  }

  Future<void> _syncPending() async {
    if (_isSyncing) return;
    setState(() => _isSyncing = true);
    try {
      await widget.repository.syncPending(widget.user);
      await _loadSales();
    } catch (error) {
      if (mounted) {
        setState(
          () => _actionError =
              'Sales remain saved on this computer. Sync error: $error',
        );
      }
    } finally {
      if (mounted) setState(() => _isSyncing = false);
    }
  }

  Future<void> _changeBranch(String? branchId) async {
    if (branchId == null || branchId == _branchId) return;
    setState(() {
      _branchId = branchId;
      _products = [];
      _catalogUpdatedAt = null;
      _cart.clear();
      _actionError = null;
    });
    await _loadBranchData();
  }

  Future<void> _addProduct(SaleProduct product) async {
    if (product.availableBaseQuantity <= 0) {
      _showMessage('No stock is currently available for ${product.name}.');
      return;
    }
    if (product.uomOptions.isEmpty) {
      _showMessage('${product.name} has no sale unit configured.');
      return;
    }

    final quantityController = TextEditingController(text: '1');
    Map<String, dynamic> selectedUom =
        product.defaultSaleUom ?? product.uomOptions.first;
    String? error;
    final selection = await showDialog<_ProductSelection>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(product.name),
          content: SizedBox(
            width: 360,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Available: ${_quantityText(product.availableBaseQuantity)} ${product.uomOptions.first['name'] ?? ''}',
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  initialValue: selectedUom['id'] as String?,
                  decoration: const InputDecoration(labelText: 'Sale unit'),
                  items: product.uomOptions
                      .map(
                        (uom) => DropdownMenuItem(
                          value: uom['id'] as String?,
                          child: Text(
                            '${uom['name'] ?? 'Unit'} (${uom['abbreviation'] ?? ''})',
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: (id) {
                    if (id == null) return;
                    setDialogState(() {
                      selectedUom = product.uomOptions.firstWhere(
                        (uom) => uom['id'] == id,
                      );
                      error = null;
                    });
                  },
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: quantityController,
                  autofocus: true,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: InputDecoration(
                    labelText: 'Quantity',
                    errorText: error,
                  ),
                  onChanged: (_) => setDialogState(() => error = null),
                ),
                const SizedBox(height: 12),
                ValueListenableBuilder<TextEditingValue>(
                  valueListenable: quantityController,
                  builder: (context, value, _) {
                    final quantity = double.tryParse(value.text) ?? 0;
                    final price = product.previewPrice(quantity, selectedUom);
                    return Text(
                      price == null
                          ? 'No price is configured for this quantity.'
                          : 'Line total: ${_formatMoney(price)}',
                      style: Theme.of(context).textTheme.titleSmall,
                    );
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final quantity = double.tryParse(quantityController.text);
                final conversion = _number(
                  selectedUom['conversionFactor'],
                  fallback: 1,
                );
                if (quantity == null || !quantity.isFinite || quantity <= 0) {
                  setDialogState(
                    () => error = 'Enter a quantity greater than zero.',
                  );
                  return;
                }
                final baseQuantity = quantity * conversion;
                if ((baseQuantity - baseQuantity.roundToDouble()).abs() >
                    0.0001) {
                  setDialogState(
                    () => error =
                        'This unit quantity must convert to whole base units.',
                  );
                  return;
                }
                if (baseQuantity > product.availableBaseQuantity) {
                  setDialogState(
                    () =>
                        error = 'Quantity exceeds the cached available stock.',
                  );
                  return;
                }
                final price = product.previewPrice(quantity, selectedUom);
                if (price == null) {
                  setDialogState(
                    () => error = 'No price is configured for this quantity.',
                  );
                  return;
                }
                Navigator.pop(
                  context,
                  _ProductSelection(
                    uom: selectedUom,
                    quantity: quantity,
                    total: price,
                  ),
                );
              },
              child: const Text('Add to sale'),
            ),
          ],
        ),
      ),
    );
    quantityController.dispose();
    if (selection == null || !mounted) return;

    final uomId = selection.uom['id'] as String?;
    final key = '${product.optionId}:$uomId';
    final existingIndex = _cart.indexWhere((line) => line.key == key);
    if (existingIndex < 0) {
      setState(
        () => _cart.add(
          _CartLine(
            key: key,
            product: product,
            uom: selection.uom,
            quantity: selection.quantity,
            total: selection.total,
          ),
        ),
      );
      return;
    }
    final existing = _cart[existingIndex];
    final newQuantity = existing.quantity + selection.quantity;
    final available = product.availableBaseQuantity;
    final baseQuantity =
        newQuantity * _number(selection.uom['conversionFactor'], fallback: 1);
    final price = product.previewPrice(newQuantity, selection.uom);
    if (baseQuantity > available || price == null) {
      _showMessage(
        'The combined quantity is unavailable or has no configured price.',
      );
      return;
    }
    setState(() {
      existing.quantity = newQuantity;
      existing.total = price;
    });
  }

  Future<void> _changeCartQuantity(_CartLine line, double nextQuantity) async {
    if (nextQuantity <= 0) {
      setState(() => _cart.remove(line));
      return;
    }
    final baseQuantity =
        nextQuantity * _number(line.uom['conversionFactor'], fallback: 1);
    if ((baseQuantity - baseQuantity.roundToDouble()).abs() > 0.0001) {
      _showMessage('This unit quantity must convert to whole base units.');
      return;
    }
    if (baseQuantity > line.product.availableBaseQuantity) {
      _showMessage('Quantity exceeds the cached available stock.');
      return;
    }
    final price = line.product.previewPrice(nextQuantity, line.uom);
    if (price == null) {
      _showMessage('No price is configured for this quantity.');
      return;
    }
    setState(() {
      line.quantity = nextQuantity;
      line.total = price;
    });
  }

  Future<void> _checkout() async {
    final branchId = _branchId;
    if (branchId == null || _cart.isEmpty) return;
    final details = await showDialog<_PaymentDetails>(
      context: context,
      builder: (context) => const _PaymentDialog(),
    );
    if (details == null || !mounted) return;
    setState(() => _actionError = null);
    try {
      await widget.repository.recordSale(
        user: widget.user,
        branchId: branchId,
        items: _cart.map((line) => line.toJson()).toList(),
        paymentMethod: details.method,
        mpesaReference: details.mpesaReference,
        previewTotal: _cartTotal,
      );
      if (!mounted) return;
      setState(() => _cart.clear());
      await _loadSales();
      _showMessage(
        'Sale saved on this computer. It will sync automatically when online.',
      );
    } catch (error) {
      if (mounted) setState(() => _actionError = 'Sale was not saved: $error');
    }
  }

  Future<void> _correctSale(LocalSale sale) async {
    final correctedItems = await showDialog<List<Map<String, dynamic>>>(
      context: context,
      builder: (context) =>
          _CorrectionDialog(sale: sale, onPrice: _priceCorrectedLine),
    );
    if (correctedItems == null || !mounted) return;
    try {
      await widget.repository.correctSale(
        sale.localId,
        widget.user.id,
        correctedItems,
      );
      await _syncPending();
      _showMessage('Corrected sale saved and queued for sync.');
    } catch (error) {
      setState(() => _actionError = 'Could not update this sale: $error');
    }
  }

  double? _priceCorrectedLine(Map<String, dynamic> item, double quantity) {
    final snapshot = item['productSnapshot'];
    final uom = item['uomSnapshot'];
    if (snapshot is! Map<String, dynamic> || uom is! Map<String, dynamic>) {
      return null;
    }
    final product = SaleProduct.fromCachedJson(snapshot);
    return product.previewPrice(quantity, uom);
  }

  Future<void> _cancelSale(LocalSale sale) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel this unsynced sale?'),
        content: const Text(
          'The sale will remain in local history as cancelled and will not be sent to the server.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep sale'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Cancel sale'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await widget.repository.cancelSale(sale.localId);
    await _loadSales();
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  String _formatMoney(double amount) =>
      '${widget.user.currency} ${_money.format(amount)}';

  String _quantityText(double value) => value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toStringAsFixed(2);

  double _number(Object? value, {double fallback = 0}) {
    final parsed = double.tryParse(value?.toString() ?? '');
    return parsed != null && parsed.isFinite ? parsed : fallback;
  }

  @override
  Widget build(BuildContext context) {
    final branches = widget.user.branches;
    final visibleProducts = _products.where((product) {
      final query = _search.trim().toLowerCase();
      return query.isEmpty ||
          product.name.toLowerCase().contains(query) ||
          product.sku.toLowerCase().contains(query);
    }).toList();

    return Scaffold(
      appBar: widget.embedded
          ? null
          : AppBar(
              title: const Text('Point of sale'),
              actions: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Center(
                    child: Chip(
                      avatar: Icon(
                        _isConnected
                            ? Icons.cloud_done_outlined
                            : Icons.cloud_off_outlined,
                        size: 18,
                      ),
                      label: Text(
                        _isSyncing
                            ? 'Syncing'
                            : _isConnected
                            ? 'Online'
                            : 'Offline',
                      ),
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh catalog and sync',
                  onPressed: _isLoadingCatalog
                      ? null
                      : () {
                          unawaited(_loadBranchData());
                          unawaited(_syncPending());
                        },
                  icon: const Icon(Icons.refresh),
                ),
                IconButton(
                  tooltip: 'Sign out',
                  onPressed: widget.onSignOut,
                  icon: const Icon(Icons.logout),
                ),
              ],
            ),
      body: branches.isEmpty
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'No active branch access is saved. Sign in online to refresh your account.',
                ),
              ),
            )
          : LayoutBuilder(
              builder: (context, constraints) => Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 1180),
                  child: ListView(
                    padding: const EdgeInsets.all(20),
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Hello, ${widget.user.name}',
                              style: Theme.of(context).textTheme.headlineSmall,
                            ),
                          ),
                          if (branches.length > 1)
                            SizedBox(
                              width: 280,
                              child: DropdownButtonFormField<String>(
                                initialValue: _branchId,
                                decoration: const InputDecoration(
                                  labelText: 'Branch',
                                ),
                                items: branches
                                    .map(
                                      (branch) => DropdownMenuItem(
                                        value: branch.id,
                                        child: Text(
                                          branch.name,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                    )
                                    .toList(),
                                onChanged: _changeBranch,
                              ),
                            )
                          else
                            Chip(
                              avatar: const Icon(
                                Icons.store_outlined,
                                size: 18,
                              ),
                              label: Text(branches.first.name),
                            ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Sales are stored locally first and synced when a connection is available.',
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      if (_actionError != null) ...[
                        const SizedBox(height: 12),
                        _ErrorBanner(message: _actionError!),
                      ],
                      const SizedBox(height: 24),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Products',
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                          ),
                          SizedBox(
                            width: constraints.maxWidth > 640 ? 320 : 190,
                            child: TextField(
                              controller: _searchController,
                              onChanged: (value) =>
                                  setState(() => _search = value),
                              decoration: const InputDecoration(
                                prefixIcon: Icon(Icons.search),
                                labelText: 'Search products',
                                isDense: true,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      if (_catalogUpdatedAt != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Text(
                            'Catalog last refreshed ${DateFormat.yMMMd().add_jm().format(_catalogUpdatedAt!)}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                      if (_isLoadingCatalog && _products.isEmpty)
                        const Center(
                          child: Padding(
                            padding: EdgeInsets.all(32),
                            child: CircularProgressIndicator(),
                          ),
                        )
                      else if (_catalogError != null && _products.isEmpty)
                        _ErrorBanner(message: _catalogError!)
                      else if (visibleProducts.isEmpty)
                        Card(
                          child: ListTile(
                            leading: const Icon(Icons.inventory_2_outlined),
                            title: Text(
                              _products.isEmpty
                                  ? 'No products are available for this branch.'
                                  : 'No products match your search.',
                            ),
                            subtitle: _products.isEmpty
                                ? const Text(
                                    'Connect to the internet and refresh to load the branch catalog.',
                                  )
                                : null,
                          ),
                        )
                      else
                        LayoutBuilder(
                          builder: (context, gridConstraints) {
                            final columns = (gridConstraints.maxWidth / 260)
                                .floor()
                                .clamp(1, 4)
                                .toInt();
                            return GridView.builder(
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              itemCount: visibleProducts.length,
                              gridDelegate:
                                  SliverGridDelegateWithFixedCrossAxisCount(
                                    crossAxisCount: columns,
                                    childAspectRatio: 1.65,
                                    crossAxisSpacing: 10,
                                    mainAxisSpacing: 10,
                                  ),
                              itemBuilder: (context, index) {
                                final product = visibleProducts[index];
                                final available = product.availableBaseQuantity;
                                return Card(
                                  clipBehavior: Clip.antiAlias,
                                  child: InkWell(
                                    onTap: available > 0
                                        ? () => _addProduct(product)
                                        : null,
                                    child: Padding(
                                      padding: const EdgeInsets.all(14),
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Expanded(
                                            child: Text(
                                              product.name,
                                              maxLines: 2,
                                              overflow: TextOverflow.ellipsis,
                                              style: Theme.of(context)
                                                  .textTheme
                                                  .titleMedium,
                                            ),
                                          ),
                                          if (product.sku.isNotEmpty)
                                            Text(
                                              product.sku,
                                              style: Theme.of(context)
                                                  .textTheme
                                                  .bodySmall,
                                            ),
                                          const SizedBox(height: 4),
                                          Row(
                                            children: [
                                              Expanded(
                                                child: Text(
                                                  'Stock: ${_quantityText(available)}',
                                                  style: Theme.of(context)
                                                      .textTheme
                                                      .bodySmall,
                                                ),
                                              ),
                                              Text(
                                                _formatMoney(
                                                  product.sellingPrice,
                                                ),
                                                style: Theme.of(context)
                                                    .textTheme
                                                    .titleSmall,
                                              ),
                                            ],
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                );
                              },
                            );
                          },
                        ),
                      const SizedBox(height: 24),
                      _buildCart(context),
                      const SizedBox(height: 24),
                      _buildSalesHistory(context),
                    ],
                  ),
                ),
              ),
            ),
    );
  }

  Widget _buildCart(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Current sale',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                Text('${_cart.length} item${_cart.length == 1 ? '' : 's'}'),
              ],
            ),
            const Divider(height: 24),
            if (_cart.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 14),
                child: Text('Select a product to start a sale.'),
              )
            else
              ..._cart.map(
                (line) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(line.product.name),
                  subtitle: Text(
                    '${_quantityText(line.quantity)} × ${line.uom['name'] ?? 'unit'} · ${_formatMoney(line.total)}',
                  ),
                  trailing: Wrap(
                    spacing: 2,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      IconButton(
                        tooltip: 'Decrease quantity',
                        onPressed: () =>
                            _changeCartQuantity(line, line.quantity - 1),
                        icon: const Icon(Icons.remove_circle_outline),
                      ),
                      IconButton(
                        tooltip: 'Increase quantity',
                        onPressed: () =>
                            _changeCartQuantity(line, line.quantity + 1),
                        icon: const Icon(Icons.add_circle_outline),
                      ),
                      IconButton(
                        tooltip: 'Remove product',
                        onPressed: () => setState(() => _cart.remove(line)),
                        icon: const Icon(Icons.delete_outline),
                      ),
                    ],
                  ),
                ),
              ),
            const Divider(height: 24),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Total',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Text(
                  _formatMoney(_cartTotal),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ],
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: _cart.isEmpty ? null : _checkout,
              icon: const Icon(Icons.point_of_sale),
              label: const Text('Complete sale'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSalesHistory(BuildContext context) {
    final currentBranchSales = _sales
        .where((sale) => sale.branchId == _branchId)
        .take(20)
        .toList();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Recent sales',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                TextButton.icon(
                  onPressed: _syncPending,
                  icon: const Icon(Icons.sync),
                  label: const Text('Sync now'),
                ),
              ],
            ),
            const Divider(height: 20),
            if (currentBranchSales.isEmpty)
              const Text('No locally recorded sales for this branch yet.')
            else
              ...currentBranchSales.map((sale) {
                final correctionNeeded = sale.status == 'needs_correction';
                return Column(
                  children: [
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(_statusIcon(sale.status)),
                      title: Text(_formatMoney(sale.totalAmount)),
                      subtitle: Text(
                        '${DateFormat.yMMMd().add_jm().format(DateTime.parse(sale.recordedAt).toLocal())} · ${_statusLabel(sale.status)}'
                        '${sale.errorMessage == null ? '' : '\n${sale.errorMessage}'}',
                      ),
                      isThreeLine: sale.errorMessage != null,
                      trailing: correctionNeeded
                          ? Wrap(
                              children: [
                                TextButton(
                                  onPressed: () => _correctSale(sale),
                                  child: const Text('Correct'),
                                ),
                                TextButton(
                                  onPressed: () => _cancelSale(sale),
                                  child: const Text('Cancel'),
                                ),
                              ],
                            )
                          : null,
                    ),
                    const Divider(height: 1),
                  ],
                );
              }),
          ],
        ),
      ),
    );
  }

  IconData _statusIcon(String status) => switch (status) {
    'synced' => Icons.cloud_done_outlined,
    'syncing' => Icons.sync,
    'needs_correction' => Icons.warning_amber_outlined,
    'cancelled' => Icons.cancel_outlined,
    _ => Icons.cloud_upload_outlined,
  };

  String _statusLabel(String status) => switch (status) {
    'synced' => 'Synced',
    'syncing' => 'Syncing',
    'needs_correction' => 'Needs correction',
    'cancelled' => 'Cancelled',
    _ => 'Waiting to sync',
  };
}

class _CartLine {
  _CartLine({
    required this.key,
    required this.product,
    required this.uom,
    required this.quantity,
    required this.total,
  });

  final String key;
  final SaleProduct product;
  final Map<String, dynamic> uom;
  double quantity;
  double total;

  Map<String, dynamic> toJson() => {
    'productId': product.productId,
    'uomId': uom['id'],
    'quantity': quantity,
    'recoveryItemId': product.recoveryItemId,
    'name': product.name,
    'unitName': uom['name'],
    'previewLineTotal': total,
    'productSnapshot': product.toJson(),
    'uomSnapshot': uom,
  };
}

class _ProductSelection {
  const _ProductSelection({
    required this.uom,
    required this.quantity,
    required this.total,
  });

  final Map<String, dynamic> uom;
  final double quantity;
  final double total;
}

class _PaymentDetails {
  const _PaymentDetails({required this.method, required this.mpesaReference});

  final String method;
  final String mpesaReference;
}

class _PaymentDialog extends StatefulWidget {
  const _PaymentDialog();

  @override
  State<_PaymentDialog> createState() => _PaymentDialogState();
}

class _PaymentDialogState extends State<_PaymentDialog> {
  final _referenceController = TextEditingController();
  String _method = 'cash';
  String? _error;

  @override
  void dispose() {
    _referenceController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Payment details'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DropdownButtonFormField<String>(
            initialValue: _method,
            decoration: const InputDecoration(labelText: 'Payment method'),
            items: const [
              DropdownMenuItem(value: 'cash', child: Text('Cash')),
              DropdownMenuItem(value: 'mpesa_manual', child: Text('M-Pesa')),
            ],
            onChanged: (value) {
              if (value != null) setState(() => _method = value);
            },
          ),
          if (_method == 'mpesa_manual') ...[
            const SizedBox(height: 12),
            TextField(
              controller: _referenceController,
              textCapitalization: TextCapitalization.characters,
              decoration: InputDecoration(
                labelText: 'M-Pesa reference',
                errorText: _error,
              ),
            ),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Back'),
        ),
        FilledButton(
          onPressed: () {
            final reference = _referenceController.text.trim();
            if (_method == 'mpesa_manual' && reference.length < 5) {
              setState(() => _error = 'Enter a valid M-Pesa reference.');
              return;
            }
            Navigator.pop(
              context,
              _PaymentDetails(method: _method, mpesaReference: reference),
            );
          },
          child: const Text('Save sale'),
        ),
      ],
    );
  }
}

class _CorrectionDialog extends StatefulWidget {
  const _CorrectionDialog({required this.sale, required this.onPrice});

  final LocalSale sale;
  final double? Function(Map<String, dynamic> item, double quantity) onPrice;

  @override
  State<_CorrectionDialog> createState() => _CorrectionDialogState();
}

class _CorrectionDialogState extends State<_CorrectionDialog> {
  late final List<Map<String, dynamic>> _items = widget.sale.items
      .map((item) => Map<String, dynamic>.from(item))
      .toList();
  String? _error;

  void _setQuantity(int index, double quantity) {
    if (quantity <= 0) {
      setState(() => _items.removeAt(index));
      return;
    }
    final price = widget.onPrice(_items[index], quantity);
    if (price == null) {
      setState(
        () => _error = 'No price is configured for the adjusted quantity.',
      );
      return;
    }
    setState(() {
      _items[index]['quantity'] = quantity;
      _items[index]['previewLineTotal'] = price;
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Correct saved sale'),
      content: SizedBox(
        width: 480,
        child: _items.isEmpty
            ? const Text('Remove all lines to cancel this sale instead.')
            : ListView(
                shrinkWrap: true,
                children: [
                  const Text(
                    'Adjust quantities or remove lines, then retry sync. Server stock and pricing are checked again.',
                  ),
                  const SizedBox(height: 12),
                  ..._items.asMap().entries.map((entry) {
                    final index = entry.key;
                    final item = entry.value;
                    final quantity =
                        double.tryParse(item['quantity'].toString()) ?? 1;
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(item['name'] as String? ?? 'Product'),
                      subtitle: Text(
                        '${quantity == quantity.roundToDouble() ? quantity.toInt() : quantity} ${item['unitName'] ?? ''}',
                      ),
                      trailing: Wrap(
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          IconButton(
                            tooltip: 'Decrease quantity',
                            onPressed: () => _setQuantity(index, quantity - 1),
                            icon: const Icon(Icons.remove_circle_outline),
                          ),
                          IconButton(
                            tooltip: 'Increase quantity',
                            onPressed: () => _setQuantity(index, quantity + 1),
                            icon: const Icon(Icons.add_circle_outline),
                          ),
                          IconButton(
                            tooltip: 'Remove line',
                            onPressed: () => _setQuantity(index, 0),
                            icon: const Icon(Icons.delete_outline),
                          ),
                        ],
                      ),
                    );
                  }),
                  if (_error != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                ],
              ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Back'),
        ),
        FilledButton(
          onPressed: _items.isEmpty
              ? null
              : () => Navigator.pop(
                  context,
                  _items
                      .map(
                        (item) =>
                            jsonDecode(jsonEncode(item))
                                as Map<String, dynamic>,
                      )
                      .toList(),
                ),
          child: const Text('Retry sync'),
        ),
      ],
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Theme.of(context).colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Text(
          message,
          style: TextStyle(
            color: Theme.of(context).colorScheme.onErrorContainer,
          ),
        ),
      ),
    );
  }
}
