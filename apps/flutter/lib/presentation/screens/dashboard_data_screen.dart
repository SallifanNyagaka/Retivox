import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';
import '../theme/retivox_theme.dart';
import '../widgets/retivox_badge.dart';

import '../widgets/retivox_card.dart';
import '../widgets/retivox_metric_card.dart';
import 'cash_deposit_dialog.dart';
import 'inventory_loss_dialog.dart';
import 'product_form_dialog.dart';
import 'supplier_delivery_dialog.dart';
import 'supplier_delivery_edit_dialog.dart';

class DashboardDataScreen extends StatefulWidget {
  const DashboardDataScreen({
    required this.user,
    required this.section,
    required this.repository,
    this.refreshVersion = 0,
    super.key,
  });

  final RetivoxUser user;
  final String section;
  final DashboardRepository repository;
  final int refreshVersion;

  @override
  State<DashboardDataScreen> createState() => _DashboardDataScreenState();
}

class _DashboardDataScreenState extends State<DashboardDataScreen> {
  Future<void> _recordCashDeposit() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) =>
          CashDepositDialog(user: widget.user, repository: widget.repository),
    );
    if (saved == true && mounted) {
      _refresh();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Cash deposit submitted for review. Offline entries will sync automatically.',
          ),
        ),
      );
    }
  }

  Future<void> _createBranch() async {
    final name = TextEditingController();
    final location = TextEditingController();
    var branchType = 'store';
    var saving = false;
    String? error;
    try {
      final saved = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: const Text('Add branch'),
            content: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520, maxHeight: 560),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextField(
                      controller: name,
                      enabled: !saving,
                      maxLength: 100,
                      decoration: const InputDecoration(
                        labelText: 'Branch name',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: location,
                      enabled: !saving,
                      decoration: const InputDecoration(labelText: 'Location'),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: branchType,
                      decoration: const InputDecoration(
                        labelText: 'Branch type',
                      ),
                      items: const [
                        DropdownMenuItem(value: 'store', child: Text('Store')),
                        DropdownMenuItem(
                          value: 'warehouse',
                          child: Text('Warehouse'),
                        ),
                      ],
                      onChanged: saving
                          ? null
                          : (value) => setDialogState(
                              () => branchType = value ?? 'store',
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
                        setDialogState(() {
                          saving = true;
                          error = null;
                        });
                        try {
                          final queued = await widget.repository.createBranch(
                            widget.user,
                            name: name.text,
                            location: location.text,
                            branchType: branchType,
                          );
                          if (!dialogContext.mounted) return;
                          Navigator.pop(dialogContext, queued);
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
                    : const Text('Create branch'),
              ),
            ],
          ),
        ),
      );
      if (saved != null && mounted) {
        _refresh();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              saved == true
                  ? 'Branch saved offline and will sync when connected.'
                  : 'Branch created and synced.',
            ),
          ),
        );
      }
    } finally {
      name.dispose();
      location.dispose();
    }
  }

  Future<void> _toggleBranch(Map<String, dynamic> branch) async {
    final branchId = branch['id']?.toString();
    if (branchId == null) return;
    final isActive = branch['is_active'] == true;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(isActive ? 'Deactivate branch?' : 'Activate branch?'),
        content: Text(
          '${branch['name'] ?? 'This branch'} will be ${isActive ? 'unavailable for new operations' : 'available for use'}.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(isActive ? 'Deactivate' : 'Activate'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.repository.setBranchActive(
        widget.user,
        branchId: branchId,
        isActive: !isActive,
      );
      if (!mounted) return;
      _refresh();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(isActive ? 'Branch deactivated.' : 'Branch activated.'),
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not update branch: $error')),
        );
      }
    }
  }

  Future<void> _deleteBranch(Map<String, dynamic> branch) async {
    final branchId = branch['id']?.toString();
    final branchName = branch['name']?.toString() ?? '';
    if (branchId == null || branchName.isEmpty) return;
    final confirmation = TextEditingController();
    final reason = TextEditingController();
    var saving = false;
    String? error;
    try {
      final deleted = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: Text('Delete $branchName?'),
            content: SizedBox(
              width: 480,
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text(
                      'This removes the branch from active operations, deactivates its assignments, clears live and recovery stock, and closes pending damage reports. Historical transactions and audit records remain.',
                    ),
                    const SizedBox(height: 14),
                    Text('Type "$branchName" exactly to confirm.'),
                    const SizedBox(height: 8),
                    TextField(
                      controller: confirmation,
                      enabled: !saving,
                      decoration: const InputDecoration(
                        labelText: 'Branch name confirmation',
                      ),
                      onChanged: (_) => setDialogState(() {}),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: reason,
                      enabled: !saving,
                      maxLength: 240,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        labelText: 'Reason (optional)',
                      ),
                    ),
                    if (error != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: saving
                    ? null
                    : () => Navigator.pop(dialogContext, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: Theme.of(context).colorScheme.error,
                  foregroundColor: Theme.of(context).colorScheme.onError,
                ),
                onPressed: saving || confirmation.text.trim() != branchName
                    ? null
                    : () async {
                        setDialogState(() {
                          saving = true;
                          error = null;
                        });
                        try {
                          await widget.repository.deleteBranch(
                            widget.user,
                            branchId: branchId,
                            confirmationName: confirmation.text,
                            reason: reason.text,
                          );
                          if (dialogContext.mounted) {
                            Navigator.pop(dialogContext, true);
                          }
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
                    : const Text('Delete branch'),
              ),
            ],
          ),
        ),
      );
      if (deleted == true && mounted) {
        _refresh();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Branch deleted from active operations.'),
          ),
        );
      }
    } finally {
      confirmation.dispose();
      reason.dispose();
    }
  }

  Future<void> _recordSupplierDelivery() async {
    try {
      final results = await Future.wait([
        widget.repository.loadTransferOptions(widget.user),
        widget.repository.loadSection(widget.user, 'suppliers'),
      ]);
      if (!mounted) return;
      final options = results[0] as TransferOptionsSnapshot;
      final suppliers = (results[1] as DashboardSnapshot).rows;
      final saved = await showDialog<bool>(
        context: context,
        builder: (context) => SupplierDeliveryDialog(
          user: widget.user,
          repository: widget.repository,
          options: options,
          suppliers: suppliers,
        ),
      );
      if (saved != null && mounted) {
        _refresh();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              saved
                  ? 'Delivery saved offline and queued to sync when connected.'
                  : widget.user.role == RetivoxRole.owner
                  ? 'Delivery received and stock updated.'
                  : 'Delivery submitted for owner approval.',
            ),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open delivery form: $error')),
        );
      }
    }
  }

  Future<void> _openProductForm({
    Map<String, dynamic>? product,
    List<Map<String, dynamic>> existingProducts = const [],
  }) async {
    try {
      final options = await widget.repository.loadProductOptions(
        widget.user,
        productId: product?['id']?.toString(),
      );
      if (!mounted) return;
      final saved = await showDialog<ProductFormSaveResult>(
        context: context,
        builder: (context) => ProductFormDialog(
          user: widget.user,
          repository: widget.repository,
          units: options.units,
          branches: options.branches,
          existingProducts: existingProducts,
          product: options.product ?? product,
        ),
      );
      if (saved != null && mounted) {
        _refresh();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              saved == ProductFormSaveResult.queued
                  ? 'Product saved offline and queued to sync.'
                  : product == null
                  ? 'Product created.'
                  : 'Product updated.',
            ),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open product form: $error')),
        );
      }
    }
  }

  Future<void> _updateDelivery(
    Map<String, dynamic> row, {
    required bool approve,
  }) async {
    final id = row['id']?.toString();
    if (id == null) return;
    try {
      late final bool pendingSync;
      if (approve) {
        pendingSync = await widget.repository.approveSupplierDelivery(
          widget.user,
          id,
        );
      } else {
        pendingSync = await widget.repository.acknowledgeSupplierDelivery(
          widget.user,
          id,
        );
      }
      if (!mounted) return;
      _refresh();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            pendingSync
                ? 'Approval saved offline and queued to sync.'
                : approve
                ? 'Delivery approved.'
                : 'Delivery acknowledged.',
          ),
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not update delivery: $error')),
        );
      }
    }
  }

  Future<void> _editSupplierDelivery(Map<String, dynamic> row) async {
    try {
      final options = await widget.repository.loadTransferOptions(widget.user);
      if (!mounted) return;
      final saved = await showDialog<bool>(
        context: context,
        builder: (context) => SupplierDeliveryEditDialog(
          user: widget.user,
          repository: widget.repository,
          delivery: row,
          options: options,
        ),
      );
      if (saved != null && mounted) {
        _refresh();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              saved
                  ? 'Delivery edit saved offline and queued to sync.'
                  : widget.user.role == RetivoxRole.owner
                  ? 'Delivery and stock updated.'
                  : 'Delivery edit request submitted for owner review.',
            ),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open delivery edit: $error')),
        );
      }
    }
  }

  Future<void> _reviewSupplierDeliveryEdit(
    Map<String, dynamic> request, {
    required bool approve,
  }) async {
    final requestId = request['id']?.toString();
    if (requestId == null) return;
    try {
      final pendingSync = await widget.repository.reviewSupplierDeliveryEdit(
        widget.user,
        requestId: requestId,
        approve: approve,
      );
      if (!mounted) return;
      _refresh();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            pendingSync
                ? 'Review decision saved offline and queued to sync.'
                : approve
                ? 'Delivery edit approved.'
                : 'Delivery edit rejected.',
          ),
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not review delivery edit: $error')),
        );
      }
    }
  }

  late Future<DashboardSnapshot> _snapshot;
  String _search = '';
  String _transactionStatus = 'all';
  String _transactionBranch = 'all';
  String _stockBranch = 'all';
  String _stockTab = 'levels';
  Future<DashboardSnapshot>? _stockWorkflowSnapshot;
  Future<DashboardSnapshot>? _expiryAlertSnapshot;
  DateTimeRange? _transactionDates;
  bool _loadingMore = false;
  bool _hasMore = true;
  Timer? _filterDebounce;
  int _historyRevision = 0;

  @override
  void initState() {
    super.initState();
    _snapshot = widget.repository.loadSection(widget.user, widget.section);
    if (widget.section == 'stock') {
      _expiryAlertSnapshot = widget.repository.loadExpiryAlerts(widget.user);
    }
  }

  @override
  void didUpdateWidget(covariant DashboardDataScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.section != widget.section ||
        oldWidget.user.id != widget.user.id ||
        oldWidget.refreshVersion != widget.refreshVersion) {
      if (oldWidget.section != widget.section) _stockBranch = 'all';
      _snapshot = widget.repository.loadSection(widget.user, widget.section);
      _expiryAlertSnapshot = widget.section == 'stock'
          ? widget.repository.loadExpiryAlerts(widget.user)
          : null;
      if (widget.section == 'stock' && _stockTab != 'levels') {
        _stockWorkflowSnapshot = _loadStockTab(_stockTab);
      }
    }
  }

  String get _title => switch (widget.section) {
    'branches' => 'Branches',
    'stock' => 'Inventory',
    'products' => 'Products',
    'transactions' => 'Transactions',
    'cash_deposits' => 'Cash deposits',
    'employees' => 'Employees',
    'suppliers' => 'Suppliers',
    'deliveries' => 'Supplier deliveries',
    'damages' => 'Damaged stock',
    _ => widget.section,
  };

  void _refresh() {
    _filterDebounce?.cancel();
    _historyRevision++;
    setState(() {
      _snapshot = widget.section == 'transactions'
          ? _loadTransactionHistory()
          : widget.repository.loadSection(widget.user, widget.section);
      if (widget.section == 'stock') {
        _expiryAlertSnapshot = widget.repository.loadExpiryAlerts(widget.user);
      }
      if (widget.section == 'stock' && _stockTab != 'levels') {
        _stockWorkflowSnapshot = _loadStockTab(_stockTab);
      }
      _hasMore = true;
    });
  }

  String _stockSectionForTab(String tab) => switch (tab) {
    'suppliers' => 'suppliers',
    'approvals' || 'delivery' => 'deliveries',
    'history' => 'stock_movements',
    _ => 'stock',
  };

  Future<DashboardSnapshot> _loadStockTab(String tab) =>
      widget.repository.loadSection(widget.user, _stockSectionForTab(tab));

  void _selectStockTab(String tab) {
    if (_stockTab == tab) return;
    setState(() {
      _stockTab = tab;
      _stockWorkflowSnapshot = tab == 'levels' ? null : _loadStockTab(tab);
    });
  }

  Future<DashboardSnapshot> _loadTransactionHistory({int offset = 0}) =>
      widget.repository.loadHistoryPage(
        widget.user,
        'transactions',
        offset: offset,
        search: _search,
        status: _transactionStatus,
        branchId: _transactionBranch,
        startDate: _transactionDates?.start,
        endDate: _transactionDates?.end,
      );

  void _scheduleTransactionFilterReload() {
    _filterDebounce?.cancel();
    _historyRevision++;
    _filterDebounce = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) return;
      setState(() {
        _snapshot = _loadTransactionHistory();
        _hasMore = true;
      });
    });
  }

  @override
  void dispose() {
    _filterDebounce?.cancel();
    super.dispose();
  }

  Future<void> _loadMoreTransactions(DashboardSnapshot current) async {
    if (_loadingMore || !_hasMore || current.isCached) return;
    final revision = _historyRevision;
    setState(() => _loadingMore = true);
    try {
      final page = await _loadTransactionHistory(offset: current.rows.length);
      if (!mounted || revision != _historyRevision) return;
      setState(() {
        _snapshot = Future.value(
          DashboardSnapshot(
            section: page.section,
            rows: [...current.rows, ...page.rows],
            updatedAt: page.updatedAt,
            isCached: page.isCached,
          ),
        );
        _hasMore = page.rows.length == 200;
      });
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  Future<void> _createDamageReport() async {
    try {
      final options = await widget.repository.loadDamageReportOptions(
        widget.user,
      );
      if (!mounted) return;
      if (options.rows.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('No available stock can be reported.')),
        );
        return;
      }
      final submitted = await showDialog<bool>(
        context: context,
        builder: (context) => InventoryLossDialog(
          user: widget.user,
          repository: widget.repository,
          options: options,
        ),
      );
      if (submitted == true) {
        _refresh();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Damage report submitted.')),
          );
        }
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open damage report form: $error')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return FutureBuilder<DashboardSnapshot>(
      future: _snapshot,
      builder: (context, result) {
        return ListView(
          padding: const EdgeInsets.all(28),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(_title, style: theme.textTheme.headlineSmall),
                ),
                if (widget.section == 'damages' &&
                    widget.user.role != RetivoxRole.owner)
                  FilledButton.icon(
                    onPressed: () => _createDamageReport(),
                    icon: const Icon(Icons.add),
                    label: const Text('Report damaged stock'),
                  ),
                if (widget.section == 'suppliers' &&
                    widget.user.role != RetivoxRole.employee)
                  FilledButton.icon(
                    onPressed: () => _editSupplier(),
                    icon: const Icon(Icons.add),
                    label: const Text('Add supplier'),
                  ),
                if (widget.section == 'products' &&
                    widget.user.role == RetivoxRole.owner)
                  FilledButton.icon(
                    onPressed: () => _openProductForm(
                      existingProducts: result.data?.rows ?? const [],
                    ),
                    icon: const Icon(Icons.add),
                    label: const Text('Add product'),
                  ),
                if (widget.section == 'branches' &&
                    widget.user.role == RetivoxRole.owner)
                  FilledButton.icon(
                    onPressed: _createBranch,
                    icon: const Icon(Icons.add),
                    label: const Text('Add branch'),
                  ),
                if (widget.section == 'cash_deposits')
                  FilledButton.icon(
                    onPressed: _recordCashDeposit,
                    icon: const Icon(Icons.account_balance_outlined),
                    label: const Text('Record cash deposit'),
                  ),
                if (widget.section == 'deliveries')
                  FilledButton.icon(
                    onPressed: _recordSupplierDelivery,
                    icon: const Icon(Icons.add),
                    label: const Text('Record delivery'),
                  ),
                if (widget.section == 'damages' &&
                    widget.user.role != RetivoxRole.owner)
                  const SizedBox(width: 8),
                if (widget.section == 'suppliers' &&
                    widget.user.role != RetivoxRole.employee)
                  const SizedBox(width: 8),
                IconButton(
                  tooltip: 'Refresh from server',
                  onPressed: _refresh,
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              _subtitle,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 14),
            if (result.hasError)
              Card(
                color: theme.colorScheme.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    result.error.toString(),
                    style: TextStyle(color: theme.colorScheme.onErrorContainer),
                  ),
                ),
              )
            else if (!result.hasData)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(40),
                  child: CircularProgressIndicator(),
                ),
              )
            else ...[
              _cacheLabel(result.data!),
              const SizedBox(height: 10),
              if (widget.section != 'deliveries') const _ReadOnlyNotice(),
              const SizedBox(height: 16),
              if (widget.section != 'branches')
                SizedBox(
                  width: 420,
                  child: TextField(
                    onChanged: (value) {
                      setState(() => _search = value);
                      if (widget.section == 'transactions') {
                        _scheduleTransactionFilterReload();
                      }
                    },
                    decoration: InputDecoration(
                      prefixIcon: const Icon(Icons.search),
                      labelText: 'Search $_title',
                      isDense: true,
                    ),
                  ),
                ),
              if (widget.section == 'transactions') ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    for (final status in const [
                      'all',
                      'pending_sync',
                      'synced',
                      'pending_verify',
                      'verified',
                      'rejected',
                      'flagged',
                      'voided',
                    ])
                      ChoiceChip(
                        label: Text(
                          status == 'all'
                              ? 'All statuses'
                              : status == 'pending_sync'
                              ? 'Offline sync'
                              : status == 'pending_verify'
                              ? 'Awaiting verification'
                              : status[0].toUpperCase() + status.substring(1),
                        ),
                        selected: _transactionStatus == status,
                        onSelected: (_) {
                          setState(() => _transactionStatus = status);
                          _scheduleTransactionFilterReload();
                        },
                      ),
                    if (widget.user.branches.length > 1)
                      SizedBox(
                        width: 220,
                        child: DropdownButtonFormField<String>(
                          initialValue: _transactionBranch,
                          isDense: true,
                          decoration: const InputDecoration(
                            labelText: 'Branch',
                            border: OutlineInputBorder(),
                          ),
                          items: [
                            const DropdownMenuItem(
                              value: 'all',
                              child: Text('All branches'),
                            ),
                            for (final branch in widget.user.branches)
                              DropdownMenuItem(
                                value: branch.id,
                                child: Text(
                                  branch.name,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                          ],
                          onChanged: (value) {
                            setState(() => _transactionBranch = value ?? 'all');
                            _scheduleTransactionFilterReload();
                          },
                        ),
                      ),
                    OutlinedButton.icon(
                      onPressed: _selectTransactionDates,
                      icon: const Icon(Icons.date_range_outlined),
                      label: Text(
                        _transactionDates == null
                            ? 'Date range'
                            : '${DateFormat.MMMd().format(_transactionDates!.start)} – ${DateFormat.MMMd().format(_transactionDates!.end)}',
                      ),
                    ),
                    if (_transactionDates != null)
                      IconButton(
                        tooltip: 'Clear date range',
                        onPressed: () {
                          setState(() => _transactionDates = null);
                          _scheduleTransactionFilterReload();
                        },
                        icon: const Icon(Icons.close),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 16),
              if (widget.section == 'stock') ...[
                _stockTabs(),
                const SizedBox(height: 16),
                if (_stockTab == 'levels')
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _expiryAlertsPanel(),
                      _stockTable(context, _filter(result.data!.rows)),
                    ],
                  )
                else
                  _stockWorkflowContent(),
              ] else
                _records(
                  context,
                  widget.section == 'products'
                      ? result.data!.rows
                      : _filter(result.data!.rows),
                ),
              if (widget.section == 'transactions' &&
                  result.data!.rows.length >= 200) ...[
                const SizedBox(height: 12),
                Align(
                  alignment: Alignment.center,
                  child: OutlinedButton.icon(
                    onPressed:
                        _loadingMore || !_hasMore || result.data!.isCached
                        ? null
                        : () => _loadMoreTransactions(result.data!),
                    icon: _loadingMore
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.history),
                    label: Text(
                      result.data!.isCached
                          ? 'Connect to load older transactions'
                          : _hasMore
                          ? 'Load older transactions'
                          : 'No older transactions',
                    ),
                  ),
                ),
              ],
            ],
          ],
        );
      },
    );
  }

  Widget _stockTabs() {
    const tabs = [
      ('levels', 'Current levels', Icons.inventory_2_outlined),
      ('delivery', 'Supplier delivery', Icons.local_shipping_outlined),
      ('suppliers', 'Suppliers', Icons.business_outlined),
      ('approvals', 'Deliveries & approvals', Icons.fact_check_outlined),
      ('history', 'Movement history', Icons.history),
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final tab in tabs) ...[
            if (tab != tabs.first) const SizedBox(width: 8),
            _stockTab == tab.$1
                ? FilledButton.icon(
                    onPressed: () => _selectStockTab(tab.$1),
                    icon: Icon(tab.$3, size: 18),
                    label: Text(tab.$2),
                  )
                : OutlinedButton.icon(
                    onPressed: () => _selectStockTab(tab.$1),
                    icon: Icon(tab.$3, size: 18),
                    label: Text(tab.$2),
                  ),
          ],
        ],
      ),
    );
  }

  Widget _expiryAlertsPanel() {
    final future = _expiryAlertSnapshot;
    if (future == null) return const SizedBox.shrink();
    return FutureBuilder<DashboardSnapshot>(
      future: future,
      builder: (context, result) {
        if (result.hasError || !result.hasData || result.data!.rows.isEmpty) {
          return const SizedBox.shrink();
        }
        final snapshot = result.data!;
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: RetivoxCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    const Icon(
                      Icons.warning_amber_rounded,
                      color: Colors.deepOrange,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Expiry alerts',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    if (snapshot.isCached) const Chip(label: Text('Cached')),
                  ],
                ),
                const SizedBox(height: 8),
                for (final row in snapshot.rows)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      '${row['product_name'] ?? 'Product'}${row['supplier_lot_code'] == null ? '' : ' · lot ${row['supplier_lot_code']}'}',
                    ),
                    subtitle: Text(
                      '${row['branch_name'] ?? 'Branch'} · expires ${row['expires_on'] ?? 'date unavailable'} · ${row['base_quantity_on_hand'] ?? 0} in stock',
                    ),
                    trailing: Text(
                      row['alert_status'] == 'expired'
                          ? 'Expired'
                          : '${row['days_remaining']} days',
                      style: TextStyle(
                        color: row['alert_status'] == 'expired'
                            ? Colors.red
                            : Colors.deepOrange,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _stockWorkflowContent() {
    final future = _stockWorkflowSnapshot;
    if (future == null) return const SizedBox.shrink();
    return FutureBuilder<DashboardSnapshot>(
      future: future,
      builder: (context, result) {
        if (result.hasError) {
          return Card(
            color: Theme.of(context).colorScheme.errorContainer,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(result.error.toString()),
            ),
          );
        }
        if (!result.hasData) {
          return const Center(
            child: Padding(
              padding: EdgeInsets.all(36),
              child: CircularProgressIndicator(),
            ),
          );
        }
        final snapshot = result.data!;
        final rows = _filter(snapshot.rows);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _cacheLabel(snapshot),
            const SizedBox(height: 12),
            if (_stockTab == 'delivery') ...[
              RetivoxCard(
                child: Row(
                  children: [
                    const Icon(Icons.local_shipping_outlined, size: 30),
                    const SizedBox(width: 14),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Record supplier delivery'),
                          SizedBox(height: 4),
                          Text(
                            'Choose a supplier, branch and delivery items. Received quantities update stock.',
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    FilledButton.icon(
                      onPressed: _recordSupplierDelivery,
                      icon: const Icon(Icons.add),
                      label: const Text('New delivery'),
                    ),
                  ],
                ),
              ),
              if (snapshot.isCached)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text(
                    'You can record deliveries offline. They will sync automatically when the server is reachable.',
                  ),
                ),
              const SizedBox(height: 14),
              _deliveriesList(rows),
            ] else if (_stockTab == 'suppliers') ...[
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton.icon(
                  onPressed: () => _editSupplier(),
                  icon: const Icon(Icons.add),
                  label: const Text('Add supplier'),
                ),
              ),
              const SizedBox(height: 12),
              _suppliersTable(rows),
            ] else if (_stockTab == 'approvals')
              _deliveriesList(rows)
            else
              _stockMovementsTable(rows),
          ],
        );
      },
    );
  }

  Widget _stockMovementsTable(List<Map<String, dynamic>> rows) {
    if (rows.isEmpty) {
      return const Card(
        child: ListTile(
          leading: Icon(Icons.history),
          title: Text('No stock movements found'),
          subtitle: Text(
            'Movement records appear here as deliveries and stock changes are recorded.',
          ),
        ),
      );
    }
    return RetivoxCard(
      padding: RetivoxCardPadding.none,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          columns: const [
            DataColumn(label: Text('Date')),
            DataColumn(label: Text('Type')),
            DataColumn(label: Text('Product')),
            DataColumn(label: Text('Branch')),
            DataColumn(label: Text('Qty')),
            DataColumn(label: Text('Actor')),
            DataColumn(label: Text('Reference')),
          ],
          rows: rows.map((row) {
            final quantity = _number(row['quantity']);
            final date = DateTime.tryParse(row['created_at']?.toString() ?? '')
                ?.toLocal();
            final type = (row['movement_type']?.toString() ?? 'movement')
                .replaceAll('_', ' ');
            return DataRow(
              cells: [
                DataCell(
                  Text(
                    date == null
                        ? '—'
                        : DateFormat.yMMMd().add_jm().format(date),
                  ),
                ),
                DataCell(Text(type)),
                DataCell(Text(row['product_name']?.toString() ?? '—')),
                DataCell(Text(row['branch_name']?.toString() ?? '—')),
                DataCell(Text('${quantity > 0 ? '+' : ''}$quantity')),
                DataCell(Text(row['actor_name']?.toString() ?? '—')),
                DataCell(Text(row['reference_label']?.toString() ?? '—')),
              ],
            );
          }).toList(),
        ),
      ),
    );
  }

  String get _subtitle => switch (widget.section) {
    'branches' => 'Branches assigned to this account. Access is determined by the signed-in role.',
    'stock' => 'Current inventory for authorized branches. This view currently loads up to 500 inventory rows.',
    'products' => 'Business product catalog available to this role. This view currently loads up to 500 products.',
    'employees' =>
      widget.user.role == RetivoxRole.owner
          ? 'Business users visible to the owner account.'
          : 'Employees assigned to branches where this account has admin access.',
    'suppliers' => 'Supplier contacts available to the business.',
    'deliveries' => 'Supplier delivery history for branches where this account has management access.',
    'damages' => 'Recent damaged, spoiled, missing, or discounted stock reports visible to this role.',
    'transactions' =>
      widget.user.role == RetivoxRole.employee
          ? 'Transactions recorded by this employee across assigned branches. Load older records in 200-row pages.'
          : 'Transactions visible across branches assigned to this account. Load older records in 200-row pages.',
    'cash_deposits' => 'Record branch cash deposits offline or online, track every review stage, and reconcile deposited cash.',
    _ => '',
  };

  List<Map<String, dynamic>> _filter(List<Map<String, dynamic>> rows) {
    final query = _search.trim().toLowerCase();
    return rows
        .where(
          (row) =>
              row.values.any((value) {
                if (value is Map<String, dynamic>) {
                  return value.values.any(
                    (nested) => nested.toString().toLowerCase().contains(query),
                  );
                }
                return value.toString().toLowerCase().contains(query);
              }) ||
              query.isEmpty,
        )
        .where(
          (row) =>
              widget.section != 'transactions' ||
              (_transactionStatus == 'all' ||
                      row['status']?.toString() == _transactionStatus ||
                      (_transactionStatus == 'pending_verify' &&
                          row['status']?.toString() == 'pending_sync')) &&
                  (_transactionBranch == 'all' ||
                      row['branch_id']?.toString() == _transactionBranch) &&
                  (_transactionDates == null ||
                      _isInDateRange(row['recorded_at'], _transactionDates!)),
        )
        .toList();
  }

  bool _isInDateRange(Object? value, DateTimeRange range) {
    final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    if (date == null) return false;
    final start = DateTime(
      range.start.year,
      range.start.month,
      range.start.day,
    );
    final endExclusive = DateTime(
      range.end.year,
      range.end.month,
      range.end.day + 1,
    );
    return !date.isBefore(start) && date.isBefore(endExclusive);
  }

  Future<void> _selectTransactionDates() async {
    final today = DateTime.now();
    final selected = await showDateRangePicker(
      context: context,
      firstDate: DateTime(today.year - 10),
      lastDate: DateTime(today.year, today.month, today.day),
      initialDateRange: _transactionDates,
    );
    if (selected != null && mounted) {
      setState(() => _transactionDates = selected);
      _scheduleTransactionFilterReload();
    }
  }

  Widget _cacheLabel(DashboardSnapshot snapshot) {
    final timestamp = snapshot.updatedAt?.toLocal().toString().substring(0, 16);
    return Row(
      children: [
        Icon(
          snapshot.isCached
              ? Icons.storage_outlined
              : Icons.cloud_done_outlined,
          size: 17,
        ),
        const SizedBox(width: 8),
        Text(
          snapshot.isCached
              ? 'Showing saved data${timestamp == null ? '' : ' · last refreshed $timestamp'}'
              : 'Showing latest data${timestamp == null ? '' : ' · refreshed $timestamp'}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }

  Widget _records(BuildContext context, List<Map<String, dynamic>> rows) {
    if (rows.isEmpty) {
      return const Card(
        child: ListTile(
          leading: Icon(Icons.inbox_outlined),
          title: Text('No records available'),
          subtitle: Text('Try refreshing while connected to the internet.'),
        ),
      );
    }

    return switch (widget.section) {
      'branches' => _branchCards(rows),
      'stock' => _stockTable(context, rows),
      'products' => _productsTable(_filter(rows), allProducts: rows),
      'transactions' => _transactionsTable(rows),
      'cash_deposits' => _cashDepositsList(rows),
      'employees' => _employeesTable(rows),
      'suppliers' => _suppliersTable(rows),
      'deliveries' => _deliveriesList(rows),
      'damages' => _damagesTable(rows),
      _ => const SizedBox.shrink(),
    };
  }

  Widget _cashDepositsList(List<Map<String, dynamic>> rows) {
    final currency = NumberFormat.currency(name: widget.user.currency);
    final isOwner = widget.user.role == RetivoxRole.owner;
    final isAdmin = widget.user.role == RetivoxRole.admin;
    return Column(
      children: [
        for (final row in rows)
          Card(
            margin: const EdgeInsets.only(bottom: 10),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.account_balance_outlined),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          '${(row['branches'] as Map?)?['name'] ?? 'Branch'} · ${currency.format(_number(row['amount']))}',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                      Chip(
                        label: Text(
                          row['is_pending_sync'] == true
                              ? 'Waiting to sync'
                              : (row['status']?.toString() ?? 'pending')
                                    .replaceAll('_', ' '),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Recorded by ${(row['depositor'] as Map?)?['name'] ?? row['deposited_by_name'] ?? 'Team member'} · ${_dateTime(row['deposit_date'])} · Ref: ${row['deposit_reference'] ?? '—'}',
                  ),
                  if (row['expected_cash_amount'] != null)
                    Text(
                      'Expected ${currency.format(_number(row['expected_cash_amount']))} · Variance ${currency.format(_number(row['variance_amount']))}',
                    ),
                  if (row['admin_approved_at'] != null)
                    const Text(
                      'Administrator review complete · awaiting owner final approval',
                    ),
                  if ((row['review_note'] ?? row['sync_error']) != null)
                    Text(
                      row['sync_error']?.toString() ??
                          'Review note: ${row['review_note']}',
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  if (row['is_pending_sync'] != true &&
                      ((isOwner &&
                              const [
                                'pending',
                                'pending_owner',
                              ].contains(row['status'])) ||
                          (isAdmin &&
                              row['status'] == 'pending' &&
                              row['submitted_role'] == 'employee')))
                    Align(
                      alignment: Alignment.centerRight,
                      child: Wrap(
                        spacing: 8,
                        children: [
                          OutlinedButton.icon(
                            onPressed: () => _reviewCashDeposit(row, 'reject'),
                            icon: const Icon(Icons.close),
                            label: const Text('Reject'),
                          ),
                          FilledButton.icon(
                            onPressed:
                                (isAdmin ||
                                    _number(row['variance_amount']) == 0)
                                ? () => _reviewCashDeposit(row, 'approve')
                                : null,
                            icon: const Icon(Icons.check),
                            label: Text(
                              isAdmin ? 'Approve for owner' : 'Approve',
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Future<void> _reviewCashDeposit(
    Map<String, dynamic> row,
    String action,
  ) async {
    final note = TextEditingController();
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(
            action == 'approve'
                ? 'Approve cash deposit?'
                : 'Reject cash deposit?',
          ),
          content: TextField(
            controller: note,
            maxLength: 180,
            decoration: const InputDecoration(
              labelText: 'Review note (optional)',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text(action == 'approve' ? 'Approve' : 'Reject'),
            ),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;
      await widget.repository.reviewCashDeposit(
        widget.user,
        depositId: row['id'].toString(),
        action: action,
        reviewNote: note.text,
      );
      _refresh();
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Cash deposit review saved. Offline changes sync automatically.',
            ),
          ),
        );
    } catch (error) {
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not review deposit: $error')),
        );
    } finally {
      note.dispose();
    }
  }

  Widget _deliveriesList(List<Map<String, dynamic>> rows) {
    if (rows.isEmpty) {
      return const Card(
        child: ListTile(
          leading: Icon(Icons.inbox_outlined),
          title: Text('No supplier deliveries found'),
        ),
      );
    }
    return Column(
      children: [
        for (final row in rows)
          Card(
            margin: const EdgeInsets.only(bottom: 10),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          row['supplier_name']?.toString() ?? 'Supplier',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                      Chip(
                        label: Text(
                          row['is_pending_sync'] == true
                              ? 'Waiting to sync'
                              : (row['status']?.toString() ?? 'unknown')
                                    .replaceAll('_', ' '),
                        ),
                      ),
                    ],
                  ),
                  Text(
                    '${_nested(row['branches'])?['name'] ?? 'Branch'}'
                    ' · ${row['reference_code'] ?? 'No reference'}'
                    ' · ${_dateTime(row['recorded_at'])}',
                  ),
                  if (row['sync_error'] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        'Sync needs attention: ${row['sync_error']}',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  const SizedBox(height: 8),
                  for (final item
                      in (row['items'] as List? ?? const [])
                          .whereType<Map<String, dynamic>>())
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Text(
                        '${_nested(item['products'])?['name'] ?? 'Product'}'
                        ' · expected ${item['quantity_in_uom'] ?? item['quantity_expected'] ?? '—'}'
                        ' ${_nested(item['units_of_measure'])?['abbreviation'] ?? ''}'
                        ' · received ${item['base_quantity_received'] ?? item['quantity_received'] ?? 0} base units',
                      ),
                    ),
                  if (widget.user.role != RetivoxRole.employee &&
                      row['is_pending_sync'] != true &&
                      row['status'] == 'received')
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton.icon(
                        onPressed: () => _editSupplierDelivery(row),
                        icon: const Icon(Icons.edit_outlined),
                        label: const Text('Edit delivery'),
                      ),
                    ),
                  for (final request
                      in (row['edit_requests'] as List? ?? const [])
                          .whereType<Map<String, dynamic>>())
                    Card(
                      color: Theme.of(context).colorScheme.secondaryContainer,
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              request['is_pending_sync'] == true
                                  ? 'Edit decision waiting to sync'
                                  : 'Pending delivery edit request',
                              style: Theme.of(context).textTheme.titleSmall,
                            ),
                            if (_nested(request['new_value'])
                                case final proposal?)
                              Text(
                                'Proposed supplier: ${proposal['supplierName'] ?? '—'}'
                                ' · reference: ${proposal['referenceCode'] ?? '—'}'
                                ' · lines: ${(proposal['items'] as List? ?? const []).length}',
                              ),
                            if (request['reason'] != null)
                              Text('Reason: ${request['reason']}'),
                            Text(
                              'Requested ${_dateTime(request['requested_at'])}',
                            ),
                            Align(
                              alignment: Alignment.centerRight,
                              child: Wrap(
                                spacing: 8,
                                children: [
                                  TextButton(
                                    onPressed:
                                        request['is_pending_sync'] == true
                                        ? null
                                        : () => _reviewSupplierDeliveryEdit(
                                            request,
                                            approve: false,
                                          ),
                                    child: const Text('Reject'),
                                  ),
                                  FilledButton.tonal(
                                    onPressed:
                                        request['is_pending_sync'] == true
                                        ? null
                                        : () => _reviewSupplierDeliveryEdit(
                                            request,
                                            approve: true,
                                          ),
                                    child: const Text('Approve edit'),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  if (widget.user.role == RetivoxRole.owner &&
                      row['status'] == 'pending_approval')
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton.tonal(
                        onPressed: () => _updateDelivery(row, approve: true),
                        child: const Text('Approve delivery'),
                      ),
                    )
                  else if (row['status'] == 'approved')
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton.tonal(
                        onPressed: () => _updateDelivery(row, approve: false),
                        child: const Text('Acknowledge receipt'),
                      ),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  String _dateTime(Object? value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '');
    return parsed == null
        ? 'Date unavailable'
        : DateFormat.yMMMd().add_jm().format(parsed.toLocal());
  }

  Future<void> _showBranchDetails(Map<String, dynamic> branch) async {
    final branchId = branch['id']?.toString();
    if (branchId == null) return;
    await showDialog<void>(
      context: context,
      builder: (context) => _BranchDetailsDialog(
        user: widget.user,
        repository: widget.repository,
        branch: branch,
      ),
    );
  }

  Widget _branchCards(List<Map<String, dynamic>> rows) {
    return LayoutBuilder(
      builder: (context, constraints) => Wrap(
        spacing: 12,
        runSpacing: 12,
        children: rows.map((row) {
          return SizedBox(
            width: constraints.maxWidth < 360 ? constraints.maxWidth : 340,
            child: Card(
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () => _showBranchDetails(row),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const CircleAvatar(
                          child: Icon(Icons.store_outlined),
                        ),
                        title: Text(
                          row['name']?.toString() ?? 'Branch',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Text(
                          widget.user.role == RetivoxRole.owner
                              ? '${row['location'] ?? 'Location not set'} · ${row['branch_type'] ?? 'Branch'}'
                              : 'Role: ${row['role'] ?? 'assigned'}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: widget.user.role == RetivoxRole.owner
                            ? Chip(
                                label: Text(
                                  row['is_pending_sync'] == true
                                      ? 'Waiting to sync'
                                      : row['is_active'] == false
                                      ? 'Inactive'
                                      : 'Active',
                                ),
                              )
                            : null,
                      ),
                      Align(
                        alignment: Alignment.centerRight,
                        child: Wrap(
                          spacing: 4,
                          children: [
                            TextButton.icon(
                              onPressed: () => _showBranchDetails(row),
                              icon: const Icon(Icons.info_outline, size: 18),
                              label: const Text('Store details'),
                            ),
                            if (widget.user.role == RetivoxRole.owner) ...[
                              TextButton(
                                onPressed: () => _toggleBranch(row),
                                child: Text(
                                  row['is_active'] == false
                                      ? 'Activate'
                                      : 'Deactivate',
                                ),
                              ),
                              IconButton(
                                tooltip: 'Delete branch',
                                onPressed: () => _deleteBranch(row),
                                icon: const Icon(
                                  Icons.delete_outline,
                                  size: 18,
                                ),
                                color: Theme.of(context).colorScheme.error,
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _stockTable(BuildContext context, List<Map<String, dynamic>> rows) {
    final branches = <String, String>{
      for (final branch in widget.user.branches) branch.id: branch.name,
    };
    for (final row in rows) {
      final branch = _nested(row['branches']);
      final id = branch?['id']?.toString();
      if (id != null) branches[id] = branch?['name']?.toString() ?? 'Branch';
    }
    final sortedBranches = branches.entries.toList()
      ..sort(
        (first, second) =>
            first.value.toLowerCase().compareTo(second.value.toLowerCase()),
      );

    final metricsRows = rows;
    final filteredRows = _stockBranch == 'all'
        ? rows
        : rows
              .where((row) => row['branch_id']?.toString() == _stockBranch)
              .toList();
    final lowStockCount = metricsRows.where((row) {
      final quantity = _number(
        row['base_quantity_on_hand'] ?? row['quantity_on_hand'],
      );
      return quantity > 0 && quantity <= _stockThresholdBase(row);
    }).length;
    final outOfStockCount = metricsRows
        .where(
          (row) =>
              _number(
                row['base_quantity_on_hand'] ?? row['quantity_on_hand'],
              ) ==
              0,
        )
        .length;
    final branchesWithAlerts = <String>{
      for (final row in metricsRows)
        if (_number(row['base_quantity_on_hand'] ?? row['quantity_on_hand']) <=
            _stockThresholdBase(row))
          row['branch_id']?.toString() ?? '',
    }..remove('');

    final theme = Theme.of(context);
    final muted = theme.brightness == Brightness.dark
        ? RetivoxTheme.textMutedDark
        : RetivoxTheme.textMutedLight;
    final primary = theme.brightness == Brightness.dark
        ? RetivoxTheme.primaryDarkMode
        : RetivoxTheme.primaryLightMode;

    Widget metric(String label, String value, IconData icon, Color color) =>
        RetivoxMetricCard(
          label: label,
          value: value,
          icon: Icon(icon, size: 18, color: color),
          valueColor: color,
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 1050
                ? 4
                : constraints.maxWidth >= 620
                ? 2
                : 1;
            return GridView.count(
              crossAxisCount: columns,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 14,
              mainAxisSpacing: 14,
              childAspectRatio: columns == 1 ? 3.1 : 1.8,
              children: [
                metric(
                  'Total SKUs',
                  '${metricsRows.length}',
                  Icons.qr_code_2,
                  primary,
                ),
                metric(
                  'Low stock items',
                  '$lowStockCount',
                  Icons.warning_amber_rounded,
                  RetivoxTheme.accent,
                ),
                metric(
                  'Out of stock',
                  '$outOfStockCount',
                  Icons.inventory_2_outlined,
                  RetivoxTheme.danger,
                ),
                metric(
                  'Branches with alerts',
                  '${branchesWithAlerts.length}',
                  Icons.store_outlined,
                  RetivoxTheme.accent,
                ),
              ],
            );
          },
        ),
        const SizedBox(height: 18),
        Container(
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: theme.colorScheme.outlineVariant),
            ),
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _stockBranchTab('all', 'All', primary, muted),
                for (final entry in sortedBranches)
                  _stockBranchTab(entry.key, entry.value, primary, muted),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        RetivoxCard(
          padding: RetivoxCardPadding.none,
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              headingRowHeight: 46,
              dataRowMinHeight: 60,
              dataRowMaxHeight: 76,
              columnSpacing: 22,
              columns: const [
                DataColumn(label: Text('Product')),
                DataColumn(label: Text('SKU')),
                DataColumn(label: Text('Branch')),
                DataColumn(label: Text('On hand')),
                DataColumn(label: Text('Reserved')),
                DataColumn(label: Text('Threshold')),
                DataColumn(label: Text('Status')),
                DataColumn(label: Text('Action')),
              ],
              rows: filteredRows.map((row) {
                final product = _nested(row['products']);
                final branch = _nested(row['branches']);
                final quantity = _number(
                  row['base_quantity_on_hand'] ?? row['quantity_on_hand'],
                );
                final reserved = _number(
                  row['base_quantity_reserved'] ?? row['quantity_reserved'],
                );
                final threshold = _number(row['low_stock_threshold']);
                final thresholdBase = _stockThresholdBase(row);
                final status = quantity == 0
                    ? ('Out of stock', RetivoxBadgeVariant.danger)
                    : quantity <= (thresholdBase < 5 ? thresholdBase : 5)
                    ? ('Critical', RetivoxBadgeVariant.danger)
                    : quantity <= thresholdBase
                    ? ('Low stock', RetivoxBadgeVariant.warning)
                    : ('Healthy', RetivoxBadgeVariant.success);
                final onHandDisplay = _stockReceivingQuantity(
                  row,
                  quantity,
                  'remaining',
                );
                final reservedDisplay = _stockReceivingQuantity(
                  row,
                  reserved,
                  'reserved',
                  showZero: true,
                );
                final thresholdDisplay = _stockThresholdDisplay(row, threshold);
                return DataRow(
                  cells: [
                    DataCell(
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            product?['name']?.toString() ?? '-',
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          if (row['is_pending_sync'] == true)
                            const Text(
                              'Waiting to sync',
                              style: TextStyle(fontSize: 11),
                            ),
                        ],
                      ),
                    ),
                    DataCell(
                      Text(
                        product?['sku']?.toString() ?? '-',
                        style: TextStyle(color: muted),
                      ),
                    ),
                    DataCell(Text(branch?['name']?.toString() ?? '-')),
                    DataCell(_stockQuantityCell(onHandDisplay, strong: true)),
                    DataCell(_stockQuantityCell(reservedDisplay)),
                    DataCell(_stockQuantityCell(thresholdDisplay)),
                    DataCell(
                      RetivoxBadge(
                        label: status.$1,
                        variant: status.$2,
                        size: RetivoxBadgeSize.sm,
                      ),
                    ),
                    DataCell(
                      Wrap(
                        spacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          OutlinedButton(
                            onPressed: () => _editStockThreshold(row),
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 8,
                              ),
                              visualDensity: VisualDensity.compact,
                            ),
                            child: const Text('Set threshold'),
                          ),
                          IconButton(
                            tooltip: 'Add stock (saved offline if needed)',
                            onPressed: () =>
                                _adjustStock(row, operation: 'add'),
                            visualDensity: VisualDensity.compact,
                            icon: const Icon(Icons.add_box_outlined, size: 19),
                          ),
                          IconButton(
                            tooltip: 'Remove stock (saved offline if needed)',
                            onPressed: () =>
                                _adjustStock(row, operation: 'remove'),
                            visualDensity: VisualDensity.compact,
                            icon: const Icon(
                              Icons.indeterminate_check_box_outlined,
                              size: 19,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                );
              }).toList(),
            ),
          ),
        ),
        if (filteredRows.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 14),
            child: Text(
              'No stock records found.',
              textAlign: TextAlign.center,
              style: TextStyle(color: muted),
            ),
          ),
      ],
    );
  }

  Widget _stockBranchTab(String id, String label, Color primary, Color muted) {
    final selected = _stockBranch == id;
    return TextButton(
      onPressed: () => setState(() => _stockBranch = id),
      style: TextButton.styleFrom(
        foregroundColor: selected ? primary : muted,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
        side: BorderSide.none,
      ),
      child: Container(
        padding: const EdgeInsets.only(bottom: 2),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: selected ? primary : Colors.transparent,
              width: 2,
            ),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
          ),
        ),
      ),
    );
  }

  Widget _stockQuantityCell((String, String?) display, {bool strong = false}) =>
      Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            display.$1,
            style: TextStyle(
              fontWeight: strong ? FontWeight.w700 : FontWeight.w600,
            ),
          ),
          if (display.$2 != null)
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Text(
                display.$2!,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                  fontSize: 11,
                ),
              ),
            ),
        ],
      );

  List<Map<String, dynamic>> _stockUoms(Map<String, dynamic> row) =>
      row['uom_options'] is List
      ? (row['uom_options'] as List)
            .whereType<Map>()
            .map(Map<String, dynamic>.from)
            .toList()
      : const [];

  Map<String, dynamic>? _stockBaseUom(Map<String, dynamic> row) {
    final uoms = _stockUoms(row);
    for (final uom in uoms) {
      if (uom['is_base_uom'] == true ||
          uom['is_base_unit'] == true ||
          _number(uom['conversion_factor']) == 1)
        return uom;
    }
    return uoms.isEmpty ? null : uoms.first;
  }

  Map<String, dynamic>? _stockReceivingUom(Map<String, dynamic> row) {
    final uoms = _stockUoms(row);
    final purchase = uoms
        .where((uom) => uom['is_purchase_uom'] == true)
        .toList();
    for (final uom in purchase) {
      if (uom['is_default_purchase_uom'] == true) return uom;
    }
    purchase.sort(
      (a, b) =>
          _number(b['conversion_factor'])
              .compareTo(_number(a['conversion_factor'])),
    );
    return purchase.isEmpty ? _stockBaseUom(row) : purchase.first;
  }

  double _stockThresholdBase(Map<String, dynamic> row) =>
      _number(row['low_stock_threshold']) *
      _number(_stockReceivingUom(row)?['conversion_factor'] ?? 1);

  (String, String?) _stockReceivingQuantity(
    Map<String, dynamic> row,
    double baseQuantity,
    String suffix, {
    bool showZero = false,
  }) {
    final receiving = _stockReceivingUom(row);
    final base = _stockBaseUom(row);
    final factor = _number(receiving?['conversion_factor'] ?? 1);
    final baseName =
        base?['name']?.toString() ?? receiving?['name']?.toString() ?? 'units';
    final formattedBase = NumberFormat('#,##0.####').format(baseQuantity);
    if (receiving == null || base == null || factor <= 1)
      return ('$formattedBase $baseName $suffix', null);
    final receivingCount = (baseQuantity / factor).floor();
    final remainder = (baseQuantity - receivingCount * factor);
    if (receivingCount <= 0 && !showZero)
      return ('$formattedBase $baseName $suffix', null);
    final remainderText = remainder > 0 || showZero
        ? ' and ${NumberFormat('#,##0.####').format(remainder)} $baseName'
        : '';
    return (
      '$receivingCount ${receiving['name']}$remainderText $suffix',
      '($formattedBase $baseName)',
    );
  }

  (String, String?) _stockThresholdDisplay(
    Map<String, dynamic> row,
    double threshold,
  ) {
    final receiving = _stockReceivingUom(row);
    final base = _stockBaseUom(row);
    final factor = _number(receiving?['conversion_factor'] ?? 1);
    final formatted = NumberFormat('#,##0.####').format(threshold);
    if (receiving == null || base == null) return (formatted, null);
    final secondary = factor == 1
        ? null
        : '(${NumberFormat('#,##0.####').format(threshold * factor)} ${base['name']})';
    return ('$formatted ${receiving['name']}', secondary);
  }

  Future<void> _adjustStock(
    Map<String, dynamic> row, {
    required String operation,
  }) async {
    final controller = TextEditingController();
    String? error;
    var saving = false;
    try {
      final pendingSync = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: Text(operation == 'add' ? 'Add stock' : 'Remove stock'),
            content: SizedBox(
              width: 360,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '${_nested(row['products'])?['name'] ?? 'Product'} · '
                    '${_nested(row['branches'])?['name'] ?? 'Branch'}',
                  ),
                  TextField(
                    controller: controller,
                    enabled: !saving,
                    autofocus: true,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Whole base units',
                    ),
                  ),
                  if (error != null)
                    Text(
                      error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
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
                        final stockId = row['id']?.toString();
                        final quantity = int.tryParse(controller.text.trim());
                        if (stockId == null ||
                            quantity == null ||
                            quantity <= 0) {
                          setDialogState(
                            () => error =
                                'Enter a whole quantity greater than zero.',
                          );
                          return;
                        }
                        setDialogState(() {
                          saving = true;
                          error = null;
                        });
                        try {
                          final pending = await widget.repository.adjustStock(
                            widget.user,
                            stockId: stockId,
                            quantity: quantity,
                            operation: operation,
                          );
                          if (!dialogContext.mounted) return;
                          Navigator.pop(dialogContext, pending);
                          _refresh();
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
                    : Text(operation == 'add' ? 'Add stock' : 'Remove stock'),
              ),
            ],
          ),
        ),
      );
      if (pendingSync != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              pendingSync
                  ? 'Stock adjustment saved offline and queued to sync.'
                  : 'Stock adjustment saved.',
            ),
          ),
        );
      }
    } finally {
      controller.dispose();
    }
  }

  Future<void> _editStockThreshold(Map<String, dynamic> row) async {
    final controller = TextEditingController(
      text: _quantity(_number(row['low_stock_threshold'])),
    );
    try {
      final saved = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Low-stock threshold'),
          content: TextField(
            controller: controller,
            autofocus: true,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Threshold in receiving units',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Save threshold'),
            ),
          ],
        ),
      );
      if (saved != true) return;
      final threshold = int.tryParse(controller.text.trim());
      final stockId = row['id']?.toString();
      final branchId = row['branch_id']?.toString();
      if (threshold == null ||
          threshold < 0 ||
          stockId == null ||
          branchId == null) {
        throw const FormatException(
          'Enter a non-negative whole-number threshold.',
        );
      }
      final pendingSync = await widget.repository.updateStockThreshold(
        widget.user,
        stockId: stockId,
        branchId: branchId,
        threshold: threshold,
      );
      _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              pendingSync
                  ? 'Threshold saved offline and queued to sync.'
                  : 'Stock threshold updated.',
            ),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not update stock threshold: $error')),
        );
      }
    } finally {
      controller.dispose();
    }
  }

  Widget _productsTable(
    List<Map<String, dynamic>> rows, {
    List<Map<String, dynamic>> allProducts = const [],
  }) {
    final canManage = widget.user.role == RetivoxRole.owner;
    final showStock = widget.user.role != RetivoxRole.employee;
    List<Map<String, dynamic>> rowsOf(Object? value) => value is List
        ? value.whereType<Map>().map(Map<String, dynamic>.from).toList()
        : const [];
    final currency = NumberFormat.currency(
      name: widget.user.currency,
      symbol: widget.user.currency,
      decimalDigits: 2,
    );
    return RetivoxCard(
      padding: RetivoxCardPadding.none,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minWidth: 1120),
          child: DataTable(
            headingRowHeight: 48,
            dataRowMinHeight: 68,
            dataRowMaxHeight: 100,
            columnSpacing: 18,
            horizontalMargin: 18,
            columns: [
              const DataColumn(label: Text('Name')),
              const DataColumn(label: Text('SKU')),
              const DataColumn(label: Text('Category')),
              const DataColumn(label: Text('UOMs')),
              const DataColumn(label: Text('Product type')),
              const DataColumn(label: Text('Pricing')),
              const DataColumn(label: Text('Base price')),
              if (showStock)
                const DataColumn(label: Text('Assigned branch stock')),
              const DataColumn(label: Text('Status')),
              DataColumn(label: Text(canManage ? 'Actions' : 'Details')),
            ],
            rows: rows.map((row) {
              final active = row['is_active'] == true;
              final pricing = _nested(row['product_pricing']);
              final units = rowsOf(row['product_uom_links']);
              final models = rowsOf(row['product_pricing_models'])
                  .where(
                    (model) =>
                        model['status'] == 'approved' ||
                        model['status'] == 'pending_approval',
                  )
                  .toList();
              final uomNames = units
                  .map((link) {
                    final unit = _nested(link['units_of_measure']);
                    if (unit == null) return null;
                    final roles = <String>[
                      if (link['is_base_uom'] == true) 'Base',
                      if (link['is_default_purchase_uom'] == true)
                        'Default receive',
                      if (link['is_default_sale_uom'] == true) 'Default sale',
                    ];
                    final name = unit['abbreviation'] ?? unit['name'] ?? 'Unit';
                    return roles.isEmpty
                        ? '$name'
                        : '$name · ${roles.join(', ')}';
                  })
                  .whereType<String>()
                  .toList();
              final pricingLabels = models
                  .map((model) {
                    final method = switch (model['pricing_method']) {
                      'assisted_pack' => 'Assisted',
                      'manual_quantity' => 'Quantity',
                      _ => 'Fixed',
                    };
                    return model['branch_id'] == null
                        ? method
                        : '$method · branch';
                  })
                  .toSet()
                  .toList();
              final stockByBranch = rowsOf(row['assigned_branch_stock']);
              return DataRow(
                cells: [
                  DataCell(
                    SizedBox(
                      width: 180,
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            row['name']?.toString() ?? 'Product',
                            style: const TextStyle(fontWeight: FontWeight.w700),
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            row['brand_family']?.toString().isNotEmpty == true
                                ? row['brand_family'].toString()
                                : row['subcategory']?.toString() ??
                                      row['unit']?.toString() ??
                                      'No family set',
                            style: TextStyle(
                              color: Theme.of(context).hintColor,
                              fontSize: 12,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                          if (row['is_pending_sync'] == true)
                            const Text(
                              'Waiting to sync',
                              style: TextStyle(fontSize: 11),
                            ),
                        ],
                      ),
                    ),
                  ),
                  DataCell(Text(row['sku']?.toString() ?? '—')),
                  DataCell(Text(row['category']?.toString() ?? '—')),
                  DataCell(
                    SizedBox(
                      width: 240,
                      child: Wrap(
                        spacing: 4,
                        runSpacing: 3,
                        children: uomNames.isEmpty
                            ? [const Text('—')]
                            : uomNames
                                  .take(3)
                                  .map(
                                    (name) => Chip(
                                      label: Text(name),
                                      visualDensity: VisualDensity.compact,
                                      materialTapTargetSize:
                                          MaterialTapTargetSize.shrinkWrap,
                                    ),
                                  )
                                  .toList(),
                      ),
                    ),
                  ),
                  DataCell(
                    Text(
                      row['product_kind'] == 'measured_counted'
                          ? 'Measured / counted'
                          : 'Fixed package',
                    ),
                  ),
                  DataCell(
                    SizedBox(
                      width: 130,
                      child: Wrap(
                        spacing: 4,
                        runSpacing: 3,
                        children: pricingLabels.isEmpty
                            ? [const Text('—')]
                            : pricingLabels
                                  .map(
                                    (label) => Chip(
                                      label: Text(label),
                                      visualDensity: VisualDensity.compact,
                                      materialTapTargetSize:
                                          MaterialTapTargetSize.shrinkWrap,
                                    ),
                                  )
                                  .toList(),
                      ),
                    ),
                  ),
                  DataCell(
                    Text(
                      pricing?['base_price'] == null
                          ? '—'
                          : currency.format(_number(pricing?['base_price'])),
                    ),
                  ),
                  if (showStock)
                    DataCell(
                      SizedBox(
                        width: 240,
                        child: Wrap(
                          spacing: 4,
                          runSpacing: 3,
                          children: <Widget>[
                            if (stockByBranch.isEmpty)
                              const Text('No stock in assigned branches'),
                            for (final stock in stockByBranch.take(2))
                              Chip(
                                label: Text(
                                  '${_nested(stock['branches'])?['name'] ?? 'Branch'}: ${stock['quantity_on_hand'] ?? 0}',
                                ),
                                visualDensity: VisualDensity.compact,
                                materialTapTargetSize:
                                    MaterialTapTargetSize.shrinkWrap,
                              ),
                            if (stockByBranch.length > 2)
                              Chip(
                                label: Text('+${stockByBranch.length - 2}'),
                                visualDensity: VisualDensity.compact,
                                materialTapTargetSize:
                                    MaterialTapTargetSize.shrinkWrap,
                              ),
                          ],
                        ),
                      ),
                    ),
                  DataCell(
                    RetivoxBadge(
                      variant: active
                          ? RetivoxBadgeVariant.success
                          : RetivoxBadgeVariant.muted,
                      label: active ? 'Active' : 'Inactive',
                      size: RetivoxBadgeSize.sm,
                    ),
                  ),
                  DataCell(
                    SizedBox(
                      width: canManage ? 210 : 125,
                      child: Wrap(
                        spacing: 4,
                        runSpacing: 4,
                        children: [
                          OutlinedButton(
                            onPressed: () => _showProductDetails(row),
                            style: OutlinedButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                            ),
                            child: const Text('See more'),
                          ),
                          if (canManage) ...[
                            OutlinedButton.icon(
                              onPressed: () => _openProductForm(
                                product: row,
                                existingProducts: allProducts,
                              ),
                              icon: const Icon(Icons.edit_outlined, size: 16),
                              label: const Text('Edit'),
                              style: OutlinedButton.styleFrom(
                                visualDensity: VisualDensity.compact,
                              ),
                            ),
                            OutlinedButton(
                              onPressed: () => _toggleProduct(row, !active),
                              style: OutlinedButton.styleFrom(
                                visualDensity: VisualDensity.compact,
                              ),
                              child: Text(active ? 'Deactivate' : 'Activate'),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ],
              );
            }).toList(),
          ),
        ),
      ),
    );
  }

  void _showProductDetails(Map<String, dynamic> product) {
    final showStock = widget.user.role != RetivoxRole.employee;
    final pricing = _nested(product['product_pricing']);
    final units = (product['product_uom_links'] as List? ?? const [])
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .toList();
    final models = (product['product_pricing_models'] as List? ?? const [])
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .where(
          (model) =>
              model['status'] == 'approved' ||
              model['status'] == 'pending_approval',
        )
        .toList();
    final stock = (product['assigned_branch_stock'] as List? ?? const [])
        .whereType<Map>()
        .map(Map<String, dynamic>.from)
        .toList();
    final currency = NumberFormat.currency(
      name: widget.user.currency,
      symbol: widget.user.currency,
      decimalDigits: 2,
    );
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(product['name']?.toString() ?? 'Product details'),
        content: SizedBox(
          width: 760,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _productDetailGroup('Product details', [
                  'SKU: ${product['sku'] ?? '—'}',
                  'Category: ${product['category'] ?? '—'}',
                  'Subcategory: ${product['subcategory'] ?? '—'}',
                  'Brand/family: ${product['brand_family'] ?? '—'}',
                  'Type: ${product['product_kind'] == 'measured_counted' ? 'Measured / counted' : 'Fixed package'}',
                  'Description: ${product['description'] ?? '—'}',
                ]),
                _productDetailGroup(
                  'Barcodes',
                  (product['barcodes'] as List? ?? const [])
                      .map((code) => code.toString())
                      .toList(),
                ),
                _productDetailGroup('Pricing', [
                  'Base price: ${pricing?['base_price'] == null ? '—' : currency.format(_number(pricing?['base_price']))}',
                  'Minimum price: ${pricing?['min_price'] == null ? '—' : currency.format(_number(pricing?['min_price']))}',
                  'Maximum price: ${pricing?['max_price'] == null ? '—' : currency.format(_number(pricing?['max_price']))}',
                  ...models.map(
                    (model) =>
                        'Pricing method: ${model['pricing_method'] ?? 'Fixed'}${model['branch_id'] == null ? ' · all branches' : ' · selected branch'}',
                  ),
                ]),
                _productDetailGroup(
                  'Units of measure',
                  units.map((link) {
                    final unit = _nested(link['units_of_measure']);
                    final roles = <String>[
                      if (link['is_base_uom'] == true) 'base',
                      if (link['is_purchase_uom'] == true) 'purchase',
                      if (link['is_sale_uom'] == true) 'sale',
                      if (link['is_default_purchase_uom'] == true)
                        'default purchase',
                      if (link['is_default_sale_uom'] == true) 'default sale',
                    ];
                    return '${unit?['name'] ?? 'Unit'} (${unit?['abbreviation'] ?? ''}) · ${unit?['conversion_factor'] ?? '—'} base units · ${roles.join(', ')}';
                  }).toList(),
                ),
                if (showStock)
                  _productDetailGroup(
                    'Assigned branch stock',
                    stock.map((row) {
                      final branch = _nested(row['branches']);
                      return '${branch?['name'] ?? 'Branch'}: ${row['quantity_on_hand'] ?? 0} ${product['unit'] ?? 'units'}';
                    }).toList(),
                  ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Widget _productDetailGroup(String title, List<String> values) => Card(
    margin: const EdgeInsets.only(bottom: 10),
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          if (values.isEmpty)
            const Text('None recorded')
          else
            for (final value in values)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(value),
              ),
        ],
      ),
    ),
  );

  Future<void> _toggleProduct(
    Map<String, dynamic> product,
    bool isActive,
  ) async {
    final productId = product['id']?.toString();
    if (productId == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(isActive ? 'Activate product?' : 'Deactivate product?'),
        content: Text(
          '${product['name'] ?? 'This product'} will be ${isActive ? 'available' : 'unavailable'} for new sales.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(isActive ? 'Activate' : 'Deactivate'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final pendingSync = await widget.repository.setProductActive(
        widget.user,
        productId: productId,
        isActive: isActive,
      );
      _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              pendingSync
                  ? 'Product status saved offline and queued to sync.'
                  : 'Product status updated.',
            ),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not update product status: $error')),
        );
      }
    }
  }

  Widget _transactionsTable(List<Map<String, dynamic>> rows) {
    final currency = NumberFormat.currency(name: widget.user.currency);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          showCheckboxColumn: false,
          columns: const [
            DataColumn(label: Text('Time')),
            DataColumn(label: Text('Branch')),
            DataColumn(label: Text('Recorded by')),
            DataColumn(label: Text('Items')),
            DataColumn(label: Text('Amount')),
            DataColumn(label: Text('Payment method')),
            DataColumn(label: Text('Status')),
          ],
          rows: rows.map((row) {
            final branchId = row['branch_id']?.toString();
            final branch = widget.user.branches
                .where((item) => item.id == branchId)
                .firstOrNull;
            final date = DateTime.tryParse(
              row['recorded_at']?.toString() ?? '',
            );
            final items = row['items'] is List
                ? (row['items'] as List)
                      .whereType<Map<String, dynamic>>()
                      .toList()
                : const <Map<String, dynamic>>[];
            final payments = row['payments'] is List
                ? (row['payments'] as List)
                      .whereType<Map<String, dynamic>>()
                      .toList()
                : const <Map<String, dynamic>>[];
            final primaryPayment = payments.firstOrNull;
            final itemSummary = items.take(2).map((item) {
              final product = _nested(item['products']);
              final uom = _nested(item['units_of_measure']);
              final productName = product?['name']?.toString() ?? 'Product';
              final recovery = item['recovery_item_id'] != null;
              final quantity =
                  item['quantity_in_uom'] ?? item['quantity'] ?? '—';
              final unit = uom?['abbreviation'] ?? uom?['name'];
              return '${recovery ? 'Damaged: ' : ''}$productName · $quantity${unit == null ? '' : ' $unit'}';
            }).toList();
            if (items.length > 2) itemSummary.add('+${items.length - 2} more');
            return DataRow(
              onSelectChanged: (_) => showDialog<void>(
                context: context,
                builder: (context) => _TransactionDetailsDialog(
                  transaction: row,
                  currency: currency,
                  date: date,
                  user: widget.user,
                  repository: widget.repository,
                  onChanged: _refresh,
                ),
              ),
              cells: [
                DataCell(
                  Text(date?.toLocal().toString().substring(0, 16) ?? '—'),
                ),
                DataCell(Text(branch?.name ?? 'Branch')),
                DataCell(
                  Text(row['employee_name']?.toString() ?? 'Team member'),
                ),
                DataCell(
                  SizedBox(
                    width: 260,
                    child: Text(
                      itemSummary.isEmpty
                          ? 'No item details'
                          : itemSummary.join('\n'),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
                DataCell(
                  SizedBox(
                    width: 160,
                    child: Text(
                      '${currency.format(_number(row['total_amount']))}'
                      '${_number(row['discount_amount']) > 0 ? '\nDiscount ${currency.format(_number(row['discount_amount']))}' : ''}',
                    ),
                  ),
                ),
                DataCell(
                  Text(
                    _paymentMethod(
                      primaryPayment?['payment_method']?.toString(),
                    ),
                  ),
                ),
                DataCell(Text(row['status']?.toString() ?? '—')),
              ],
            );
          }).toList(),
        ),
      ),
    );
  }

  String _paymentMethod(String? value) => switch (value) {
    'mpesa_stk' => 'M-Pesa STK',
    'mpesa_manual' => 'M-Pesa manual',
    'cash' => 'Cash',
    'card' => 'Card',
    null => 'No payment',
    _ => value,
  };

  Widget _employeesTable(List<Map<String, dynamic>> rows) {
    final normalized = rows.map((row) {
      final joinedUser = _nested(row['users']);
      final user = joinedUser ?? row;
      final branch = _nested(row['branches']);
      return [
        user['name']?.toString() ?? 'Team member',
        user['email']?.toString() ?? '—',
        user['phone']?.toString() ?? '—',
        user['global_role']?.toString() ?? row['role']?.toString() ?? '—',
        user['is_active'] == true ? 'Active' : 'Inactive',
        branch?['name']?.toString() ?? 'All assigned branches',
      ];
    }).toList();
    return _DataTableCard(
      columns: const ['Name', 'Email', 'Phone', 'Role', 'Account', 'Branch'],
      rows: normalized,
    );
  }

  Widget _suppliersTable(List<Map<String, dynamic>> rows) {
    final canManage = widget.user.role != RetivoxRole.employee;
    if (rows.isEmpty) {
      return const Card(
        child: ListTile(
          leading: Icon(Icons.business_outlined),
          title: Text('No suppliers found'),
          subtitle: Text('Suppliers saved to this business will appear here.'),
        ),
      );
    }
    return Column(
      children: [
        for (final row in rows)
          Card(
            margin: const EdgeInsets.only(bottom: 10),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          row['name']?.toString().trim().isNotEmpty == true
                              ? row['name'].toString()
                              : 'Unnamed supplier',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                      const SizedBox(width: 8),
                      RetivoxBadge(
                        label: row['is_pending_sync'] == true
                            ? 'Waiting to sync'
                            : row['is_active'] == true
                            ? 'Active'
                            : 'Inactive',
                        variant: row['is_active'] == true
                            ? RetivoxBadgeVariant.success
                            : RetivoxBadgeVariant.muted,
                        size: RetivoxBadgeSize.sm,
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 18,
                    runSpacing: 8,
                    children: [
                      _supplierDetail(
                        Icons.person_outline,
                        'Contact',
                        row['contact_person'],
                      ),
                      _supplierDetail(
                        Icons.phone_outlined,
                        'Phone',
                        row['phone'],
                      ),
                      _supplierDetail(
                        Icons.email_outlined,
                        'Email',
                        row['email'],
                      ),
                      if ((row['notes']?.toString().trim() ?? '').isNotEmpty)
                        _supplierDetail(
                          Icons.notes_outlined,
                          'Notes',
                          row['notes'],
                        ),
                    ],
                  ),
                  if (row['sync_error'] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        'Supplier change needs attention: ${row['sync_error']}',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  if (canManage) ...[
                    const SizedBox(height: 10),
                    const Divider(height: 1),
                    Align(
                      alignment: Alignment.centerRight,
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          OutlinedButton.icon(
                            onPressed: () => _editSupplier(row: row),
                            icon: const Icon(Icons.edit_outlined, size: 18),
                            label: const Text('Edit supplier'),
                          ),
                          TextButton.icon(
                            onPressed: row['id'] == null
                                ? null
                                : () => _saveSupplier(
                                    row: row,
                                    isActive: row['is_active'] != true,
                                  ),
                            icon: Icon(
                              row['is_active'] == true
                                  ? Icons.pause_circle_outline
                                  : Icons.play_circle_outline,
                              size: 18,
                            ),
                            label: Text(
                              row['is_active'] == true
                                  ? 'Deactivate'
                                  : 'Activate',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _supplierDetail(IconData icon, String label, Object? rawValue) {
    final value = rawValue?.toString().trim() ?? '';
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 360),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 17,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              value.isEmpty ? '$label not provided' : '$label: $value',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _editSupplier({Map<String, dynamic>? row}) async {
    final name = TextEditingController(text: row?['name']?.toString() ?? '');
    final contact = TextEditingController(
      text: row?['contact_person']?.toString() ?? '',
    );
    final phone = TextEditingController(text: row?['phone']?.toString() ?? '');
    final email = TextEditingController(text: row?['email']?.toString() ?? '');
    final notes = TextEditingController(text: row?['notes']?.toString() ?? '');
    var saving = false;
    String? error;
    try {
      final pendingSync = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: Text(row == null ? 'Add supplier' : 'Edit supplier'),
            content: SizedBox(
              width: 440,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: name,
                      enabled: !saving,
                      maxLength: 120,
                      decoration: const InputDecoration(labelText: 'Name'),
                    ),
                    TextField(
                      controller: contact,
                      enabled: !saving,
                      maxLength: 120,
                      decoration: const InputDecoration(
                        labelText: 'Contact person',
                      ),
                    ),
                    TextField(
                      controller: phone,
                      enabled: !saving,
                      maxLength: 40,
                      decoration: const InputDecoration(labelText: 'Phone'),
                    ),
                    TextField(
                      controller: email,
                      enabled: !saving,
                      decoration: const InputDecoration(labelText: 'Email'),
                    ),
                    TextField(
                      controller: notes,
                      enabled: !saving,
                      maxLength: 240,
                      maxLines: 2,
                      decoration: const InputDecoration(labelText: 'Notes'),
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
                        setDialogState(() {
                          saving = true;
                          error = null;
                        });
                        try {
                          final queued = await widget.repository.saveSupplier(
                            widget.user,
                            supplierId: row?['id']?.toString(),
                            name: name.text,
                            phone: phone.text,
                            email: email.text,
                            contactPerson: contact.text,
                            notes: notes.text,
                            isActive: row?['is_active'] != false,
                          );
                          if (!dialogContext.mounted) return;
                          Navigator.pop(dialogContext, queued);
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
                    : const Text('Save supplier'),
              ),
            ],
          ),
        ),
      );
      if (pendingSync != null && mounted) {
        _refresh();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              pendingSync
                  ? 'Supplier saved offline and queued to sync.'
                  : 'Supplier saved.',
            ),
          ),
        );
      }
    } finally {
      name.dispose();
      contact.dispose();
      phone.dispose();
      email.dispose();
      notes.dispose();
    }
  }

  Future<void> _saveSupplier({
    required Map<String, dynamic> row,
    required bool isActive,
  }) async {
    try {
      final pendingSync = await widget.repository.saveSupplier(
        widget.user,
        supplierId: row['id']?.toString(),
        name: row['name']?.toString() ?? '',
        phone: row['phone']?.toString() ?? '',
        email: row['email']?.toString() ?? '',
        contactPerson: row['contact_person']?.toString() ?? '',
        notes: row['notes']?.toString() ?? '',
        isActive: isActive,
      );
      _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              pendingSync
                  ? 'Supplier change saved offline and queued to sync.'
                  : 'Supplier ${isActive ? 'activated' : 'deactivated'}.',
            ),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Supplier update failed: $error')),
        );
      }
    }
  }

  Widget _damagesTable(List<Map<String, dynamic>> rows) {
    final employee = widget.user.role == RetivoxRole.employee;
    return _DataTableCard(
      columns: [
        'Date',
        if (!employee) 'Branch',
        'Product',
        'Quantity',
        'Type',
        'Status',
        'Reason',
      ],
      rows: rows.map((row) {
        final date = DateTime.tryParse(row['created_at']?.toString() ?? '');
        return [
          date?.toLocal().toString().substring(0, 16) ?? '—',
          if (!employee) row['branch_name']?.toString() ?? '—',
          '${row['product_name'] ?? 'Product'}'
              '${row['sku'] == null ? '' : ' · ${row['sku']}'}',
          '${row['quantity_in_uom'] ?? '—'} ${row['uom_name'] ?? ''}'
              '${row['base_quantity'] == null ? '' : ' (${row['base_quantity']} base)'}',
          (row['loss_type']?.toString() ?? '—').replaceAll('_', ' '),
          row['status']?.toString() ?? '—',
          '${row['reason'] ?? '—'}'
              '${row['review_note'] == null ? '' : '\nReview: ${row['review_note']}'}',
        ];
      }).toList(),
    );
  }

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
    final parsed = double.tryParse(value?.toString() ?? '');
    return parsed == null || !parsed.isFinite ? 0 : parsed;
  }

  String _quantity(double value) => value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toStringAsFixed(2);
}

class _BranchDetailsDialog extends StatefulWidget {
  const _BranchDetailsDialog({
    required this.user,
    required this.repository,
    required this.branch,
  });

  final RetivoxUser user;
  final DashboardRepository repository;
  final Map<String, dynamic> branch;

  @override
  State<_BranchDetailsDialog> createState() => _BranchDetailsDialogState();
}

class _BranchDetailsDialogState extends State<_BranchDetailsDialog> {
  Map<String, dynamic>? _details;
  String? _error;
  bool _loading = true;
  final _currency = NumberFormat('#,##0.00');

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final details = await widget.repository.loadBranchDetails(
        widget.user,
        widget.branch['id'].toString(),
      );
      if (mounted) setState(() => _details = details);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Map<String, dynamic>? _map(Object? value) =>
      value is Map ? Map<String, dynamic>.from(value) : null;

  List<Map<String, dynamic>> _rows(Object? value) => value is List
      ? value.whereType<Map>().map(Map<String, dynamic>.from).toList()
      : const [];

  String _money(Object? value) =>
      '${widget.user.currency} ${_currency.format(double.tryParse(value?.toString() ?? '') ?? 0)}';

  Widget _metric(String label, String value) => SizedBox(
    width: 190,
    child: Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 6),
            Text(value, style: Theme.of(context).textTheme.titleMedium),
          ],
        ),
      ),
    ),
  );

  Widget _itemCard(String title, Map<String, dynamic>? item) => Card(
    child: ListTile(
      leading: const Icon(Icons.inventory_2_outlined),
      title: Text(title),
      subtitle: Text(
        item == null
            ? 'No item sales recorded today.'
            : '${item['name'] ?? 'Item'} · ${item['quantity'] ?? 0} sold',
      ),
      trailing: item == null ? null : Text(_money(item['sales'])),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final details = _details;
    final team = _rows(details?['team']);
    final employees = team.where((person) => person['role'] == 'employee');
    final admins = team.where((person) => person['role'] == 'admin');
    final bestEmployee = _map(details?['bestEmployee']);
    return AlertDialog(
      title: Text(
        details?['name']?.toString() ??
            widget.branch['name']?.toString() ??
            'Store details',
      ),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 760, maxHeight: 680),
        child: SingleChildScrollView(
          child: _loading && details == null
              ? const SizedBox(
                  height: 180,
                  child: Center(child: CircularProgressIndicator()),
                )
              : details == null
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_error ?? 'Store details are unavailable.'),
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: _load,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Try again'),
                    ),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      '${details['location'] ?? 'Location not set'} · '
                      '${details['branchType'] ?? details['branch_type'] ?? 'Store'} · '
                      '${details['isActive'] == false ? 'Inactive' : 'Active'}',
                    ),
                    if (details['isCached'] == true)
                      const Padding(
                        padding: EdgeInsets.only(top: 8),
                        child: Text(
                          'Showing the latest saved store details (offline).',
                        ),
                      ),
                    if (details['updatedAt'] != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          'Updated ${_branchDetailsTime(details['updatedAt'])}',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                    if (details['isPendingSync'] == true)
                      const Padding(
                        padding: EdgeInsets.only(top: 8),
                        child: Text(
                          'This store is saved locally and waiting to sync.',
                        ),
                      ),
                    if (_error != null && details['isCached'] != true)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(_error!),
                      ),
                    const SizedBox(height: 14),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        _metric('Total profit', _money(details['totalProfit'])),
                        _metric('Sales today', _money(details['totalSales'])),
                        _metric(
                          'Transactions today',
                          '${details['transactionCount'] ?? 0}',
                        ),
                        _metric(
                          'Employees',
                          '${details['employeeCount'] ?? employees.length}',
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    _itemCard(
                      'Best-selling item today',
                      _map(details['bestSellingItem']),
                    ),
                    _itemCard(
                      'Lowest-selling item today',
                      _map(details['worstSellingItem']),
                    ),
                    Card(
                      child: ListTile(
                        leading: const Icon(Icons.emoji_events_outlined),
                        title: const Text('Best-performing employee today'),
                        subtitle: Text(
                          bestEmployee?['name']?.toString() ??
                              'No employee sales recorded today.',
                        ),
                        trailing: bestEmployee == null
                            ? null
                            : Text(_money(bestEmployee['sales'])),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      'Employees and contacts',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (employees.isEmpty)
                      const ListTile(
                        title: Text('No active employees assigned.'),
                      )
                    else
                      for (final person in employees)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(
                            child: Icon(Icons.person_outline),
                          ),
                          title: Text(person['name']?.toString() ?? 'Employee'),
                          subtitle: Text(
                            [
                                  person['phone']?.toString(),
                                  person['email']?.toString(),
                                ]
                                .whereType<String>()
                                .where((value) => value.isNotEmpty)
                                .join(' · '),
                          ),
                        ),
                    const SizedBox(height: 8),
                    Text(
                      'Assigned admins',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (admins.isEmpty)
                      const ListTile(title: Text('No active admin assigned.'))
                    else
                      for (final person in admins)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(
                            child: Icon(Icons.admin_panel_settings_outlined),
                          ),
                          title: Text(person['name']?.toString() ?? 'Admin'),
                          subtitle: Text(
                            [
                                  person['phone']?.toString(),
                                  person['email']?.toString(),
                                ]
                                .whereType<String>()
                                .where((value) => value.isNotEmpty)
                                .join(' · '),
                          ),
                        ),
                  ],
                ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _loading ? null : _load,
          child: const Text('Refresh'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Close'),
        ),
      ],
    );
  }

  String _branchDetailsTime(Object? value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '');
    return parsed == null
        ? 'recently'
        : DateFormat.yMMMd().add_jm().format(parsed.toLocal());
  }
}

class _TransactionDetailsDialog extends StatefulWidget {
  const _TransactionDetailsDialog({
    required this.transaction,
    required this.currency,
    required this.date,
    required this.user,
    required this.repository,
    required this.onChanged,
  });

  final Map<String, dynamic> transaction;
  final NumberFormat currency;
  final DateTime? date;
  final RetivoxUser user;
  final DashboardRepository repository;
  final VoidCallback onChanged;

  @override
  State<_TransactionDetailsDialog> createState() =>
      _TransactionDetailsDialogState();
}

class _TransactionDetailsDialogState extends State<_TransactionDetailsDialog> {
  bool _isSaving = false;

  Future<void> _runAction({
    required String title,
    required String message,
    required Future<void> Function() action,
  }) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _isSaving = true);
    try {
      await action();
      if (!mounted) return;
      widget.onChanged();
      Navigator.of(context).pop();
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('$title completed successfully.')));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> _verifyPayment({
    required Map<String, dynamic> payment,
    required String action,
  }) async {
    final isManualMpesa = payment['payment_method'] == 'mpesa_manual';
    String? evidenceSource;
    String? evidenceNote;

    if (isManualMpesa) {
      final noteController = TextEditingController();
      var source = 'mpesa_statement';
      final evidence = await showDialog<Map<String, String>>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (context, setDialogState) => AlertDialog(
            title: Text(
              action == 'approve'
                  ? 'Verify M-PESA payment'
                  : 'Reject M-PESA payment',
            ),
            content: SizedBox(
              width: 440,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    action == 'approve'
                        ? 'Check independently that the funds reached this business. The customer reference alone is not proof of payment.'
                        : 'Record why this M-PESA reference could not be verified.',
                  ),
                  if (action == 'approve') ...[
                    const SizedBox(height: 16),
                    DropdownButtonFormField<String>(
                      initialValue: source,
                      decoration: const InputDecoration(
                        labelText: 'Evidence source',
                      ),
                      items: const [
                        DropdownMenuItem(
                          value: 'mpesa_statement',
                          child: Text('M-PESA statement'),
                        ),
                        DropdownMenuItem(
                          value: 'merchant_portal',
                          child: Text('Merchant portal'),
                        ),
                        DropdownMenuItem(
                          value: 'provider_callback',
                          child: Text('Verified provider callback'),
                        ),
                        DropdownMenuItem(
                          value: 'other_evidence',
                          child: Text('Other independent evidence'),
                        ),
                      ],
                      onChanged: (value) {
                        if (value != null) setDialogState(() => source = value);
                      },
                    ),
                  ],
                  const SizedBox(height: 12),
                  TextField(
                    controller: noteController,
                    minLines: 3,
                    maxLines: 5,
                    maxLength: 1000,
                    decoration: InputDecoration(
                      labelText: action == 'approve'
                          ? 'Evidence checked'
                          : 'Rejection reason',
                      hintText: action == 'approve'
                          ? 'Describe how you confirmed receipt of funds.'
                          : 'Explain why the reference was not confirmed.',
                      border: const OutlineInputBorder(),
                    ),
                    onChanged: (_) => setDialogState(() {}),
                  ),
                  if (noteController.text.trim().length < 10)
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        'Enter at least 10 characters.',
                        style: TextStyle(color: Colors.red),
                      ),
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: noteController.text.trim().length < 10
                    ? null
                    : () => Navigator.pop(dialogContext, {
                        'source': source,
                        'note': noteController.text.trim(),
                      }),
                child: Text(
                  action == 'approve'
                      ? 'Confirm verification'
                      : 'Confirm rejection',
                ),
              ),
            ],
          ),
        ),
      );
      noteController.dispose();
      if (evidence == null || !mounted) return;
      evidenceSource = action == 'approve' ? evidence['source'] : null;
      evidenceNote = evidence['note'];
    }

    await _runAction(
      title: action == 'approve' ? 'Approve payment' : 'Reject payment',
      message: action == 'approve'
          ? 'Approve this pending payment and update the transaction status?'
          : 'Reject this pending payment? This action is recorded in the audit log.',
      action: () => widget.repository.verifyPayment(
        widget.user,
        paymentId: payment['id'].toString(),
        action: action,
        evidenceSource: evidenceSource,
        evidenceNote: evidenceNote,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final transaction = widget.transaction;
    final currency = widget.currency;
    final date = widget.date;
    final items = transaction['items'] is List
        ? (transaction['items'] as List)
              .whereType<Map<String, dynamic>>()
              .toList()
        : const <Map<String, dynamic>>[];
    final payments = transaction['payments'] is List
        ? (transaction['payments'] as List)
              .whereType<Map<String, dynamic>>()
              .toList()
        : const <Map<String, dynamic>>[];
    final theme = Theme.of(context);
    return AlertDialog(
      title: const Text('Transaction details'),
      content: SizedBox(
        width: 640,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _detail('Recorded', date?.toLocal().toString() ?? '—'),
              _detail(
                'Recorded by',
                transaction['employee_name']?.toString() ?? 'Team member',
              ),
              _detail('Status', transaction['status']?.toString() ?? '—'),
              _detail(
                'Sync status',
                transaction['sync_status']?.toString() ?? '—',
              ),
              _detail('Origin', transaction['origin']?.toString() ?? 'online'),
              _detail(
                'Subtotal',
                currency.format(_number(transaction['subtotal'])),
              ),
              _detail(
                'Discount',
                currency.format(_number(transaction['discount_amount'])),
              ),
              _detail(
                'Total',
                currency.format(_number(transaction['total_amount'])),
              ),
              const SizedBox(height: 16),
              Text('Items', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              if (items.isEmpty)
                const Text('No line-item details are available.')
              else
                for (final item in items) _item(item),
              const SizedBox(height: 16),
              Text('Payments', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              if (payments.isEmpty)
                const Text('No payment records are available.')
              else
                for (final payment in payments) ...[
                  _payment(payment),
                  if (widget.user.role == RetivoxRole.owner &&
                      payment['status'] == 'pending_verify')
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Wrap(
                        spacing: 8,
                        children: [
                          TextButton.icon(
                            onPressed: _isSaving
                                ? null
                                : () => _verifyPayment(
                                    payment: payment,
                                    action: 'approve',
                                  ),
                            icon: const Icon(Icons.check_circle_outline),
                            label: const Text('Approve payment'),
                          ),
                          TextButton.icon(
                            onPressed: _isSaving
                                ? null
                                : () => _verifyPayment(
                                    payment: payment,
                                    action: 'reject',
                                  ),
                            icon: const Icon(Icons.cancel_outlined),
                            label: const Text('Reject payment'),
                          ),
                        ],
                      ),
                    ),
                ],
              if (widget.user.role == RetivoxRole.owner &&
                  transaction['status'] != 'voided')
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: _isSaving
                        ? null
                        : () => _runAction(
                            title: 'Void transaction',
                            message: 'This will mark the transaction as voided. Continue?',
                            action: () => widget.repository.voidTransaction(
                              widget.user,
                              transaction['id'].toString(),
                            ),
                          ),
                    icon: const Icon(Icons.block_outlined),
                    label: const Text('Void transaction'),
                  ),
                ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
          child: const Text('Close'),
        ),
      ],
    );
  }

  Widget _detail(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 125, child: Text(label)),
        Expanded(child: SelectableText(value)),
      ],
    ),
  );

  Widget _item(Map<String, dynamic> item) {
    final product = _nested(item['products']);
    final unit = _nested(item['units_of_measure']);
    final quantity = item['quantity_in_uom'] ?? item['quantity'] ?? '—';
    final unitLabel = unit?['abbreviation'] ?? unit?['name'];
    final baseQuantity = item['base_quantity'];
    final quantityLabel =
        '$quantity${unitLabel == null ? '' : ' $unitLabel'}'
        '${baseQuantity == null || baseQuantity.toString() == quantity.toString() ? '' : ' ($baseQuantity base units)'}';
    final name = product?['name']?.toString() ?? 'Product';
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(
        '${item['recovery_item_id'] == null ? '' : 'Damaged: '}$name'
        '${product?['sku'] == null ? '' : ' · ${product?['sku']}'}',
      ),
      subtitle: Text(
        '$quantityLabel · ${widget.currency.format(_number(item['unit_price_at_sale']))} each'
        '${item['stock_status'] == null ? '' : ' · Stock ${item['stock_status']}'}',
      ),
      trailing: Text(widget.currency.format(_number(item['line_total']))),
    );
  }

  Widget _payment(Map<String, dynamic> payment) {
    final method = switch (payment['payment_method']?.toString()) {
      'mpesa_stk' => 'M-Pesa STK',
      'mpesa_manual' => 'M-Pesa manual',
      'cash' => 'Cash',
      'card' => 'Card',
      final value => value ?? 'Unknown',
    };
    final reference = payment['mpesa_ref_code'] ?? payment['cash_deposit_code'];
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(method),
      subtitle: Text(
        '${payment['status'] ?? 'Unknown status'}'
        '${reference == null ? '' : ' · Ref $reference'}',
      ),
      trailing: Text(widget.currency.format(_number(payment['amount']))),
    );
  }

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
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 200,
      child: RetivoxMetricCard(label: label, value: value),
    );
  }
}

class _DataTableCard extends StatelessWidget {
  const _DataTableCard({required this.columns, required this.rows});

  final List<String> columns;
  final List<List<String>> rows;

  @override
  Widget build(BuildContext context) {
    return RetivoxCard(
      padding: RetivoxCardPadding.none,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          columns: columns
              .map((column) => DataColumn(label: Text(column)))
              .toList(),
          rows: rows
              .map(
                (row) => DataRow(
                  cells: row.map((value) => DataCell(Text(value))).toList(),
                ),
              )
              .toList(),
        ),
      ),
    );
  }
}

class _ReadOnlyNotice extends StatelessWidget {
  const _ReadOnlyNotice();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: isDark ? RetivoxTheme.surfaceDark : RetivoxTheme.backgroundLight,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: isDark ? RetivoxTheme.borderDark : RetivoxTheme.borderLight,
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.info_outline,
            size: 16,
            color: isDark
                ? RetivoxTheme.textMutedDark
                : RetivoxTheme.textMutedLight,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Role-scoped actions are available where shown. Real-time updates sync with the Retivox cloud automatically.',
              style: TextStyle(
                fontSize: 12,
                color: isDark
                    ? RetivoxTheme.textMutedDark
                    : RetivoxTheme.textMutedLight,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
