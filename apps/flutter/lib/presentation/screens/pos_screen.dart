import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/sales/sale_repository.dart';
import '../../features/dashboard/barcode_similarity.dart';
import '../theme/retivox_theme.dart';
import '../widgets/retivox_badge.dart';
import '../widgets/retivox_button.dart';
import '../widgets/retivox_card.dart';
import 'mobile_barcode_scanner_screen.dart';

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
  final _productSearchFocus = FocusNode();
  final _mpesaReferenceController = TextEditingController();
  final _cashTenderedController = TextEditingController();
  final _creditPaidController = TextEditingController();
  final _customerNameController = TextEditingController();
  final _customerPhoneController = TextEditingController();
  final _customerEmailController = TextEditingController();
  final _creditDueDateController = TextEditingController();
  final _connectivity = Connectivity();
  final _money = NumberFormat('#,##0.00', 'en_KE');

  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  Timer? _syncTimer;

  String? _branchId;
  String _search = '';
  String _activeTab = 'normal'; // 'normal' | 'damaged'
  String _paymentMethod = 'cash'; // 'cash' | 'mpesa_manual'
  bool _isCredit = false;
  bool _scannerEnabled = false;
  String? _catalogError;
  String? _actionError;
  bool _isLoadingCatalog = false;
  bool _isSyncing = false;
  bool _isSavingSale = false;
  bool _handlingBarcode = false;
  bool _isConnected = false;
  DateTime? _catalogUpdatedAt;

  List<SaleProduct> _products = [];
  final List<_CartLine> _cart = [];
  List<LocalSale> _sales = [];

  double get _cartTotal => _cart.fold(0, (total, line) => total + line.total);

  bool get _supportsCameraScanner =>
      !kIsWeb && (Platform.isAndroid || Platform.isIOS);

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
        final networkAvailable = results.any(
          (result) => result != ConnectivityResult.none,
        );
        if (networkAvailable) {
          unawaited(
            _checkConnectivity().then((connected) {
              if (connected) unawaited(_syncPending());
            }),
          );
        } else if (mounted) {
          setState(() => _isConnected = false);
        }
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
    _productSearchFocus.dispose();
    _mpesaReferenceController.dispose();
    _cashTenderedController.dispose();
    _creditPaidController.dispose();
    _customerNameController.dispose();
    _customerPhoneController.dispose();
    _customerEmailController.dispose();
    _creditDueDateController.dispose();
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

  Future<bool> _checkConnectivity() async {
    try {
      final connected = await widget.repository.isBackendReachable();
      if (mounted) {
        setState(() {
          _isConnected = connected;
          if (!connected &&
              !{'cash', 'mpesa_manual'}.contains(_paymentMethod)) {
            _paymentMethod = 'cash';
          }
        });
      }
      return connected;
    } catch (error) {
      if (mounted) {
        setState(
          () => _actionError = 'Connection status is unavailable: $error',
        );
      }
      return false;
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
    if (!await _checkConnectivity()) return;
    if (!mounted) return;
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

  Future<bool> _addProduct(
    SaleProduct product, {
    bool protectExternalScannerInput = false,
  }) async {
    if (product.availableBaseQuantity <= 0) {
      _showMessage('No stock is currently available for ${product.name}.');
      return false;
    }
    if (product.uomOptions.isEmpty) {
      _showMessage('${product.name} has no sale unit configured.');
      return false;
    }

    final selection = await showDialog<_ProductSelection>(
      context: context,
      builder: (_) => _AddSaleProductDialog(
        product: product,
        formatMoney: _formatMoney,
        protectExternalScannerInput: protectExternalScannerInput,
      ),
    );
    if (selection == null || !mounted) return false;

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
      return true;
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
      return false;
    }

    setState(() {
      existing.quantity = newQuantity;
      existing.total = price;
    });
    return true;
  }

  Future<void> _submitBarcode(String value) async {
    if (_handlingBarcode) return;
    _handlingBarcode = true;
    if (mounted) {
      setState(() => _scannerEnabled = false);
      _productSearchFocus.unfocus();
    }
    final added = await _handleBarcode(value, fromExternalScanner: true);
    if (!mounted) return;
    _handlingBarcode = false;
    if (!added) {
      _activateScanner();
      return;
    }
    if (await _askScanAnother() && mounted) _activateScanner();
  }

  Future<bool> _handleBarcode(
    String value, {
    bool focusSearch = true,
    bool fromExternalScanner = false,
  }) async {
    final code = value.trim().toUpperCase();
    if (code.isEmpty) return false;
    final product = findSaleProductByBarcode(_products, code);
    _searchController.clear();
    if (mounted) setState(() => _search = '');
    if (product == null) {
      final similar = _products
          .expand((item) => item.barcodes.map((barcode) => (item, barcode)))
          .where(
            (entry) =>
                normalizeBarcode(entry.$2) != normalizeBarcode(code) &&
                barcodeConfusableKey(entry.$2) == barcodeConfusableKey(code),
          )
          .firstOrNull;
      _showMessage(
        similar == null
            ? 'No product is linked to barcode $code.'
            : 'Scanned barcode $code is too similar to ${similar.$2} on ${similar.$1.name}. It was not added; scan the label again.',
      );
      if (focusSearch && mounted) _productSearchFocus.requestFocus();
      return false;
    }
    return _addProduct(
      product,
      protectExternalScannerInput: fromExternalScanner,
    );
  }

  Future<void> _openCameraScanner() async {
    while (mounted) {
      final code = await showDialog<String>(
        context: context,
        builder: (context) => Dialog.fullscreen(
          child: MobileBarcodeScannerScreen(
            onBarcode: (value) {
              final code = normalizeBarcode(value);
              return findSaleProductByBarcode(_products, value) != null ||
                  _products.any(
                    (product) => product.barcodes.any(
                      (barcode) =>
                          normalizeBarcode(barcode) != code &&
                          barcodeConfusableKey(barcode) ==
                              barcodeConfusableKey(code),
                    ),
                  );
            },
          ),
        ),
      );
      if (code == null || !mounted) return;
      final added = await _handleBarcode(code, focusSearch: false);
      if (!added || !mounted) return;
      if (!await _askScanAnother() || !mounted) return;
    }
  }

  Future<bool> _askScanAnother() async {
    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('Product added successfully'),
            content: const Text('Scan another product?'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('Done'),
              ),
              FilledButton.icon(
                onPressed: () => Navigator.pop(dialogContext, true),
                icon: const Icon(Icons.qr_code_scanner),
                label: const Text('Scan another'),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _showScannerSetup() async {
    final useScanner = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Set up a barcode scanner'),
        content: const SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Retivox supports USB and Bluetooth scanners that type like a keyboard.',
              ),
              SizedBox(height: 12),
              Text('1. Connect or pair the scanner with this computer.'),
              SizedBox(height: 6),
              Text('2. Configure it to send Enter after each barcode.'),
              SizedBox(height: 6),
              Text(
                '3. Choose Use scanner, then scan a barcode saved on a product.',
              ),
              SizedBox(height: 12),
              Text(
                'Each scan pauses the scanner and asks you to confirm the sale unit and quantity before adding the item. The sale is recorded only when you select Complete sale.',
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Close'),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.pop(dialogContext, true),
            icon: const Icon(Icons.qr_code_scanner),
            label: const Text('Use scanner'),
          ),
        ],
      ),
    );
    if (useScanner == true && mounted) _activateScanner();
  }

  void _activateScanner() {
    setState(() {
      _scannerEnabled = true;
      _search = '';
      _searchController.clear();
    });
    _productSearchFocus.requestFocus();
  }

  void _changeCartQuantity(_CartLine line, double nextQuantity) {
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
      _showMessage('Quantity exceeds the available stock.');
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

    final onlineOnlyMethod = !{'cash', 'mpesa_manual'}.contains(_paymentMethod);
    if (onlineOnlyMethod && !await _checkConnectivity()) {
      _showMessage(
        'This payment method needs a live internet connection. Use cash or mobile manual while offline.',
      );
      return;
    }

    final mpesaRef = _mpesaReferenceController.text.trim();
    final amountPaid = _isCredit
        ? (double.tryParse(_creditPaidController.text.trim()) ?? 0)
        : _cartTotal;
    final amountTendered = _paymentMethod == 'cash'
        ? (double.tryParse(_cashTenderedController.text.trim()) ?? amountPaid)
        : amountPaid;
    if (_paymentMethod == 'mpesa_manual' &&
        (!_isCredit || amountPaid > 0) &&
        mpesaRef.length < 5) {
      _showMessage('Enter a valid M-Pesa reference code (e.g. SBF92JK12).');
      return;
    }
    if (_isCredit &&
        (_customerNameController.text.trim().isEmpty ||
            _customerPhoneController.text.trim().isEmpty ||
            _creditDueDateController.text.trim().isEmpty)) {
      _showMessage(
        'Credit sales need customer name, phone, and expected payment date.',
      );
      return;
    }
    if (_isCredit && (amountPaid < 0 || amountPaid > _cartTotal)) {
      _showMessage('Amount paid must be between zero and the sale total.');
      return;
    }
    if (_paymentMethod == 'cash' && amountTendered < amountPaid) {
      _showMessage('Cash received must cover the amount being paid.');
      return;
    }

    setState(() {
      _actionError = null;
      _isSavingSale = true;
    });

    try {
      await widget.repository.recordSale(
        user: widget.user,
        branchId: branchId,
        items: _cart.map((line) => line.toJson()).toList(),
        paymentMethod: _paymentMethod,
        mpesaReference: _paymentMethod == 'mpesa_manual' ? mpesaRef : '',
        previewTotal: _cartTotal,
        amountPaid: amountPaid,
        amountTendered: amountTendered,
        isCredit: _isCredit,
        customerName: _customerNameController.text.trim(),
        customerPhone: _customerPhoneController.text.trim(),
        customerEmail: _customerEmailController.text.trim(),
        dueDate: _creditDueDateController.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _cart.clear();
        _mpesaReferenceController.clear();
        _cashTenderedController.clear();
        _creditPaidController.clear();
        _customerNameController.clear();
        _customerPhoneController.clear();
        _customerEmailController.clear();
        _creditDueDateController.clear();
        _isCredit = false;
      });
      await _loadSales();
      if (!mounted) return;
      _showMessage(
        'Sale recorded successfully. Saved locally and queued for sync.',
      );
    } catch (error) {
      if (mounted) setState(() => _actionError = 'Sale was not saved: $error');
    } finally {
      if (mounted) setState(() => _isSavingSale = false);
    }
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
    if (!mounted) return;
    final cancelled = await widget.repository.cancelSale(
      widget.user.id,
      sale.localId,
    );
    await _loadSales();
    if (mounted && !cancelled) {
      _showMessage('This sale is already syncing or has been synced.');
    }
  }

  Future<void> _correctSale(LocalSale sale) async {
    final items = sale.items.map(Map<String, dynamic>.from).toList();
    if (!sale.payloadReadable) return;
    final correctedItems = await showDialog<List<Map<String, dynamic>>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('Review sale correction'),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    sale.errorMessage?.trim().isNotEmpty == true
                        ? sale.errorMessage!.trim()
                        : 'This sale was not accepted by the server. Review its items or retry it.',
                    style: const TextStyle(color: RetivoxTheme.danger),
                  ),
                  const SizedBox(height: 14),
                  for (var index = 0; index < items.length; index++)
                    Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: Padding(
                        padding: const EdgeInsets.all(10),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    items[index]['name']?.toString() ??
                                        'Product',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  Text(
                                    items[index]['unitName']?.toString() ??
                                        'Unit',
                                    style: const TextStyle(fontSize: 12),
                                  ),
                                ],
                              ),
                            ),
                            SizedBox(
                              width: 92,
                              child: TextFormField(
                                key: ValueKey('sale-correction-$index'),
                                initialValue:
                                    items[index]['quantity']?.toString() ?? '1',
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                      decimal: true,
                                    ),
                                decoration: const InputDecoration(
                                  labelText: 'Qty',
                                  isDense: true,
                                ),
                                onChanged: (value) {
                                  final quantity = double.tryParse(value);
                                  if (quantity == null ||
                                      !quantity.isFinite ||
                                      quantity <= 0) {
                                    return;
                                  }
                                  final item = items[index];
                                  item['quantity'] = quantity;
                                  final productSnapshot =
                                      item['productSnapshot'];
                                  final uomSnapshot = item['uomSnapshot'];
                                  if (productSnapshot is Map &&
                                      uomSnapshot is Map) {
                                    final product = SaleProduct.fromCachedJson(
                                      Map<String, dynamic>.from(
                                        productSnapshot,
                                      ),
                                    );
                                    final price = product.previewPrice(
                                      quantity,
                                      Map<String, dynamic>.from(uomSnapshot),
                                    );
                                    if (price != null) {
                                      item['previewLineTotal'] = price;
                                    }
                                  }
                                },
                              ),
                            ),
                            IconButton(
                              tooltip: 'Remove product',
                              onPressed: () =>
                                  setDialogState(() => items.removeAt(index)),
                              icon: const Icon(Icons.delete_outline_rounded),
                            ),
                          ],
                        ),
                      ),
                    ),
                  if (_products.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    DropdownButtonFormField<String>(
                      initialValue: null,
                      decoration: const InputDecoration(
                        labelText: 'Add a product',
                      ),
                      items: _products
                          .map(
                            (product) => DropdownMenuItem(
                              value: product.optionId,
                              child: Text(product.name),
                            ),
                          )
                          .toList(),
                      onChanged: (optionId) {
                        if (optionId == null) return;
                        final product = _products.firstWhere(
                          (item) => item.optionId == optionId,
                        );
                        final uom = product.defaultSaleUom;
                        if (uom == null) return;
                        final price = product.previewPrice(1, uom);
                        if (price == null) return;
                        setDialogState(() {
                          items.add({
                            'productId': product.productId,
                            'uomId': uom['id'],
                            'quantity': 1,
                            'recoveryItemId': product.recoveryItemId,
                            'name': product.name,
                            'unitName': uom['name'],
                            'previewLineTotal': price,
                            'productSnapshot': product.toJson(),
                            'uomSnapshot': uom,
                          });
                        });
                      },
                    ),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(
                dialogContext,
                sale.items.map(Map<String, dynamic>.from).toList(),
              ),
              child: const Text('Retry as saved'),
            ),
            FilledButton(
              onPressed: items.isEmpty
                  ? null
                  : () => Navigator.pop(
                      dialogContext,
                      items.map(Map<String, dynamic>.from).toList(),
                    ),
              child: const Text('Save edits and retry'),
            ),
          ],
        ),
      ),
    );
    if (correctedItems == null || !mounted) return;
    try {
      await widget.repository.correctSale(
        sale.localId,
        widget.user.id,
        correctedItems,
      );
      await _loadSales();
      if (await _checkConnectivity()) await _syncPending();
      if (mounted) {
        _showMessage('Sale correction saved; sync has been retried.');
      }
    } catch (error) {
      if (mounted) _showMessage('Could not correct this sale: $error');
    }
  }

  Future<void> _printReceipt(LocalSale sale) async {
    if (!sale.payloadReadable) {
      _showMessage(
        'This saved sale cannot be printed because its data is unreadable.',
      );
      return;
    }
    final branch = widget.user.branches
        .where((item) => item.id == sale.branchId)
        .firstOrNull;
    final receipt = pw.Document();
    final recordedAt = DateTime.tryParse(sale.recordedAt)?.toLocal();
    final mpesaReference = sale.mpesaReference;
    receipt.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat(
          80 * PdfPageFormat.mm,
          260 * PdfPageFormat.mm,
          marginAll: 4 * PdfPageFormat.mm,
        ),
        build: (context) => [
          pw.Center(
            child: pw.Column(
              children: [
                pw.Text(
                  widget.user.businessName,
                  style: pw.TextStyle(
                    fontSize: 14,
                    fontWeight: pw.FontWeight.bold,
                  ),
                  textAlign: pw.TextAlign.center,
                ),
                if (branch != null)
                  pw.Text(branch.name, textAlign: pw.TextAlign.center),
                pw.SizedBox(height: 8),
                pw.Text(
                  'SALES RECEIPT',
                  style: pw.TextStyle(fontWeight: pw.FontWeight.bold),
                ),
              ],
            ),
          ),
          pw.Divider(),
          pw.Text('Receipt: ${sale.receiptNumber}'),
          pw.Text(
            'Date: ${recordedAt == null ? sale.recordedAt : DateFormat('yyyy-MM-dd HH:mm').format(recordedAt)}',
          ),
          pw.Text('Served by: ${widget.user.name}'),
          pw.Text('Payment: ${sale.paymentMethod.replaceAll('_', ' ')}'),
          if (mpesaReference != null && mpesaReference.isNotEmpty)
            pw.Text('M-Pesa ref: $mpesaReference'),
          pw.SizedBox(height: 10),
          pw.Table(
            columnWidths: const {
              0: pw.FlexColumnWidth(3),
              1: pw.FlexColumnWidth(1),
              2: pw.FlexColumnWidth(1.5),
            },
            children: [
              pw.TableRow(
                children: [
                  pw.Text(
                    'Item',
                    style: pw.TextStyle(fontWeight: pw.FontWeight.bold),
                  ),
                  pw.Text(
                    'Qty',
                    textAlign: pw.TextAlign.right,
                    style: pw.TextStyle(fontWeight: pw.FontWeight.bold),
                  ),
                  pw.Text(
                    'Amount',
                    textAlign: pw.TextAlign.right,
                    style: pw.TextStyle(fontWeight: pw.FontWeight.bold),
                  ),
                ],
              ),
              ...sale.items.map((item) {
                final quantity = _number(item['quantity']);
                final lineTotal = _number(item['previewLineTotal']);
                final itemName = item['name']?.toString() ?? 'Product';
                final unitName = item['unitName']?.toString();
                return pw.TableRow(
                  children: [
                    pw.Padding(
                      padding: const pw.EdgeInsets.symmetric(vertical: 4),
                      child: pw.Text(
                        unitName == null ? itemName : '$itemName ($unitName)',
                      ),
                    ),
                    pw.Padding(
                      padding: const pw.EdgeInsets.symmetric(vertical: 4),
                      child: pw.Text(
                        _quantityText(quantity),
                        textAlign: pw.TextAlign.right,
                      ),
                    ),
                    pw.Padding(
                      padding: const pw.EdgeInsets.symmetric(vertical: 4),
                      child: pw.Text(
                        _money.format(lineTotal),
                        textAlign: pw.TextAlign.right,
                      ),
                    ),
                  ],
                );
              }),
            ],
          ),
          pw.Divider(),
          pw.Align(
            alignment: pw.Alignment.centerRight,
            child: pw.Text(
              'TOTAL  ${widget.user.currency} ${_money.format(sale.totalAmount)}',
              style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold),
            ),
          ),
          pw.SizedBox(height: 12),
          pw.Center(child: pw.Text('Thank you for shopping with us.')),
          if (sale.status != 'synced') ...[
            pw.SizedBox(height: 6),
            pw.Center(
              child: pw.Text(
                'Recorded offline; sync status: ${sale.status.replaceAll('_', ' ')}',
                style: const pw.TextStyle(fontSize: 8),
              ),
            ),
          ],
        ],
      ),
    );
    try {
      await Printing.layoutPdf(
        name: 'Receipt ${sale.receiptNumber}',
        format: PdfPageFormat(
          80 * PdfPageFormat.mm,
          260 * PdfPageFormat.mm,
          marginAll: 4 * PdfPageFormat.mm,
        ),
        onLayout: (_) async => receipt.save(),
      );
    } catch (error) {
      if (mounted) _showMessage('Could not open receipt printing: $error');
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.maybeOf(context)
        ?.showSnackBar(SnackBar(content: Text(message)));
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
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final branches = widget.user.branches;
    final textPrimary = isDark
        ? RetivoxTheme.textPrimaryDark
        : RetivoxTheme.textPrimaryLight;
    final textMuted = isDark
        ? RetivoxTheme.textMutedDark
        : RetivoxTheme.textMutedLight;
    final bg = isDark
        ? RetivoxTheme.backgroundDark
        : RetivoxTheme.backgroundLight;

    final damagedCount = _products
        .where((p) => p.stockSource == 'recovery')
        .length;
    final showDamagedTab = damagedCount > 0;

    final filteredByTab = _products.where((p) {
      if (_activeTab == 'damaged') return p.stockSource == 'recovery';
      return p.stockSource != 'recovery';
    }).toList();

    final visibleProducts = filteredByTab.where((product) {
      final query = _search.trim().toLowerCase();
      return query.isEmpty ||
          product.name.toLowerCase().contains(query) ||
          product.sku.toLowerCase().contains(query) ||
          product.barcodes.any(
            (barcode) => barcode.toLowerCase().contains(query),
          );
    }).toList();

    return Scaffold(
      backgroundColor: bg,
      body: branches.isEmpty
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'No active branch access is saved. Sign in online to refresh your account.',
                ),
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(24),
              children: [
                // Top Action Bar with Branch & Refresh matching web
                LayoutBuilder(
                  builder: (context, constraints) {
                    final compact = constraints.maxWidth < 680;
                    final title = Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Point of sale',
                          style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                            color: textPrimary,
                            letterSpacing: -0.5,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Record sales instantly. Transactions queue safely offline and sync automatically.',
                          style: TextStyle(fontSize: 13, color: textMuted),
                        ),
                      ],
                    );
                    final branchControl = branches.length > 1
                        ? SizedBox(
                            width: compact ? constraints.maxWidth : 240,
                            child: DropdownButtonFormField<String>(
                              initialValue: _branchId,
                              isDense: true,
                              decoration: const InputDecoration(
                                labelText: 'Active branch',
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
                        : RetivoxBadge(
                            variant: RetivoxBadgeVariant.muted,
                            label: branches.first.name,
                            leading: const Icon(
                              Icons.storefront_outlined,
                              size: 14,
                            ),
                          );
                    final actions = Wrap(
                      spacing: 10,
                      runSpacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        branchControl,
                        RetivoxButton(
                          label: _isSyncing ? 'Syncing...' : 'Sync sales',
                          icon: const Icon(Icons.sync_rounded),
                          variant: RetivoxButtonVariant.outline,
                          isLoading: _isSyncing,
                          onPressed: _syncPending,
                        ),
                      ],
                    );
                    return compact
                        ? Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              title,
                              const SizedBox(height: 12),
                              actions,
                            ],
                          )
                        : Row(
                            children: [
                              Expanded(child: title),
                              actions,
                            ],
                          );
                  },
                ),
                const SizedBox(height: 16),

                if (_actionError != null || _catalogError != null) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: isDark
                          ? RetivoxTheme.dangerDark
                          : RetivoxTheme.dangerLight,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: isDark
                            ? const Color(0xFF991B1B)
                            : const Color(0xFFFECACA),
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          Icons.error_outline,
                          color: RetivoxTheme.danger,
                          size: 18,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _actionError ?? _catalogError!,
                            style: TextStyle(
                              fontSize: 13,
                              color: RetivoxTheme.danger,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                ],

                // Normal Stock vs Damaged Stock Tabs matching EmployeeSalesTabs.tsx
                Row(
                  children: [
                    RetivoxButton(
                      label: 'Normal stock',
                      variant: _activeTab == 'normal'
                          ? RetivoxButtonVariant.primary
                          : RetivoxButtonVariant.outline,
                      onPressed: () => setState(() => _activeTab = 'normal'),
                    ),
                    if (showDamagedTab) ...[
                      const SizedBox(width: 8),
                      RetivoxButton(
                        label: 'Damaged stock ($damagedCount)',
                        variant: _activeTab == 'damaged'
                            ? RetivoxButtonVariant.primary
                            : RetivoxButtonVariant.outline,
                        onPressed: () => setState(() => _activeTab = 'damaged'),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 12),

                if (_activeTab == 'damaged')
                  Container(
                    margin: const EdgeInsets.only(bottom: 14),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: isDark
                          ? RetivoxTheme.accentDark
                          : RetivoxTheme.accentLight,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: isDark
                            ? const Color(0xFF92400E)
                            : const Color(0xFFFDE68A),
                      ),
                    ),
                    child: Text(
                      'These are owner-approved damaged items with recovery prices. The system will not allow selling more than the remaining damaged quantity.',
                      style: TextStyle(
                        fontSize: 12,
                        color: isDark
                            ? const Color(0xFFFBBF24)
                            : const Color(0xFF92400E),
                        height: 1.4,
                      ),
                    ),
                  ),

                // Main POS Dual-Column Layout
                LayoutBuilder(
                  builder: (context, constraints) {
                    final wideLayout = constraints.maxWidth >= 900;
                    return Flex(
                      direction: wideLayout ? Axis.horizontal : Axis.vertical,
                      mainAxisSize: wideLayout
                          ? MainAxisSize.max
                          : MainAxisSize.min,
                      crossAxisAlignment: wideLayout
                          ? CrossAxisAlignment.start
                          : CrossAxisAlignment.stretch,
                      children: [
                        // Left Column: Catalog & Current Sale Items
                        Flexible(
                          flex: 6,
                          fit: wideLayout ? FlexFit.tight : FlexFit.loose,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              // Search & Filter Card
                              RetivoxCard(
                                padding: RetivoxCardPadding.sm,
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    TextField(
                                      controller: _searchController,
                                      focusNode: _productSearchFocus,
                                      onChanged: (val) =>
                                          setState(() => _search = val),
                                      onSubmitted: _submitBarcode,
                                      autofocus: true,
                                      decoration: InputDecoration(
                                        prefixIcon: Icon(
                                          _scannerEnabled
                                              ? Icons.qr_code_scanner
                                              : Icons.search,
                                          size: 18,
                                        ),
                                        hintText: _scannerEnabled
                                            ? 'Ready to scan a product barcode...'
                                            : 'Search name / SKU or scan barcode...',
                                        isDense: true,
                                        suffixText: _catalogUpdatedAt != null
                                            ? 'Updated ${DateFormat.jm().format(_catalogUpdatedAt!)}'
                                            : null,
                                        suffixStyle: TextStyle(
                                          fontSize: 11,
                                          color: textMuted,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(height: 10),
                                    Wrap(
                                      spacing: 8,
                                      runSpacing: 8,
                                      crossAxisAlignment:
                                          WrapCrossAlignment.center,
                                      children: [
                                        RetivoxButton(
                                          label: _scannerEnabled
                                              ? 'Stop scanner'
                                              : _supportsCameraScanner
                                              ? 'Scan barcode'
                                              : 'Use scanner',
                                          icon: Icon(
                                            _scannerEnabled
                                                ? Icons.stop_circle_outlined
                                                : Icons.qr_code_scanner,
                                          ),
                                          variant: _scannerEnabled
                                              ? RetivoxButtonVariant.outline
                                              : RetivoxButtonVariant.primary,
                                          onPressed: _scannerEnabled
                                              ? () => setState(
                                                  () => _scannerEnabled = false,
                                                )
                                              : _supportsCameraScanner
                                              ? _openCameraScanner
                                              : _activateScanner,
                                        ),
                                        if (!_supportsCameraScanner)
                                          RetivoxButton(
                                            label: 'Scanner setup',
                                            icon: const Icon(
                                              Icons.settings_outlined,
                                            ),
                                            variant:
                                                RetivoxButtonVariant.outline,
                                            onPressed: _showScannerSetup,
                                          ),
                                        Text(
                                          _scannerEnabled
                                              ? 'Ready. Scan a barcode; repeat scans add quantity.'
                                              : _supportsCameraScanner
                                              ? 'Scan products offline using the camera or enter a barcode in search.'
                                              : 'Connect a USB/Bluetooth scanner, then choose Use scanner.',
                                          style: TextStyle(
                                            fontSize: 11,
                                            color: textMuted,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 14),

                              // Product Grid
                              if (_isLoadingCatalog && _products.isEmpty)
                                const Padding(
                                  padding: EdgeInsets.all(32),
                                  child: Center(
                                    child: CircularProgressIndicator(),
                                  ),
                                )
                              else if (visibleProducts.isEmpty)
                                RetivoxCard(
                                  padding: RetivoxCardPadding.lg,
                                  child: Center(
                                    child: Text(
                                      _products.isEmpty
                                          ? 'No products available for this branch.'
                                          : 'No products match your search.',
                                      style: TextStyle(
                                        color: textMuted,
                                        fontSize: 13,
                                      ),
                                    ),
                                  ),
                                )
                              else
                                LayoutBuilder(
                                  builder: (context, constraints) {
                                    final cols = (constraints.maxWidth / 240)
                                        .floor()
                                        .clamp(1, 3);
                                    return GridView.builder(
                                      shrinkWrap: true,
                                      physics:
                                          const NeverScrollableScrollPhysics(),
                                      itemCount: visibleProducts.length,
                                      gridDelegate:
                                          SliverGridDelegateWithFixedCrossAxisCount(
                                            crossAxisCount: cols,
                                            childAspectRatio: 1.8,
                                            crossAxisSpacing: 10,
                                            mainAxisSpacing: 10,
                                          ),
                                      itemBuilder: (context, index) {
                                        final product = visibleProducts[index];
                                        final available =
                                            product.availableBaseQuantity;
                                        return RetivoxCard(
                                          padding: RetivoxCardPadding.sm,
                                          child: InkWell(
                                            onTap: available > 0
                                                ? () => _addProduct(product)
                                                : null,
                                            child: Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.start,
                                              mainAxisAlignment:
                                                  MainAxisAlignment
                                                      .spaceBetween,
                                              children: [
                                                Column(
                                                  crossAxisAlignment:
                                                      CrossAxisAlignment.start,
                                                  children: [
                                                    Text(
                                                      product.name,
                                                      maxLines: 1,
                                                      overflow:
                                                          TextOverflow.ellipsis,
                                                      style: TextStyle(
                                                        fontSize: 13,
                                                        fontWeight:
                                                            FontWeight.w600,
                                                        color: textPrimary,
                                                      ),
                                                    ),
                                                    if (product.sku.isNotEmpty)
                                                      Text(
                                                        product.sku,
                                                        style: TextStyle(
                                                          fontSize: 11,
                                                          color: textMuted,
                                                        ),
                                                      ),
                                                  ],
                                                ),
                                                Row(
                                                  mainAxisAlignment:
                                                      MainAxisAlignment
                                                          .spaceBetween,
                                                  children: [
                                                    RetivoxBadge(
                                                      variant: available > 0
                                                          ? RetivoxBadgeVariant
                                                                .success
                                                          : RetivoxBadgeVariant
                                                                .danger,
                                                      label:
                                                          'Stock: ${_quantityText(available)}',
                                                      size: RetivoxBadgeSize.sm,
                                                    ),
                                                    Text(
                                                      _formatMoney(
                                                        product.sellingPrice,
                                                      ),
                                                      style: const TextStyle(
                                                        fontSize: 13,
                                                        fontWeight:
                                                            FontWeight.w700,
                                                        color: RetivoxTheme
                                                            .primaryLightMode,
                                                      ),
                                                    ),
                                                  ],
                                                ),
                                              ],
                                            ),
                                          ),
                                        );
                                      },
                                    );
                                  },
                                ),
                              const SizedBox(height: 16),

                              // Current Cart Table Card
                              RetivoxCard(
                                padding: RetivoxCardPadding.md,
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    RetivoxCardHeader(
                                      title: 'Sale items',
                                      subtitle:
                                          '${_cart.length} item(s) selected',
                                      action: _cart.isNotEmpty
                                          ? TextButton(
                                              onPressed: () =>
                                                  setState(() => _cart.clear()),
                                              child: const Text(
                                                'Clear all',
                                                style: TextStyle(
                                                  fontSize: 12,
                                                  color: RetivoxTheme.danger,
                                                ),
                                              ),
                                            )
                                          : null,
                                    ),
                                    if (_cart.isEmpty)
                                      Padding(
                                        padding: const EdgeInsets.symmetric(
                                          vertical: 24,
                                        ),
                                        child: Center(
                                          child: Text(
                                            'Select products from the catalog above to add to this sale.',
                                            style: TextStyle(
                                              color: textMuted,
                                              fontSize: 13,
                                            ),
                                          ),
                                        ),
                                      )
                                    else
                                      for (final line in _cart) ...[
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                            vertical: 8,
                                          ),
                                          decoration: BoxDecoration(
                                            border: Border(
                                              bottom: BorderSide(
                                                color: isDark
                                                    ? RetivoxTheme.borderDark
                                                    : RetivoxTheme.borderLight,
                                              ),
                                            ),
                                          ),
                                          child: Row(
                                            children: [
                                              Expanded(
                                                child: Column(
                                                  crossAxisAlignment:
                                                      CrossAxisAlignment.start,
                                                  children: [
                                                    Text(
                                                      line.product.name,
                                                      style: TextStyle(
                                                        fontSize: 13,
                                                        fontWeight:
                                                            FontWeight.w600,
                                                        color: textPrimary,
                                                      ),
                                                    ),
                                                    Text(
                                                      '${line.uom['name'] ?? 'unit'} · ${_formatMoney(line.total)}',
                                                      style: TextStyle(
                                                        fontSize: 11,
                                                        color: textMuted,
                                                      ),
                                                    ),
                                                  ],
                                                ),
                                              ),
                                              Row(
                                                children: [
                                                  IconButton(
                                                    icon: const Icon(
                                                      Icons
                                                          .remove_circle_outline,
                                                      size: 18,
                                                    ),
                                                    visualDensity:
                                                        VisualDensity.compact,
                                                    onPressed: () =>
                                                        _changeCartQuantity(
                                                          line,
                                                          line.quantity - 1,
                                                        ),
                                                  ),
                                                  Text(
                                                    _quantityText(
                                                      line.quantity,
                                                    ),
                                                    style: TextStyle(
                                                      fontSize: 13,
                                                      fontWeight:
                                                          FontWeight.w600,
                                                      color: textPrimary,
                                                    ),
                                                  ),
                                                  IconButton(
                                                    icon: const Icon(
                                                      Icons.add_circle_outline,
                                                      size: 18,
                                                    ),
                                                    visualDensity:
                                                        VisualDensity.compact,
                                                    onPressed: () =>
                                                        _changeCartQuantity(
                                                          line,
                                                          line.quantity + 1,
                                                        ),
                                                  ),
                                                  const SizedBox(width: 8),
                                                  IconButton(
                                                    icon: const Icon(
                                                      Icons.delete_outline,
                                                      size: 18,
                                                      color:
                                                          RetivoxTheme.danger,
                                                    ),
                                                    visualDensity:
                                                        VisualDensity.compact,
                                                    onPressed: () => setState(
                                                      () => _cart.remove(line),
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ],
                                          ),
                                        ),
                                      ],
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        SizedBox(
                          width: wideLayout ? 16 : 0,
                          height: wideLayout ? 0 : 16,
                        ),

                        // Right Column: Checkout Summary Pane matching web
                        Flexible(
                          flex: 4,
                          fit: wideLayout ? FlexFit.tight : FlexFit.loose,
                          child: Column(
                            children: [
                              RetivoxCard(
                                padding: RetivoxCardPadding.md,
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    const RetivoxCardHeader(
                                      title: 'Order summary',
                                    ),

                                    // Subtotal Row
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.spaceBetween,
                                      children: [
                                        Text(
                                          'Subtotal',
                                          style: TextStyle(
                                            fontSize: 13,
                                            color: textMuted,
                                          ),
                                        ),
                                        Text(
                                          _formatMoney(_cartTotal),
                                          style: TextStyle(
                                            fontSize: 14,
                                            fontWeight: FontWeight.w600,
                                            color: textPrimary,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 12),
                                    Divider(
                                      color: isDark
                                          ? RetivoxTheme.borderDark
                                          : RetivoxTheme.borderLight,
                                    ),
                                    const SizedBox(height: 12),

                                    // Payment Method Selector matching web
                                    Text(
                                      'Payment method',
                                      style: TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                        color: textMuted,
                                      ),
                                    ),
                                    const SizedBox(height: 8),
                                    DropdownButtonFormField<String>(
                                      initialValue: _paymentMethod,
                                      decoration: const InputDecoration(
                                        labelText: 'Payment method',
                                      ),
                                      items: [
                                        DropdownMenuItem(
                                          value: 'cash',
                                          child: Text('Cash'),
                                        ),
                                        DropdownMenuItem(
                                          value: 'mpesa_manual',
                                          child: Text('Mobile manual'),
                                        ),
                                      ],
                                      onChanged: (value) => setState(
                                        () => _paymentMethod = value ?? 'cash',
                                      ),
                                    ),

                                    // M-Pesa Reference Field when M-Pesa chosen
                                    if (_paymentMethod != 'cash' &&
                                        (_paymentMethod != 'mpesa_manual' ||
                                            !_isCredit ||
                                            (double.tryParse(
                                                      _creditPaidController
                                                          .text,
                                                    ) ??
                                                    0) >
                                                0)) ...[
                                      const SizedBox(height: 14),
                                      TextField(
                                        controller: _mpesaReferenceController,
                                        textCapitalization:
                                            TextCapitalization.characters,
                                        decoration: InputDecoration(
                                          labelText:
                                              _paymentMethod == 'mpesa_manual'
                                              ? 'Mobile payment reference code'
                                              : 'Payment reference (optional)',
                                          hintText:
                                              _paymentMethod == 'mpesa_manual'
                                              ? 'e.g. SBF92JK12'
                                              : null,
                                        ),
                                      ),
                                    ],

                                    if (_paymentMethod == 'cash') ...[
                                      const SizedBox(height: 12),
                                      TextField(
                                        controller: _cashTenderedController,
                                        keyboardType:
                                            const TextInputType.numberWithOptions(
                                              decimal: true,
                                            ),
                                        decoration: InputDecoration(
                                          labelText: _isCredit
                                              ? 'Cash received now'
                                              : 'Cash received',
                                          hintText: _formatMoney(
                                            _isCredit
                                                ? (double.tryParse(
                                                        _creditPaidController
                                                            .text,
                                                      ) ??
                                                      0)
                                                : _cartTotal,
                                          ),
                                        ),
                                        onChanged: (_) => setState(() {}),
                                      ),
                                      const SizedBox(height: 6),
                                      Text(
                                        'Change: ${_formatMoney((double.tryParse(_cashTenderedController.text) ?? (_isCredit ? (double.tryParse(_creditPaidController.text) ?? 0) : _cartTotal)) - (_isCredit ? (double.tryParse(_creditPaidController.text) ?? 0) : _cartTotal))}',
                                        style: TextStyle(
                                          color: textMuted,
                                          fontSize: 12,
                                        ),
                                      ),
                                    ],

                                    SwitchListTile.adaptive(
                                      contentPadding: EdgeInsets.zero,
                                      title: const Text('Credit sale'),
                                      value: _isCredit,
                                      onChanged: (value) =>
                                          setState(() => _isCredit = value),
                                    ),
                                    if (_isCredit) ...[
                                      TextField(
                                        controller: _customerNameController,
                                        decoration: const InputDecoration(
                                          labelText: 'Customer name *',
                                        ),
                                      ),
                                      const SizedBox(height: 8),
                                      TextField(
                                        controller: _customerPhoneController,
                                        keyboardType: TextInputType.phone,
                                        decoration: const InputDecoration(
                                          labelText: 'Customer phone *',
                                        ),
                                      ),
                                      const SizedBox(height: 8),
                                      TextField(
                                        controller: _customerEmailController,
                                        keyboardType:
                                            TextInputType.emailAddress,
                                        decoration: const InputDecoration(
                                          labelText:
                                              'Customer email (optional)',
                                        ),
                                      ),
                                      const SizedBox(height: 8),
                                      TextField(
                                        controller: _creditPaidController,
                                        keyboardType:
                                            const TextInputType.numberWithOptions(
                                              decimal: true,
                                            ),
                                        decoration: const InputDecoration(
                                          labelText: 'Amount paid now',
                                          helperText: 'Leave zero if no payment was made yet',
                                        ),
                                        onChanged: (_) => setState(() {}),
                                      ),
                                      const SizedBox(height: 8),
                                      TextField(
                                        controller: _creditDueDateController,
                                        readOnly: true,
                                        decoration: const InputDecoration(
                                          labelText: 'Expected payment date *',
                                          hintText: 'Select a date',
                                        ),
                                        onTap: () async {
                                          final chosen = await showDatePicker(
                                            context: context,
                                            firstDate: DateTime.now(),
                                            lastDate: DateTime.now().add(
                                              const Duration(days: 3650),
                                            ),
                                            initialDate: DateTime.now().add(
                                              const Duration(days: 7),
                                            ),
                                          );
                                          if (chosen != null) {
                                            setState(
                                              () =>
                                                  _creditDueDateController
                                                      .text = DateFormat(
                                                    'yyyy-MM-dd',
                                                  ).format(chosen),
                                            );
                                          }
                                        },
                                      ),
                                      const SizedBox(height: 8),
                                      Text(
                                        'Balance due: ${_formatMoney(_cartTotal - (double.tryParse(_creditPaidController.text) ?? 0))}',
                                        style: TextStyle(
                                          color: textMuted,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ],

                                    const SizedBox(height: 16),
                                    Divider(
                                      color: isDark
                                          ? RetivoxTheme.borderDark
                                          : RetivoxTheme.borderLight,
                                    ),
                                    const SizedBox(height: 12),

                                    // Total Row
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.spaceBetween,
                                      children: [
                                        Text(
                                          'Total to pay',
                                          style: TextStyle(
                                            fontSize: 15,
                                            fontWeight: FontWeight.w700,
                                            color: textPrimary,
                                          ),
                                        ),
                                        Text(
                                          _formatMoney(_cartTotal),
                                          style: const TextStyle(
                                            fontSize: 20,
                                            fontWeight: FontWeight.w800,
                                            color:
                                                RetivoxTheme.primaryLightMode,
                                            letterSpacing: -0.3,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 16),

                                    // Submit Sale Button
                                    RetivoxButton(
                                      label: _isSavingSale
                                          ? 'Recording sale...'
                                          : 'Complete sale',
                                      icon: const Icon(
                                        Icons.point_of_sale_rounded,
                                      ),
                                      variant: RetivoxButtonVariant.primary,
                                      isLoading: _isSavingSale,
                                      onPressed: _cart.isEmpty || _isSavingSale
                                          ? null
                                          : _checkout,
                                    ),
                                    const SizedBox(height: 10),
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.center,
                                      children: [
                                        Icon(
                                          _isConnected
                                              ? Icons.cloud_done_outlined
                                              : Icons.cloud_off_outlined,
                                          size: 13,
                                          color: textMuted,
                                        ),
                                        const SizedBox(width: 4),
                                        Text(
                                          _isConnected
                                              ? 'Online · Syncs automatically'
                                              : 'Offline · Stored safely on device',
                                          style: TextStyle(
                                            fontSize: 11,
                                            color: textMuted,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 16),

                              // Recent Local Sales
                              RetivoxCard(
                                padding: RetivoxCardPadding.md,
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    RetivoxCardHeader(
                                      title: 'Recent local sales',
                                      action: TextButton(
                                        onPressed: _syncPending,
                                        style: TextButton.styleFrom(
                                          visualDensity: VisualDensity.compact,
                                        ),
                                        child: const Text(
                                          'Sync all',
                                          style: TextStyle(fontSize: 12),
                                        ),
                                      ),
                                    ),
                                    if (_sales.isEmpty)
                                      Padding(
                                        padding: const EdgeInsets.symmetric(
                                          vertical: 14,
                                        ),
                                        child: Center(
                                          child: Text(
                                            'No locally recorded sales yet.',
                                            style: TextStyle(
                                              color: textMuted,
                                              fontSize: 12,
                                            ),
                                          ),
                                        ),
                                      )
                                    else
                                      for (final sale
                                          in _sales
                                              .where(
                                                (s) => s.branchId == _branchId,
                                              )
                                              .take(5)) ...[
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                            vertical: 6,
                                          ),
                                          child: Row(
                                            mainAxisAlignment:
                                                MainAxisAlignment.spaceBetween,
                                            children: [
                                              Column(
                                                crossAxisAlignment:
                                                    CrossAxisAlignment.start,
                                                children: [
                                                  Text(
                                                    sale.payloadReadable
                                                        ? _formatMoney(
                                                            sale.totalAmount,
                                                          )
                                                        : 'Sale data unavailable',
                                                    style: TextStyle(
                                                      fontSize: 12,
                                                      fontWeight:
                                                          FontWeight.w600,
                                                      color: textPrimary,
                                                    ),
                                                  ),
                                                  Text(
                                                    DateFormat('h:mm a').format(
                                                      DateTime.parse(
                                                        sale.recordedAt,
                                                      ).toLocal(),
                                                    ),
                                                    style: TextStyle(
                                                      fontSize: 10,
                                                      color: textMuted,
                                                    ),
                                                  ),
                                                ],
                                              ),
                                              Row(
                                                mainAxisSize: MainAxisSize.min,
                                                children: [
                                                  InkWell(
                                                    borderRadius:
                                                        BorderRadius.circular(
                                                          20,
                                                        ),
                                                    onTap:
                                                        sale.payloadReadable &&
                                                            sale.status == 'needs_correction'
                                                        ? () =>
                                                              _correctSale(sale)
                                                        : null,
                                                    child: RetivoxBadge(
                                                      variant:
                                                          !sale.payloadReadable ||
                                                              sale.status ==
                                                                  'needs_correction'
                                                          ? RetivoxBadgeVariant
                                                                .danger
                                                          : sale.status ==
                                                                'synced'
                                                          ? RetivoxBadgeVariant
                                                                .success
                                                          : sale.status == 'needs_correction'
                                                          ? RetivoxBadgeVariant
                                                                .danger
                                                          : RetivoxBadgeVariant
                                                                .warning,
                                                      label:
                                                          sale.payloadReadable
                                                          ? sale.status
                                                                .replaceAll(
                                                                  '_',
                                                                  ' ',
                                                                )
                                                          : 'data unavailable',
                                                      size: RetivoxBadgeSize.sm,
                                                    ),
                                                  ),
                                                  const SizedBox(width: 5),
                                                  IconButton(
                                                    icon: const Icon(
                                                      Icons.print_outlined,
                                                      size: 15,
                                                    ),
                                                    tooltip: 'Print receipt',
                                                    visualDensity:
                                                        VisualDensity.compact,
                                                    padding: EdgeInsets.zero,
                                                    constraints:
                                                        const BoxConstraints(
                                                          minWidth: 28,
                                                          minHeight: 28,
                                                        ),
                                                    onPressed:
                                                        sale.payloadReadable
                                                        ? () => _printReceipt(
                                                            sale,
                                                          )
                                                        : null,
                                                  ),
                                                  if (sale.status != 'synced' &&
                                                      sale.status !=
                                                          'syncing') ...[
                                                    const SizedBox(width: 4),
                                                    IconButton(
                                                      icon: const Icon(
                                                        Icons.close_rounded,
                                                        size: 14,
                                                        color:
                                                            RetivoxTheme.danger,
                                                      ),
                                                      tooltip: 'Cancel sale',
                                                      visualDensity:
                                                          VisualDensity.compact,
                                                      padding: EdgeInsets.zero,
                                                      constraints:
                                                          const BoxConstraints(),
                                                      onPressed: () =>
                                                          _cancelSale(sale),
                                                    ),
                                                  ],
                                                ],
                                              ),
                                            ],
                                          ),
                                        ),
                                      ],
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ],
            ),
    );
  }
}

class _AddSaleProductDialog extends StatefulWidget {
  const _AddSaleProductDialog({
    required this.product,
    required this.formatMoney,
    this.protectExternalScannerInput = false,
  });

  final SaleProduct product;
  final String Function(double amount) formatMoney;
  final bool protectExternalScannerInput;

  @override
  State<_AddSaleProductDialog> createState() => _AddSaleProductDialogState();
}

class _AddSaleProductDialogState extends State<_AddSaleProductDialog> {
  final _quantityController = TextEditingController(text: '1');
  late Map<String, dynamic> _selectedUom;
  String? _error;
  DateTime? _quantityTypingStartedAt;
  bool _clearingScannerInput = false;

  @override
  void initState() {
    super.initState();
    _selectedUom =
        widget.product.defaultSaleUom ?? widget.product.uomOptions.first;
  }

  @override
  void dispose() {
    _quantityController.dispose();
    super.dispose();
  }

  double _number(Object? value, {double fallback = 0}) {
    final parsed = double.tryParse(value?.toString() ?? '');
    return parsed != null && parsed.isFinite ? parsed : fallback;
  }

  String _quantityText(double value) => value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toStringAsFixed(2);

  void _add() {
    final quantity = double.tryParse(_quantityController.text);
    final conversion = _number(_selectedUom['conversionFactor'], fallback: 1);
    if (quantity == null || !quantity.isFinite || quantity <= 0) {
      setState(() => _error = 'Enter a quantity greater than zero.');
      return;
    }
    final baseQuantity = quantity * conversion;
    if ((baseQuantity - baseQuantity.roundToDouble()).abs() > 0.0001) {
      setState(
        () => _error = 'This unit quantity must convert to whole base units.',
      );
      return;
    }
    if (baseQuantity > widget.product.availableBaseQuantity) {
      setState(() => _error = 'Quantity exceeds the available stock.');
      return;
    }
    final price = widget.product.previewPrice(quantity, _selectedUom);
    if (price == null) {
      setState(() => _error = 'No price is configured for this quantity.');
      return;
    }
    Navigator.of(context).pop(
      _ProductSelection(uom: _selectedUom, quantity: quantity, total: price),
    );
  }

  void _onQuantityChanged(String value) {
    if (_clearingScannerInput) {
      _clearingScannerInput = false;
      return;
    }
    if (widget.protectExternalScannerInput && value.isNotEmpty) {
      _quantityTypingStartedAt ??= DateTime.now();
      final elapsed = DateTime.now().difference(_quantityTypingStartedAt!);
      if (value.length >= 5 && elapsed < const Duration(milliseconds: 600)) {
        _quantityTypingStartedAt = null;
        _clearingScannerInput = true;
        _quantityController.clear();
        setState(
          () =>
              _error = 'Scanner input is paused. Enter the quantity manually.',
        );
        return;
      }
    } else if (value.isEmpty) {
      _quantityTypingStartedAt = null;
    }
    setState(() => _error = null);
  }

  @override
  Widget build(BuildContext context) {
    final product = widget.product;
    return AlertDialog(
      title: Text(product.name),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Available: ${_quantityText(product.availableBaseQuantity)} ${product.uomOptions.first['name'] ?? 'units'}',
              style: const TextStyle(
                fontSize: 12,
                color: RetivoxTheme.textMutedLight,
              ),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _selectedUom['id'] as String?,
              decoration: const InputDecoration(labelText: 'Sell as unit'),
              items: product.uomOptions
                  .map(
                    (uom) => DropdownMenuItem<String>(
                      value: uom['id'] as String?,
                      child: Text(
                        '${uom['name'] ?? 'Unit'} (${uom['abbreviation'] ?? ''})',
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (id) {
                if (id == null) return;
                setState(() {
                  _selectedUom = product.uomOptions.firstWhere(
                    (uom) => uom['id'] == id,
                  );
                  _error = null;
                });
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _quantityController,
              autofocus: true,
              onSubmitted: (_) => _add(),
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: InputDecoration(
                labelText: 'Quantity',
                errorText: _error,
              ),
              onChanged: _onQuantityChanged,
            ),
            const SizedBox(height: 12),
            ValueListenableBuilder<TextEditingValue>(
              valueListenable: _quantityController,
              builder: (context, value, _) {
                final quantity = double.tryParse(value.text) ?? 0;
                final unitPrice = product.previewPrice(1, _selectedUom);
                final price = product.previewPrice(quantity, _selectedUom);
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      unitPrice == null
                          ? 'Unit price is not configured.'
                          : 'Unit price: ${widget.formatMoney(unitPrice)}',
                      style: const TextStyle(fontSize: 12),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      price == null
                          ? 'No price is configured for this quantity.'
                          : 'Subtotal: ${widget.formatMoney(price)}',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: price == null
                            ? RetivoxTheme.danger
                            : RetivoxTheme.primaryLightMode,
                      ),
                    ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _add, child: const Text('Add to sale')),
      ],
    );
  }
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
