import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';
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
    super.key,
  });

  final RetivoxUser user;
  final String section;
  final DashboardRepository repository;

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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Cash deposit recorded for review.')),
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
            content: SizedBox(
              width: 440,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: name,
                    enabled: !saving,
                    maxLength: 100,
                    decoration: const InputDecoration(labelText: 'Branch name'),
                  ),
                  TextField(
                    controller: location,
                    enabled: !saving,
                    decoration: const InputDecoration(labelText: 'Location'),
                  ),
                  DropdownButtonFormField<String>(
                    initialValue: branchType,
                    decoration: const InputDecoration(labelText: 'Branch type'),
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
                          await widget.repository.createBranch(
                            widget.user,
                            name: name.text,
                            location: location.text,
                            branchType: branchType,
                          );
                          if (!dialogContext.mounted) return;
                          Navigator.pop(dialogContext, true);
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
      if (saved == true && mounted) {
        _refresh();
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Branch created.')));
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
      if (saved == true && mounted) {
        _refresh();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              widget.user.role == RetivoxRole.owner
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

  Future<void> _openProductForm({Map<String, dynamic>? product}) async {
    try {
      final options = await widget.repository.loadProductOptions(
        widget.user,
        productId: product?['id']?.toString(),
      );
      if (!mounted) return;
      final saved = await showDialog<bool>(
        context: context,
        builder: (context) => ProductFormDialog(
          user: widget.user,
          repository: widget.repository,
          units: options.units,
          branches: options.branches,
          product: options.product ?? product,
        ),
      );
      if (saved == true && mounted) {
        _refresh();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              product == null ? 'Product created.' : 'Product updated.',
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
      if (approve) {
        await widget.repository.approveSupplierDelivery(widget.user, id);
      } else {
        await widget.repository.acknowledgeSupplierDelivery(widget.user, id);
      }
      if (!mounted) return;
      _refresh();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            approve ? 'Delivery approved.' : 'Delivery acknowledged.',
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
      if (saved == true && mounted) {
        _refresh();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              widget.user.role == RetivoxRole.owner
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
      await widget.repository.reviewSupplierDeliveryEdit(
        widget.user,
        requestId: requestId,
        approve: approve,
      );
      if (!mounted) return;
      _refresh();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            approve ? 'Delivery edit approved.' : 'Delivery edit rejected.',
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
  DateTimeRange? _transactionDates;
  bool _loadingMore = false;
  bool _hasMore = true;
  Timer? _filterDebounce;
  int _historyRevision = 0;

  @override
  void initState() {
    super.initState();
    _snapshot = widget.repository.loadSection(widget.user, widget.section);
  }

  String get _title => switch (widget.section) {
    'branches' => 'Branches',
    'stock' => 'Inventory',
    'products' => 'Products',
    'transactions' => 'Transactions',
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
      _hasMore = true;
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
                    onPressed: () => _openProductForm(),
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
                if (widget.section == 'transactions' &&
                    widget.user.role != RetivoxRole.employee)
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
              _records(context, _filter(result.data!.rows)),
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
      'products' => _productsTable(rows),
      'transactions' => _transactionsTable(rows),
      'employees' => _employeesTable(rows),
      'suppliers' => _suppliersTable(rows),
      'deliveries' => _deliveriesList(rows),
      'damages' => _damagesTable(rows),
      _ => const SizedBox.shrink(),
    };
  }

  Widget _deliveriesList(List<Map<String, dynamic>> rows) {
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
                          (row['status']?.toString() ?? 'unknown').replaceAll(
                            '_',
                            ' ',
                          ),
                        ),
                      ),
                    ],
                  ),
                  Text(
                    '${_nested(row['branches'])?['name'] ?? 'Branch'}'
                    ' · ${row['reference_code'] ?? 'No reference'}'
                    ' · ${_dateTime(row['created_at'])}',
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
                              'Pending delivery edit request',
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
                                    onPressed: () =>
                                        _reviewSupplierDeliveryEdit(
                                          request,
                                          approve: false,
                                        ),
                                    child: const Text('Reject'),
                                  ),
                                  FilledButton.tonal(
                                    onPressed: () =>
                                        _reviewSupplierDeliveryEdit(
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

  Widget _branchCards(List<Map<String, dynamic>> rows) {
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: rows.map((row) {
        return SizedBox(
          width: 300,
          child: Card(
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
                    title: Text(row['name']?.toString() ?? 'Branch'),
                    subtitle: Text(
                      widget.user.role == RetivoxRole.owner
                          ? '${row['location'] ?? 'Location not set'}'
                                ' · ${row['branch_type'] ?? 'Branch'}'
                          : 'Role: ${row['role'] ?? 'assigned'}',
                    ),
                    trailing: widget.user.role == RetivoxRole.owner
                        ? Chip(
                            label: Text(
                              row['is_active'] == false ? 'Inactive' : 'Active',
                            ),
                          )
                        : null,
                  ),
                  if (widget.user.role == RetivoxRole.owner)
                    Align(
                      alignment: Alignment.centerRight,
                      child: Wrap(
                        spacing: 4,
                        children: [
                          TextButton(
                            onPressed: () => _toggleBranch(row),
                            child: Text(
                              row['is_active'] == false
                                  ? 'Activate'
                                  : 'Deactivate',
                            ),
                          ),
                          TextButton.icon(
                            onPressed: () => _deleteBranch(row),
                            icon: const Icon(Icons.delete_outline, size: 18),
                            label: const Text('Delete'),
                            style: TextButton.styleFrom(
                              foregroundColor: Theme.of(context)
                                  .colorScheme
                                  .error,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _stockTable(BuildContext context, List<Map<String, dynamic>> rows) {
    final lowStockCount = rows.where((row) {
      final threshold = _number(row['low_stock_threshold']);
      final quantity = _number(
        row['base_quantity_on_hand'] ?? row['quantity_on_hand'],
      );
      return threshold > 0 && quantity <= threshold;
    }).length;
    final branchCount = rows
        .map((row) => _nested(row['branches'])?['id']?.toString())
        .whereType<String>()
        .toSet()
        .length;
    final unitsOnHand = rows.fold<double>(
      0,
      (total, row) =>
          total +
          _number(row['base_quantity_on_hand'] ?? row['quantity_on_hand']),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            _MetricCard(label: 'Stock records', value: '${rows.length}'),
            _MetricCard(label: 'Branches', value: '$branchCount'),
            _MetricCard(label: 'Low stock', value: '$lowStockCount'),
            _MetricCard(
              label: 'Units on hand',
              value: unitsOnHand.toStringAsFixed(0),
            ),
          ],
        ),
        const SizedBox(height: 18),
        Card(
          clipBehavior: Clip.antiAlias,
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              columns: [
                const DataColumn(label: Text('Product')),
                const DataColumn(label: Text('Branch')),
                const DataColumn(label: Text('On hand')),
                const DataColumn(label: Text('Reserved')),
                const DataColumn(label: Text('Threshold')),
                const DataColumn(label: Text('Status')),
                if (widget.user.role != RetivoxRole.employee)
                  const DataColumn(label: Text('Actions')),
              ],
              rows: rows.map((row) {
                final product = _nested(row['products']);
                final branch = _nested(row['branches']);
                final quantity = _number(
                  row['base_quantity_on_hand'] ?? row['quantity_on_hand'],
                );
                final reserved = _number(
                  row['base_quantity_reserved'] ?? row['quantity_reserved'],
                );
                final threshold = _number(row['low_stock_threshold']);
                final lowStock = threshold > 0 && quantity <= threshold;
                return DataRow(
                  cells: [
                    DataCell(
                      Text(
                        '${product?['name'] ?? 'Product'}'
                        '${product?['sku'] == null ? '' : '\n${product?['sku']}'}',
                      ),
                    ),
                    DataCell(Text(branch?['name']?.toString() ?? 'Branch')),
                    DataCell(Text(_quantity(quantity))),
                    DataCell(Text(_quantity(reserved))),
                    DataCell(Text(_quantity(threshold))),
                    DataCell(Text(lowStock ? 'Low stock' : 'In stock')),
                    if (widget.user.role != RetivoxRole.employee)
                      DataCell(
                        Wrap(
                          spacing: 4,
                          children: [
                            IconButton(
                              tooltip: 'Add stock',
                              onPressed: () =>
                                  _adjustStock(row, operation: 'add'),
                              icon: const Icon(Icons.add_box_outlined),
                            ),
                            IconButton(
                              tooltip: 'Remove stock',
                              onPressed: () =>
                                  _adjustStock(row, operation: 'remove'),
                              icon: const Icon(
                                Icons.indeterminate_check_box_outlined,
                              ),
                            ),
                            IconButton(
                              tooltip: 'Edit low-stock threshold',
                              onPressed: () => _editStockThreshold(row),
                              icon: const Icon(Icons.tune),
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
      ],
    );
  }

  Future<void> _adjustStock(
    Map<String, dynamic> row, {
    required String operation,
  }) async {
    final controller = TextEditingController();
    String? error;
    var saving = false;
    try {
      await showDialog<void>(
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
                          await widget.repository.adjustStock(
                            widget.user,
                            stockId: stockId,
                            quantity: quantity,
                            operation: operation,
                          );
                          if (!dialogContext.mounted) return;
                          Navigator.pop(dialogContext);
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
              labelText: 'Threshold in base units',
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
      await widget.repository.updateStockThreshold(
        widget.user,
        stockId: stockId,
        branchId: branchId,
        threshold: threshold,
      );
      _refresh();
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

  Widget _productsTable(List<Map<String, dynamic>> rows) {
    final canManage = widget.user.role == RetivoxRole.owner;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          columns: [
            const DataColumn(label: Text('Product')),
            const DataColumn(label: Text('SKU')),
            const DataColumn(label: Text('Category')),
            const DataColumn(label: Text('Unit')),
            const DataColumn(label: Text('Base price')),
            const DataColumn(label: Text('Status')),
            if (canManage) const DataColumn(label: Text('Actions')),
          ],
          rows: rows.map((row) {
            final active = row['is_active'] == true;
            final pricing = _nested(row['product_pricing']);
            return DataRow(
              cells: [
                DataCell(Text(row['name']?.toString() ?? 'Product')),
                DataCell(Text(row['sku']?.toString() ?? '—')),
                DataCell(Text(row['category']?.toString() ?? '—')),
                DataCell(Text(row['unit']?.toString() ?? '—')),
                DataCell(
                  Text(
                    pricing?['base_price'] == null
                        ? '—'
                        : NumberFormat.currency(
                            name: widget.user.currency,
                            symbol: widget.user.currency,
                            decimalDigits: 2,
                          ).format(_number(pricing?['base_price'])),
                  ),
                ),
                DataCell(Text(active ? 'Active' : 'Inactive')),
                if (canManage)
                  DataCell(
                    Wrap(
                      spacing: 4,
                      children: [
                        TextButton(
                          onPressed: () => _openProductForm(product: row),
                          child: const Text('Edit'),
                        ),
                        TextButton(
                          onPressed: () => _toggleProduct(row, !active),
                          child: Text(active ? 'Deactivate' : 'Activate'),
                        ),
                      ],
                    ),
                  ),
              ],
            );
          }).toList(),
        ),
      ),
    );
  }

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
      await widget.repository.setProductActive(
        widget.user,
        productId: productId,
        isActive: isActive,
      );
      _refresh();
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
    return Card(
      clipBehavior: Clip.antiAlias,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          columns: [
            const DataColumn(label: Text('Supplier')),
            const DataColumn(label: Text('Contact person')),
            const DataColumn(label: Text('Phone')),
            const DataColumn(label: Text('Email')),
            const DataColumn(label: Text('Status')),
            if (canManage) const DataColumn(label: Text('Actions')),
          ],
          rows: rows.map((row) {
            final id = row['id']?.toString();
            final active = row['is_active'] == true;
            return DataRow(
              cells: [
                DataCell(Text(row['name']?.toString() ?? 'Supplier')),
                DataCell(Text(row['contact_person']?.toString() ?? '—')),
                DataCell(Text(row['phone']?.toString() ?? '—')),
                DataCell(Text(row['email']?.toString() ?? '—')),
                DataCell(Text(active ? 'Active' : 'Inactive')),
                if (canManage)
                  DataCell(
                    Wrap(
                      spacing: 4,
                      children: [
                        TextButton(
                          onPressed: () => _editSupplier(row: row),
                          child: const Text('Edit'),
                        ),
                        TextButton(
                          onPressed: id == null
                              ? null
                              : () =>
                                    _saveSupplier(row: row, isActive: !active),
                          child: Text(active ? 'Deactivate' : 'Activate'),
                        ),
                      ],
                    ),
                  ),
              ],
            );
          }).toList(),
        ),
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
      await showDialog<void>(
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
                          await widget.repository.saveSupplier(
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
                          Navigator.pop(dialogContext);
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
                    : const Text('Save supplier'),
              ),
            ],
          ),
        ),
      );
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
      await widget.repository.saveSupplier(
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
              'Supplier ${isActive ? 'activated' : 'deactivated'}.',
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
                                : () => _runAction(
                                    title: 'Approve payment',
                                    message: 'Confirm that this payment has been received and should be verified?',
                                    action: () =>
                                        widget.repository.verifyPayment(
                                          widget.user,
                                          paymentId: payment['id'].toString(),
                                          action: 'approve',
                                        ),
                                  ),
                            icon: const Icon(Icons.check_circle_outline),
                            label: const Text('Approve payment'),
                          ),
                          TextButton.icon(
                            onPressed: _isSaving
                                ? null
                                : () => _runAction(
                                    title: 'Reject payment',
                                    message: 'Reject this payment verification request?',
                                    action: () =>
                                        widget.repository.verifyPayment(
                                          widget.user,
                                          paymentId: payment['id'].toString(),
                                          action: 'reject',
                                        ),
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
      width: 220,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: 6),
              Text(value, style: Theme.of(context).textTheme.headlineSmall),
            ],
          ),
        ),
      ),
    );
  }
}

class _DataTableCard extends StatelessWidget {
  const _DataTableCard({required this.columns, required this.rows});

  final List<String> columns;
  final List<List<String>> rows;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
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
    return Card(
      color: theme.colorScheme.surfaceContainerHigh,
      child: const Padding(
        padding: EdgeInsets.all(14),
        child: Text(
          'Role-scoped actions are available where shown. Advanced settings and offline management changes may still require the secure web workflow.',
        ),
      ),
    );
  }
}
