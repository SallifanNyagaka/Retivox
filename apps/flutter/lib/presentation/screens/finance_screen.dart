import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';
import '../theme/retivox_theme.dart';
import 'cash_deposit_dialog.dart';
import 'inventory_loss_dialog.dart';

class FinanceScreen extends StatefulWidget {
  const FinanceScreen({
    required this.user,
    required this.repository,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;

  @override
  State<FinanceScreen> createState() => _FinanceScreenState();
}

class _FinanceScreenState extends State<FinanceScreen> {
  Future<void> _showCashDepositDialog() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) =>
          CashDepositDialog(user: widget.user, repository: widget.repository),
    );
    if (saved == true) {
      _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Cash deposit recorded for review.')),
        );
      }
    }
  }

  Future<void> _showInventoryLossDialog() async {
    try {
      final options = await widget.repository.loadDamageReportOptions(
        widget.user,
      );
      if (!mounted) return;
      if (options.rows.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No available stock can be written off.'),
          ),
        );
        return;
      }
      final saved = await showDialog<bool>(
        context: context,
        builder: (context) => InventoryLossDialog(
          user: widget.user,
          repository: widget.repository,
          options: options,
        ),
      );
      if (saved == true) {
        _refresh();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Inventory loss recorded.')),
          );
        }
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open inventory loss form: $error')),
        );
      }
    }
  }

  Widget _pendingDamageReports(
    BuildContext context,
    Map<String, dynamic> data,
  ) {
    final reports = _records(data['pending_reports']);
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Pending employee damage reports',
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 10),
            if (reports.isEmpty)
              const Text('There are no pending damage reports.')
            else
              for (final report in reports)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.report_gmailerrorred_outlined),
                  title: Text(
                    '${report['product_name'] ?? 'Product'}'
                    ' Â· ${report['quantity_in_uom'] ?? 'â€”'} ${report['uom_name'] ?? ''}',
                  ),
                  subtitle: Text(
                    '${report['branch_name'] ?? 'Branch'}'
                    ' Â· ${report['reporter_name'] ?? 'Team member'}'
                    ' Â· ${(report['loss_type']?.toString() ?? 'other').replaceAll('_', ' ')}'
                    '\n${report['reason'] ?? ''}',
                  ),
                  isThreeLine: true,
                  trailing: Wrap(
                    spacing: 4,
                    children: [
                      IconButton(
                        tooltip: 'Review and approve',
                        onPressed: () => _reviewDamageReport(report),
                        icon: const Icon(Icons.edit_note_outlined),
                      ),
                      IconButton(
                        tooltip: 'Reject report',
                        onPressed: () =>
                            _reviewDamageReport(report, reject: true),
                        icon: const Icon(Icons.cancel_outlined),
                      ),
                    ],
                  ),
                ),
          ],
        ),
      ),
    );
  }

  Future<void> _reviewDamageReport(
    Map<String, dynamic> report, {
    bool reject = false,
  }) async {
    final quantity = TextEditingController(
      text: report['quantity_in_uom']?.toString() ?? '',
    );
    final reason = TextEditingController(
      text: report['reason']?.toString() ?? '',
    );
    final recoveryPrice = TextEditingController(
      text:
          report['suggested_recovery_sale_price_per_base_unit']?.toString() ??
          '',
    );
    final reviewNote = TextEditingController();
    var lossType = report['loss_type']?.toString() ?? 'other';
    var saving = false;
    String? error;
    try {
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: Text(
              reject ? 'Reject damage report' : 'Review damage report',
            ),
            content: SizedBox(
              width: 480,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      '${report['branch_name'] ?? 'Branch'} Â· '
                      '${report['product_name'] ?? 'Product'}',
                    ),
                    if (!reject) ...[
                      TextField(
                        controller: quantity,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: const InputDecoration(
                          labelText: 'Quantity affected',
                        ),
                      ),
                      DropdownButtonFormField<String>(
                        initialValue:
                            const [
                              'breakage',
                              'spoilage',
                              'theft',
                              'markdown_damage',
                              'other',
                            ].contains(lossType)
                            ? lossType
                            : 'other',
                        decoration: const InputDecoration(
                          labelText: 'Loss type',
                        ),
                        items:
                            const [
                                  ('breakage', 'Breakage'),
                                  ('spoilage', 'Spoilage'),
                                  ('theft', 'Theft'),
                                  ('markdown_damage', 'Markdown damage'),
                                  ('other', 'Other'),
                                ]
                                .map(
                                  (item) => DropdownMenuItem(
                                    value: item.$1,
                                    child: Text(item.$2),
                                  ),
                                )
                                .toList(),
                        onChanged: saving
                            ? null
                            : (value) => setDialogState(
                                () => lossType = value ?? 'other',
                              ),
                      ),
                      TextField(
                        controller: reason,
                        maxLength: 240,
                        maxLines: 2,
                        decoration: const InputDecoration(labelText: 'Reason'),
                      ),
                      TextField(
                        controller: recoveryPrice,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: const InputDecoration(
                          labelText:
                              'Recovery sale price per base unit (optional)',
                        ),
                      ),
                    ],
                    TextField(
                      controller: reviewNote,
                      maxLength: 180,
                      decoration: const InputDecoration(
                        labelText: 'Review note (optional)',
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
                        final parsedQuantity = double.tryParse(
                          quantity.text.trim(),
                        );
                        final parsedRecovery = double.tryParse(
                          recoveryPrice.text.trim(),
                        );
                        if (!reject &&
                            (parsedQuantity == null ||
                                parsedRecovery == null &&
                                    recoveryPrice.text.trim().isNotEmpty ||
                                reason.text.trim().isEmpty)) {
                          setDialogState(
                            () => error = 'Check the quantity, reason, and recovery price.',
                          );
                          return;
                        }
                        setDialogState(() {
                          saving = true;
                          error = null;
                        });
                        try {
                          await widget.repository.reviewDamageReport(
                            widget.user,
                            reportId: report['report_id'].toString(),
                            approve: !reject,
                            reviewNote: reviewNote.text,
                            quantity: parsedQuantity,
                            lossType: lossType,
                            reason: reason.text,
                            recoverySalePrice: parsedRecovery ?? 0,
                          );
                          if (!mounted || !dialogContext.mounted) return;
                          Navigator.pop(dialogContext);
                          _refresh();
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                reject ? 'Damage report rejected.' : 'Damage report approved and inventory loss recorded.',
                              ),
                            ),
                          );
                        } catch (exception) {
                          if (dialogContext.mounted) {
                            setDialogState(() => error = exception.toString());
                          }
                        }
                      },
                child: saving
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        reject ? 'Reject report' : 'Approve and record loss',
                      ),
              ),
            ],
          ),
        ),
      );
    } finally {
      quantity.dispose();
      reason.dispose();
      recoveryPrice.dispose();
      reviewNote.dispose();
    }
  }

  Widget _receivableAccounts(BuildContext context, Map<String, dynamic> data) {
    final allAccounts = _records(data['receivable_accounts']);
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final filtered = allAccounts.where((account) {
      final search = _receivableSearch.trim().toLowerCase();
      final name = account['customer_name']?.toString().toLowerCase() ?? '';
      final phone = account['customer_phone']?.toString().toLowerCase() ?? '';
      final matchesSearch =
          search.isEmpty || name.contains(search) || phone.contains(search);
      final due = DateTime.tryParse(account['due_date']?.toString() ?? '');
      final daysLeft = due == null
          ? 9999
          : DateTime(due.year, due.month, due.day).difference(today).inDays;
      final balance = _number(account['balance_due']);
      final status = account['account_status']?.toString() ?? 'open';
      final matchesFilter = switch (_receivableStatus) {
        'all' => true,
        'outstanding' => balance > 0,
        'due_soon' => balance > 0 && daysLeft >= 0 && daysLeft <= 2,
        'overdue' => balance > 0 && daysLeft < 0,
        'paid' => balance <= 0 || status == 'paid',
        _ => true,
      };
      return matchesSearch && matchesFilter;
    }).toList();
    final visible = _showAllReceivables ? filtered : filtered.take(6).toList();
    final currency = NumberFormat.currency(name: widget.user.currency);
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 12,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text('Credit accounts', style: theme.textTheme.titleMedium),
                Text(
                  '${filtered.length} records',
                  style: theme.textTheme.bodySmall,
                ),
                if (filtered.length > 6)
                  TextButton.icon(
                    onPressed: () => setState(
                      () => _showAllReceivables = !_showAllReceivables,
                    ),
                    icon: Icon(
                      _showAllReceivables
                          ? Icons.expand_less
                          : Icons.expand_more,
                    ),
                    label: Text(_showAllReceivables ? 'Show less' : 'More'),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                SizedBox(
                  width: 290,
                  child: TextField(
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.search_rounded),
                      labelText: 'Find customer by name or phone',
                      isDense: true,
                    ),
                    onChanged: (value) => setState(() {
                      _receivableSearch = value;
                      _showAllReceivables = false;
                    }),
                  ),
                ),
                SizedBox(
                  width: 190,
                  child: DropdownButtonFormField<String>(
                    initialValue: _receivableStatus,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Filter accounts',
                    ),
                    items: const [
                      DropdownMenuItem(
                        value: 'outstanding',
                        child: Text('Outstanding'),
                      ),
                      DropdownMenuItem(
                        value: 'due_soon',
                        child: Text('Due within 2 days'),
                      ),
                      DropdownMenuItem(
                        value: 'overdue',
                        child: Text('Overdue'),
                      ),
                      DropdownMenuItem(value: 'paid', child: Text('Paid')),
                      DropdownMenuItem(
                        value: 'all',
                        child: Text('All accounts'),
                      ),
                    ],
                    onChanged: (value) => setState(() {
                      _receivableStatus = value ?? 'outstanding';
                      _showAllReceivables = false;
                    }),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (filtered.isEmpty)
              const Text('No credit accounts match this filter.')
            else
              LayoutBuilder(
                builder: (context, constraints) {
                  final columns = constraints.maxWidth >= 1100
                      ? 3
                      : constraints.maxWidth >= 680
                      ? 2
                      : 1;
                  final width =
                      (constraints.maxWidth - (columns - 1) * 10) / columns;
                  return Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      for (final account in visible)
                        SizedBox(
                          width: width,
                          child: Card(
                            color: theme.colorScheme.surfaceContainerLow,
                            child: ListTile(
                              dense: true,
                              leading: Icon(
                                account['account_status'] == 'overdue'
                                    ? Icons.warning_amber_rounded
                                    : Icons.account_balance_wallet_outlined,
                                color: account['account_status'] == 'overdue'
                                    ? RetivoxTheme.danger
                                    : RetivoxTheme.accent,
                              ),
                              title: Text(
                                account['customer_name']?.toString() ??
                                    'Customer',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: Text(
                                '${account['branch_name'] ?? 'Branch'} · Due ${account['due_date'] ?? '—'} · Paid ${currency.format(_number(account['amount_paid']))}',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              trailing: Text(
                                currency.format(
                                  _number(account['balance_due']),
                                ),
                                style: TextStyle(
                                  fontWeight: FontWeight.w700,
                                  color: _number(account['balance_due']) > 0
                                      ? RetivoxTheme.accentDark
                                      : RetivoxTheme.success,
                                ),
                              ),
                              onTap: () =>
                                  _showReceivableDetails(account, currency),
                            ),
                          ),
                        ),
                    ],
                  );
                },
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _showReceivableDetails(
    Map<String, dynamic> account,
    NumberFormat currency,
  ) => showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      constraints: const BoxConstraints(maxWidth: 760),
      title: Text(
        'Credit purchase · ${account['customer_name'] ?? 'Customer'}',
      ),
      content: SizedBox(
        width: 700,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Phone: ${account['customer_phone'] ?? '—'} · Email: ${account['customer_email'] ?? '—'}',
              ),
              Text(
                'Due ${account['due_date'] ?? '—'} · ${account['account_status'] ?? 'open'}',
              ),
              Text(
                'Sale ${currency.format(_number(account['total_amount']))} · Paid ${currency.format(_number(account['amount_paid']))} · Balance ${currency.format(_number(account['balance_due']))}',
              ),
              const Divider(),
              Text(
                'Purchased items',
                style: Theme.of(dialogContext).textTheme.titleSmall,
              ),
              for (final item in _records(account['items']))
                Text(
                  '${_nested(item['products'])?['name'] ?? 'Product'} · ${item['quantity_in_uom'] ?? item['quantity'] ?? 0} ${_nested(item['units_of_measure'])?['name'] ?? 'units'} · ${currency.format(_number(item['line_total']))}',
                ),
              const SizedBox(height: 10),
              Text(
                'Payment history',
                style: Theme.of(dialogContext).textTheme.titleSmall,
              ),
              if (_records(account['payments']).isEmpty)
                const Text('No payments received yet.'),
              for (final payment in _records(account['payments']))
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${payment['payment_method'] ?? 'payment'} · ${currency.format(_number(payment['amount']))} · ${payment['status'] == 'pending_sync' ? 'pending sync' : payment['status'] ?? ''} · ${payment['payment_at'] ?? ''}',
                      ),
                      if (payment['sync_error'] != null)
                        Text(
                          'Sync needs attention: ${payment['sync_error']}',
                          style: TextStyle(
                            color: Theme.of(dialogContext).colorScheme.error,
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: const Text('Close'),
        ),
        if (_number(account['balance_due']) > 0)
          FilledButton(
            onPressed: () {
              Navigator.pop(dialogContext);
              _showReceivablePaymentDialog(account);
            },
            child: const Text('Record payment'),
          ),
      ],
    ),
  );

  Future<void> _showReceivablePaymentDialog(
    Map<String, dynamic> account,
  ) async {
    final amount = TextEditingController();
    final tendered = TextEditingController();
    final reference = TextEditingController();
    var method = 'cash';
    var saving = false;
    var queuedForSync = false;
    String? error;
    final balance = _number(account['balance_due']);
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          constraints: const BoxConstraints(maxWidth: 520),
          title: const Text('Record customer payment'),
          content: SizedBox(
            width: 460,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: amount,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: InputDecoration(
                      labelText: 'Amount applied',
                      helperText:
                          'Outstanding balance: ${NumberFormat.currency(name: widget.user.currency).format(balance)}',
                    ),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: method,
                    decoration: const InputDecoration(
                      labelText: 'Payment method',
                    ),
                    items: const [
                      DropdownMenuItem(value: 'cash', child: Text('Cash')),
                      DropdownMenuItem(
                        value: 'mpesa_manual',
                        child: Text('M-Pesa manual'),
                      ),
                      DropdownMenuItem(value: 'card', child: Text('Card')),
                      DropdownMenuItem(
                        value: 'bank_transfer',
                        child: Text('Bank transfer'),
                      ),
                      DropdownMenuItem(value: 'other', child: Text('Other')),
                    ],
                    onChanged: (value) =>
                        setDialogState(() => method = value ?? 'cash'),
                  ),
                  const SizedBox(height: 12),
                  if (method == 'cash')
                    TextField(
                      controller: tendered,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: const InputDecoration(
                        labelText: 'Cash received',
                        helperText:
                            'Leave blank to apply the exact amount entered.',
                      ),
                    ),
                  if (method != 'cash')
                    TextField(
                      controller: reference,
                      decoration: InputDecoration(
                        labelText: method == 'mpesa_manual'
                            ? 'M-Pesa reference code'
                            : 'Payment reference (optional)',
                      ),
                    ),
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        error!,
                        style: TextStyle(
                          color: Theme.of(dialogContext).colorScheme.error,
                        ),
                      ),
                    ),
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
              onPressed: saving
                  ? null
                  : () async {
                      final applied = _parseMoneyInput(amount.text);
                      final cash = _parseMoneyInput(tendered.text);
                      if (applied == null ||
                          !applied.isFinite ||
                          applied <= 0) {
                        setDialogState(
                          () =>
                              error = 'Enter a valid amount greater than zero.',
                        );
                        return;
                      }
                      if (method == 'cash' && cash != null && cash < applied) {
                        setDialogState(
                          () => error =
                              'Cash received must cover the amount applied.',
                        );
                        return;
                      }
                      if (method == 'mpesa_manual' &&
                          reference.text.trim().length < 5) {
                        setDialogState(
                          () => error = 'Enter a valid M-Pesa reference code.',
                        );
                        return;
                      }
                      setDialogState(() {
                        saving = true;
                        error = null;
                      });
                      try {
                        queuedForSync = await widget.repository
                            .recordReceivablePayment(
                              user: widget.user,
                              receivableId: account['id'].toString(),
                              paymentMethod: method,
                              amount: applied,
                              amountTendered: method == 'cash'
                                  ? cash ?? applied
                                  : applied,
                              referenceCode: reference.text,
                              currentBalance: balance,
                              branchId: account['branch_id']?.toString() ?? '',
                            );
                        if (dialogContext.mounted) {
                          Navigator.pop(dialogContext, true);
                        }
                      } catch (e) {
                        setDialogState(() {
                          saving = false;
                          error = e.toString();
                        });
                      }
                    },
              child: Text(saving ? 'Savingâ€¦' : 'Save payment'),
            ),
          ],
        ),
      ),
    );
    amount.dispose();
    tendered.dispose();
    reference.dispose();
    if (saved == true && mounted) {
      _refresh();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            queuedForSync
                ? 'Payment saved offline and will sync when you reconnect.'
                : 'Payment recorded and balance updated.',
          ),
        ),
      );
    }
  }

  double? _parseMoneyInput(String value) {
    final normalized = value.trim().replaceAll(RegExp(r'[,\s]'), '');
    return double.tryParse(normalized);
  }

  static const _periods = ['today', 'week', 'month'];
  String _period = 'today';
  String _branchId = '';
  String _receivableSearch = '';
  String _receivableStatus = 'outstanding';
  bool _showAllReceivables = false;
  late Future<DashboardSnapshot> _snapshot;

  @override
  void initState() {
    super.initState();
    _snapshot = _load();
  }

  Future<DashboardSnapshot> _load() => widget.repository.loadFinance(
    widget.user,
    period: _period,
    branchId: _branchId,
  );

  void _refresh() {
    setState(() => _snapshot = _load());
  }

  void _changePeriod(String period) {
    setState(() {
      _period = period;
      _snapshot = _load();
    });
  }

  void _changeBranch(String? branchId) {
    setState(() {
      _branchId = branchId ?? '';
      _snapshot = _load();
    });
  }

  Future<void> _showExpenseDialog(Map<String, dynamic> data) async {
    final category = TextEditingController();
    final description = TextEditingController();
    final amount = TextEditingController();
    final branches = _records(data['branches']);
    var branchId = _branchId;
    var incurredOn = DateTime.now();
    var isSaving = false;
    String? errorMessage;
    try {
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: const Text('Record operating expense'),
            content: SizedBox(
              width: 440,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    DropdownButtonFormField<String>(
                      initialValue: branchId,
                      decoration: const InputDecoration(labelText: 'Branch'),
                      items: [
                        const DropdownMenuItem(
                          value: '',
                          child: Text('Business-wide'),
                        ),
                        for (final branch in branches)
                          DropdownMenuItem(
                            value: branch['id']?.toString() ?? '',
                            child: Text(branch['name']?.toString() ?? 'Branch'),
                          ),
                      ],
                      onChanged: isSaving
                          ? null
                          : (value) =>
                                setDialogState(() => branchId = value ?? ''),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: category,
                      maxLength: 80,
                      decoration: const InputDecoration(
                        labelText: 'Category',
                        hintText: 'Rent, utilities, transport...',
                      ),
                    ),
                    TextField(
                      controller: description,
                      maxLength: 180,
                      decoration: const InputDecoration(
                        labelText: 'Description',
                      ),
                    ),
                    TextField(
                      controller: amount,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: InputDecoration(
                        labelText: 'Amount',
                        prefixText: '${widget.user.currency} ',
                      ),
                    ),
                    const SizedBox(height: 12),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton.icon(
                        onPressed: isSaving
                            ? null
                            : () async {
                                final date = await showDatePicker(
                                  context: dialogContext,
                                  initialDate: incurredOn,
                                  firstDate: DateTime(2000),
                                  lastDate: DateTime.now(),
                                );
                                if (date != null) {
                                  setDialogState(() => incurredOn = date);
                                }
                              },
                        icon: const Icon(Icons.calendar_today_outlined),
                        label: Text(DateFormat.yMMMd().format(incurredOn)),
                      ),
                    ),
                    if (errorMessage != null) ...[
                      const SizedBox(height: 8),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          errorMessage!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: isSaving
                    ? null
                    : () => Navigator.of(dialogContext).pop(),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: isSaving
                    ? null
                    : () async {
                        final parsedAmount = double.tryParse(
                          amount.text.trim(),
                        );
                        if (category.text.trim().isEmpty ||
                            description.text.trim().isEmpty ||
                            parsedAmount == null ||
                            !parsedAmount.isFinite ||
                            parsedAmount <= 0) {
                          setDialogState(
                            () => errorMessage = 'Enter a category, description, and positive amount.',
                          );
                          return;
                        }
                        setDialogState(() {
                          isSaving = true;
                          errorMessage = null;
                        });
                        try {
                          await widget.repository.recordFinanceExpense(
                            widget.user,
                            branchId: branchId,
                            category: category.text,
                            description: description.text,
                            amount: parsedAmount,
                            incurredOn: incurredOn,
                          );
                          if (!mounted || !dialogContext.mounted) return;
                          Navigator.of(dialogContext).pop();
                          _refresh();
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Expense recorded successfully.'),
                            ),
                          );
                        } catch (error) {
                          if (!dialogContext.mounted) return;
                          setDialogState(() {
                            isSaving = false;
                            errorMessage = error.toString();
                          });
                        }
                      },
                child: isSaving
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Save expense'),
              ),
            ],
          ),
        ),
      );
    } finally {
      category.dispose();
      description.dispose();
      amount.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return FutureBuilder<DashboardSnapshot>(
      future: _snapshot,
      builder: (context, result) => Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1520),
          child: ListView(
            padding: const EdgeInsets.all(28),
            children: [
              LayoutBuilder(
                builder: (context, constraints) {
                  final actions = <Widget>[
                    if (widget.user.role == RetivoxRole.owner && result.hasData)
                      FilledButton.icon(
                        onPressed:
                            result.connectionState == ConnectionState.waiting
                            ? null
                            : () =>
                                  _showExpenseDialog(result.data!.rows.single),
                        icon: const Icon(Icons.add),
                        label: const Text('Record expense'),
                      ),
                    if (widget.user.role == RetivoxRole.owner && result.hasData)
                      OutlinedButton.icon(
                        onPressed:
                            result.connectionState == ConnectionState.waiting
                            ? null
                            : _showInventoryLossDialog,
                        icon: const Icon(Icons.warning_amber_outlined),
                        label: const Text('Record inventory loss'),
                      ),
                    if (widget.user.role == RetivoxRole.owner && result.hasData)
                      OutlinedButton.icon(
                        onPressed:
                            result.connectionState == ConnectionState.waiting
                            ? null
                            : _showCashDepositDialog,
                        icon: const Icon(Icons.account_balance_outlined),
                        label: const Text('Record cash deposit'),
                      ),
                    IconButton(
                      tooltip: 'Refresh from server',
                      onPressed:
                          result.connectionState == ConnectionState.waiting
                          ? null
                          : _refresh,
                      icon: const Icon(Icons.refresh),
                    ),
                  ];
                  final title = Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Finances', style: theme.textTheme.headlineSmall),
                      const SizedBox(height: 6),
                      Text(
                        'Revenue, costs, operating expenses, and inventory losses.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  );
                  if (constraints.maxWidth < 760) {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        title,
                        const SizedBox(height: 12),
                        Wrap(spacing: 8, runSpacing: 8, children: actions),
                      ],
                    );
                  }
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: title),
                      Flexible(
                        child: Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: actions,
                        ),
                      ),
                    ],
                  );
                },
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final period in _periods)
                    ChoiceChip(
                      label: Text(_periodLabel(period)),
                      selected: period == _period,
                      onSelected: (_) => _changePeriod(period),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              if (result.hasError)
                Card(
                  color: theme.colorScheme.errorContainer,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(result.error.toString()),
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
                _branchSelector(result.data!),
                const SizedBox(height: 12),
                _cacheLabel(context, result.data!),
                const SizedBox(height: 14),
                _summary(context, result.data!.rows.single),
                const SizedBox(height: 14),
                _creditDueAlerts(context, result.data!.rows.single),
                const SizedBox(height: 14),
                _receivableAccounts(context, result.data!.rows.single),
                const SizedBox(height: 14),
                _responsivePair(
                  _pendingDamageReports(context, result.data!.rows.single),
                  _cashDeposits(context, result.data!.rows.single),
                ),
                const SizedBox(height: 14),
                _recurringExpenses(context, result.data!.rows.single),
                const SizedBox(height: 14),
                Card(
                  color: theme.colorScheme.surfaceContainerHigh,
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Text(
                      widget.user.role == RetivoxRole.owner
                          ? 'Finance entries are saved online. Expense entry is available here; cash reconciliation, recurring expenses, inventory loss and damage-report review require additional secure workflows.'
                          : 'Finance entries and approvals are restricted to business owners.',
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _responsivePair(Widget first, Widget second) => LayoutBuilder(
    builder: (context, constraints) {
      if (constraints.maxWidth < 900) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [first, const SizedBox(height: 12), second],
        );
      }
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: first),
          const SizedBox(width: 12),
          Expanded(child: second),
        ],
      );
    },
  );

  Widget _creditDueAlerts(BuildContext context, Map<String, dynamic> data) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final dueLimit = today.add(const Duration(days: 2));
    final alerts =
        _records(data['receivable_accounts']).where((account) {
          final balance = _number(account['balance_due']);
          final due = DateTime.tryParse(account['due_date']?.toString() ?? '');
          if (balance <= 0 || due == null) return false;
          final date = DateTime(due.year, due.month, due.day);
          return !date.isAfter(dueLimit);
        }).toList()..sort(
          (a, b) => (a['due_date']?.toString() ?? '').compareTo(
            b['due_date']?.toString() ?? '',
          ),
        );
    if (alerts.isEmpty) return const SizedBox.shrink();
    final currency = NumberFormat.currency(name: widget.user.currency);
    final theme = Theme.of(context);
    return Card(
      color: theme.colorScheme.errorContainer.withValues(alpha: 0.35),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  Icons.notifications_active_outlined,
                  color: theme.colorScheme.error,
                ),
                const SizedBox(width: 8),
                Text(
                  'Credit payments due soon',
                  style: theme.textTheme.titleMedium,
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Outstanding balances due within 2 days, and overdue accounts.',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 6),
            for (final account in alerts.take(6))
              Builder(
                builder: (context) {
                  final due = DateTime.tryParse(
                    account['due_date']?.toString() ?? '',
                  );
                  final days = due == null
                      ? 0
                      : DateTime(
                          due.year,
                          due.month,
                          due.day,
                        ).difference(today).inDays;
                  final label = days < 0
                      ? 'Overdue by ${days.abs()} ${days.abs() == 1 ? 'day' : 'days'}'
                      : days == 0
                      ? 'Due today'
                      : 'Due in $days ${days == 1 ? 'day' : 'days'}';
                  return ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      days < 0
                          ? Icons.error_outline_rounded
                          : Icons.schedule_rounded,
                      color: days < 0
                          ? RetivoxTheme.danger
                          : RetivoxTheme.accent,
                    ),
                    title: Text(
                      '${account['customer_name'] ?? 'Customer'} · $label',
                    ),
                    subtitle: Text(
                      '${account['branch_name'] ?? 'Branch'} · Due ${account['due_date'] ?? '—'}',
                    ),
                    trailing: Text(
                      currency.format(_number(account['balance_due'])),
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: days < 0
                            ? RetivoxTheme.danger
                            : RetivoxTheme.accentDark,
                      ),
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }

  Widget _branchSelector(DashboardSnapshot snapshot) {
    final summary = snapshot.rows.single;
    final branches = _records(summary['branches']);
    return Align(
      alignment: Alignment.centerLeft,
      child: SizedBox(
        width: MediaQuery.sizeOf(context).width < 400 ? double.infinity : 320,
        child: DropdownButtonFormField<String>(
          initialValue: _branchId,
          decoration: const InputDecoration(labelText: 'Branch', isDense: true),
          items: [
            const DropdownMenuItem(
              value: '',
              child: Text('All active branches'),
            ),
            for (final branch in branches)
              DropdownMenuItem(
                value: branch['id']?.toString() ?? '',
                child: Text(branch['name']?.toString() ?? 'Branch'),
              ),
          ],
          onChanged: _changeBranch,
        ),
      ),
    );
  }

  Widget _cacheLabel(BuildContext context, DashboardSnapshot snapshot) {
    final timestamp = snapshot.updatedAt?.toLocal();
    return Row(
      children: [
        Icon(
          snapshot.isCached
              ? Icons.storage_outlined
              : Icons.cloud_done_outlined,
          size: 17,
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            snapshot.isCached
                ? 'Showing saved ${_periodLabel(_period).toLowerCase()} data${timestamp == null ? '' : ' Â· last refreshed ${DateFormat.yMMMd().add_jm().format(timestamp)}'}'
                : 'Showing latest ${_periodLabel(_period).toLowerCase()} data${timestamp == null ? '' : ' Â· refreshed ${DateFormat.yMMMd().add_jm().format(timestamp)}'}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      ],
    );
  }

  Widget _cashDeposits(BuildContext context, Map<String, dynamic> data) {
    final deposits = _records(data['cash_deposits']);
    final currency = NumberFormat.currency(name: widget.user.currency);
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Cash deposit reconciliation',
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            if (deposits.isEmpty)
              const Text('No cash deposits recorded for this period.')
            else
              for (final deposit in deposits)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.account_balance_outlined),
                  title: Text(
                    '${_nested(deposit['branches'])?['name'] ?? 'Branch'}'
                    ' Â· ${_date(deposit['deposit_date'])}'
                    ' Â· ${currency.format(_number(deposit['amount']))}',
                  ),
                  subtitle: Text(
                    'Reference: ${deposit['deposit_reference'] ?? 'â€”'}'
                    ' Â· Expected: ${currency.format(_number(deposit['expected_cash_amount']))}'
                    ' Â· Variance: ${currency.format(_number(deposit['variance_amount']))}'
                    '\n${deposit['status'] ?? 'pending'}'
                    '${deposit['review_note'] == null ? '' : ' Â· ${deposit['review_note']}'}',
                  ),
                  isThreeLine: true,
                  trailing:
                      const [
                        'pending',
                        'pending_owner',
                      ].contains(deposit['status'])
                      ? Wrap(
                          spacing: 4,
                          children: [
                            IconButton(
                              tooltip: 'Approve deposit',
                              onPressed: () => _reviewCashDeposit(
                                deposit,
                                action: 'approve',
                              ),
                              icon: const Icon(Icons.check_circle_outline),
                            ),
                            IconButton(
                              tooltip: 'Reject deposit',
                              onPressed: () =>
                                  _reviewCashDeposit(deposit, action: 'reject'),
                              icon: const Icon(Icons.cancel_outlined),
                            ),
                          ],
                        )
                      : Chip(label: Text(deposit['status'].toString())),
                ),
          ],
        ),
      ),
    );
  }

  Future<void> _reviewCashDeposit(
    Map<String, dynamic> deposit, {
    required String action,
  }) async {
    final note = TextEditingController();
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(
            action == 'approve'
                ? 'Approve cash deposit?'
                : 'Reject cash deposit?',
          ),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Variance: ${NumberFormat.currency(name: widget.user.currency).format(_number(deposit['variance_amount']))}. '
                  'Approval requires an exact match to recorded cash.',
                ),
                TextField(
                  controller: note,
                  maxLength: 180,
                  decoration: const InputDecoration(
                    labelText: 'Review note (optional)',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(action == 'approve' ? 'Approve' : 'Reject'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
      await widget.repository.reviewCashDeposit(
        widget.user,
        depositId: deposit['id'].toString(),
        action: action,
        reviewNote: note.text,
      );
      _refresh();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Cash deposit review failed: $error')),
        );
      }
    } finally {
      note.dispose();
    }
  }

  Widget _recurringExpenses(BuildContext context, Map<String, dynamic> data) {
    final templates = _records(data['recurring_templates']);
    final instances = _records(data['recurring_instances']);
    final currency = NumberFormat.currency(name: widget.user.currency);
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Recurring expenses',
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                OutlinedButton.icon(
                  onPressed: () => _editRecurringTemplate(data),
                  icon: const Icon(Icons.add),
                  label: const Text('Add template'),
                ),
              ],
            ),
            if (templates.isEmpty)
              const Text('No recurring expense templates.')
            else
              for (final template in templates)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    '${template['category']}: ${template['description']}',
                  ),
                  subtitle: Text(
                    '${_nested(template['branches'])?['name'] ?? 'Business-wide'}'
                    ' Â· Day ${template['due_day']}'
                    ' Â· ${currency.format(_number(template['default_amount']))}'
                    ' Â· ${template['is_active'] == true ? 'Active' : 'Paused'}',
                  ),
                  trailing: TextButton(
                    onPressed: () =>
                        _editRecurringTemplate(data, template: template),
                    child: Text(
                      template['is_active'] == true
                          ? 'Edit / pause'
                          : 'Edit / activate',
                    ),
                  ),
                ),
            const Divider(height: 24),
            Text('Pending reminders', style: theme.textTheme.titleSmall),
            if (instances.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('No pending recurring expenses this period.'),
              )
            else
              for (final instance in instances)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    '${instance['category']}: ${instance['description']}',
                  ),
                  subtitle: Text(
                    'Due ${_date(instance['due_on'])}'
                    ' Â· ${currency.format(_number(instance['amount']))}',
                  ),
                  trailing: Wrap(
                    spacing: 4,
                    children: [
                      TextButton(
                        onPressed: () => _confirmRecurringExpense(instance),
                        child: const Text('Confirm'),
                      ),
                      TextButton(
                        onPressed: () => _skipRecurringExpense(instance),
                        child: const Text('Skip'),
                      ),
                    ],
                  ),
                ),
          ],
        ),
      ),
    );
  }

  Future<void> _editRecurringTemplate(
    Map<String, dynamic> data, {
    Map<String, dynamic>? template,
  }) async {
    final category = TextEditingController(
      text: template?['category']?.toString() ?? '',
    );
    final description = TextEditingController(
      text: template?['description']?.toString() ?? '',
    );
    final amount = TextEditingController(
      text: template?['default_amount']?.toString() ?? '',
    );
    var dueDay = _number(template?['due_day']).toInt();
    if (dueDay < 1 || dueDay > 31) dueDay = 28;
    var branchId = template?['branch_id']?.toString() ?? '';
    var isActive = template?['is_active'] != false;
    String? error;
    var saving = false;
    final branches = _records(data['branches']);
    try {
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: Text(
              template == null
                  ? 'New recurring expense'
                  : 'Edit recurring expense',
            ),
            content: SizedBox(
              width: 440,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    DropdownButtonFormField<String>(
                      initialValue: branchId,
                      decoration: const InputDecoration(labelText: 'Branch'),
                      items: [
                        const DropdownMenuItem(
                          value: '',
                          child: Text('Business-wide'),
                        ),
                        for (final branch in branches)
                          DropdownMenuItem(
                            value: branch['id']?.toString() ?? '',
                            child: Text(branch['name']?.toString() ?? 'Branch'),
                          ),
                      ],
                      onChanged: saving
                          ? null
                          : (value) =>
                                setDialogState(() => branchId = value ?? ''),
                    ),
                    TextField(
                      controller: category,
                      maxLength: 80,
                      decoration: const InputDecoration(labelText: 'Category'),
                    ),
                    TextField(
                      controller: description,
                      maxLength: 180,
                      decoration: const InputDecoration(
                        labelText: 'Description',
                      ),
                    ),
                    TextField(
                      controller: amount,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: const InputDecoration(
                        labelText: 'Monthly amount',
                      ),
                    ),
                    DropdownButtonFormField<int>(
                      initialValue: dueDay,
                      decoration: const InputDecoration(labelText: 'Due day'),
                      items: [
                        for (var day = 1; day <= 31; day++)
                          DropdownMenuItem(value: day, child: Text('$day')),
                      ],
                      onChanged: saving
                          ? null
                          : (value) =>
                                setDialogState(() => dueDay = value ?? 28),
                    ),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Active'),
                      value: isActive,
                      onChanged: saving
                          ? null
                          : (value) => setDialogState(() => isActive = value),
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
                        final parsedAmount = double.tryParse(
                          amount.text.trim(),
                        );
                        if (parsedAmount == null ||
                            !parsedAmount.isFinite ||
                            parsedAmount <= 0) {
                          setDialogState(
                            () => error = 'Enter a positive monthly amount.',
                          );
                          return;
                        }
                        setDialogState(() {
                          saving = true;
                          error = null;
                        });
                        try {
                          await widget.repository.saveRecurringExpenseTemplate(
                            widget.user,
                            templateId: template?['id']?.toString(),
                            branchId: branchId.isEmpty ? null : branchId,
                            category: category.text,
                            description: description.text,
                            amount: parsedAmount,
                            dueDay: dueDay,
                            isActive: isActive,
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
                    : const Text('Save template'),
              ),
            ],
          ),
        ),
      );
    } finally {
      category.dispose();
      description.dispose();
      amount.dispose();
    }
  }

  Future<void> _confirmRecurringExpense(Map<String, dynamic> instance) async {
    final amount = TextEditingController(
      text: instance['amount']?.toString() ?? '',
    );
    final description = TextEditingController(
      text: instance['description']?.toString() ?? '',
    );
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Confirm recurring expense'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: amount,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(labelText: 'Actual amount'),
              ),
              TextField(
                controller: description,
                maxLength: 180,
                decoration: const InputDecoration(labelText: 'Description'),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Confirm expense'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
      final parsedAmount = double.tryParse(amount.text.trim());
      if (parsedAmount == null || !parsedAmount.isFinite || parsedAmount <= 0) {
        throw const FormatException('Enter a positive expense amount.');
      }
      final dueOn =
          DateTime.tryParse(instance['due_on']?.toString() ?? '') ??
          DateTime.now();
      await widget.repository.confirmRecurringExpense(
        widget.user,
        instanceId: instance['id'].toString(),
        amount: parsedAmount,
        incurredOn: dueOn,
        description: description.text,
      );
      _refresh();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Recurring expense confirmation failed: $error'),
          ),
        );
      }
    } finally {
      amount.dispose();
      description.dispose();
    }
  }

  Future<void> _skipRecurringExpense(Map<String, dynamic> instance) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Skip this reminder?'),
        content: const Text(
          'This reminder will not be recorded as an expense.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Skip reminder'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.repository.skipRecurringExpense(
        widget.user,
        instance['id'].toString(),
      );
      _refresh();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not skip reminder: $error')),
        );
      }
    }
  }

  Widget _summary(BuildContext context, Map<String, dynamic> data) {
    final theme = Theme.of(context);
    final currency = NumberFormat.currency(name: widget.user.currency);
    final transactions = _records(data['transactions']);
    final expenses = _records(data['expenses']);
    final losses = _records(data['losses']);
    var revenue = 0.0;
    var cost = 0.0;
    var grossProfit = 0.0;
    var nonCreditGrossProfit = 0.0;
    final branchTotals = <String, _FinanceTotals>{};
    final productTotals = <String, _FinanceTotals>{};

    for (final transaction in transactions) {
      final branch = _nested(transaction['branches']);
      final branchName = branch?['name']?.toString() ?? 'Branch';
      final totals = branchTotals.putIfAbsent(branchName, _FinanceTotals.new);
      for (final item in _records(transaction['transaction_items'])) {
        final itemRevenue = item['net_line_total'] == null
            ? _number(item['line_total']) -
                  _number(item['line_discount_amount'])
            : _number(item['net_line_total']);
        final itemCost = _number(item['line_cost']);
        final itemProfit = item['gross_profit'] == null
            ? itemRevenue - itemCost
            : _number(item['gross_profit']);
        revenue += itemRevenue;
        cost += itemCost;
        grossProfit += itemProfit;
        if (transaction['is_credit_sale'] != true) {
          nonCreditGrossProfit += itemProfit;
        }
        totals
          ..revenue += itemRevenue
          ..cost += itemCost
          ..profit += itemProfit;
        final product = _nested(item['products']);
        final productName = product?['name']?.toString() ?? 'Product';
        final productTotalsForName = productTotals.putIfAbsent(
          productName,
          _FinanceTotals.new,
        );
        productTotalsForName
          ..revenue += itemRevenue
          ..cost += itemCost
          ..profit += itemProfit;
      }
    }

    final operatingExpenses = expenses.fold<double>(
      0,
      (total, row) => total + _number(row['amount']),
    );
    final netLosses = losses.fold<double>(
      0,
      (total, row) => total + _number(row['net_loss']),
    );
    final netProfit = grossProfit - operatingExpenses - netLosses;
    final nonCreditNetProfit =
        nonCreditGrossProfit - operatingExpenses - netLosses;
    final grossMargin = revenue == 0 ? 0.0 : grossProfit / revenue;
    final netMargin = revenue == 0 ? 0.0 : netProfit / revenue;
    final sortedBranches = branchTotals.entries.toList()
      ..sort((a, b) => b.value.profit.compareTo(a.value.profit));
    final sortedProducts = productTotals.entries.toList()
      ..sort((a, b) => b.value.profit.compareTo(a.value.profit));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: [
            _MetricCard(label: 'Revenue', value: currency.format(revenue)),
            _MetricCard(
              label: 'Cost of goods sold',
              value: currency.format(cost),
            ),
            _MetricCard(
              label: 'Gross profit',
              value: currency.format(grossProfit),
            ),
            _MetricCard(
              label: 'Net profit',
              value: currency.format(netProfit),
              detail: '${(netMargin * 100).toStringAsFixed(1)}% net margin',
            ),
            _MetricCard(
              label: 'Net profit excluding credit sales',
              value: currency.format(nonCreditNetProfit),
              detail: 'Only fully paid sales, less expenses and losses',
            ),
            _MetricCard(
              label: 'Operating expenses',
              value: currency.format(operatingExpenses),
            ),
            _MetricCard(
              label: 'Net inventory loss',
              value: currency.format(netLosses),
            ),
            _MetricCard(
              label: 'Gross margin',
              value: '${(grossMargin * 100).toStringAsFixed(1)}%',
            ),
            _MetricCard(
              label: 'Verified sales',
              value: '${transactions.length}',
              detail: 'Maximum 500 transactions in this view',
            ),
            _MetricCard(
              label: 'Total lent (outstanding)',
              value: currency.format(_number(data['total_lent'])),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if ((data['payment_methods'] as Map?)?.isNotEmpty == true)
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Wrap(
                spacing: 10,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text('Payments by method', style: theme.textTheme.titleSmall),
                  for (final entry in (data['payment_methods'] as Map).entries)
                    Chip(
                      avatar: Icon(
                        entry.key.toString() == 'cash'
                            ? Icons.payments_outlined
                            : entry.key.toString().contains('mpesa')
                            ? Icons.phone_android_rounded
                            : Icons.account_balance_outlined,
                        size: 16,
                      ),
                      label: Text(
                        '${entry.key.toString().replaceAll('_', ' ')}  ${currency.format(_number(entry.value))}',
                      ),
                      visualDensity: VisualDensity.compact,
                    ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 12),
        _responsivePair(
          _financeTableCard(
            'Branch performance',
            const ['Branch', 'Revenue', 'Cost', 'Gross profit'],
            sortedBranches
                .map(
                  (entry) => [
                    entry.key,
                    currency.format(entry.value.revenue),
                    currency.format(entry.value.cost),
                    currency.format(entry.value.profit),
                  ],
                )
                .toList(),
            'No verified sales in this period.',
          ),
          _financeTableCard(
            'Product performance',
            const ['Product', 'Revenue', 'Cost', 'Gross profit'],
            sortedProducts
                .take(10)
                .map(
                  (entry) => [
                    entry.key,
                    currency.format(entry.value.revenue),
                    currency.format(entry.value.cost),
                    currency.format(entry.value.profit),
                  ],
                )
                .toList(),
            'No product sales in this period.',
          ),
        ),
        const SizedBox(height: 12),
        _responsivePair(
          _financeTableCard(
            'Operating expenses',
            const ['Date', 'Branch', 'Category', 'Description', 'Amount'],
            expenses
                .take(8)
                .map(
                  (row) => [
                    _date(row['incurred_on']),
                    _nested(row['branches'])?['name']?.toString() ??
                        (row['branch_id'] == null ? 'Business-wide' : 'Branch'),
                    row['category']?.toString() ?? '—',
                    row['description']?.toString() ?? '—',
                    currency.format(_number(row['amount'])),
                  ],
                )
                .toList(),
            'No expenses recorded in this period.',
          ),
          _financeTableCard(
            'Inventory losses',
            const ['Date', 'Branch', 'Product', 'Type', 'Reason', 'Net loss'],
            losses
                .take(8)
                .map(
                  (row) => [
                    _date(row['created_at']),
                    _nested(row['branches'])?['name']?.toString() ?? 'Branch',
                    _nested(row['products'])?['name']?.toString() ?? 'Product',
                    (row['loss_type']?.toString() ?? '—').replaceAll('_', ' '),
                    row['reason']?.toString() ?? '—',
                    currency.format(_number(row['net_loss'])),
                  ],
                )
                .toList(),
            'No inventory losses recorded in this period.',
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'Calculations follow verified sales and stamped transaction-item costs. Supplier intake costs, cash deposit reconciliation, and recurring expense instances are not included in this desktop view yet.',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }

  Widget _financeTableCard(
    String title,
    List<String> columns,
    List<List<String>> rows,
    String emptyMessage,
  ) => Card(
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          _table(columns, rows, emptyMessage),
        ],
      ),
    ),
  );

  Widget _table(
    List<String> columns,
    List<List<String>> rows,
    String emptyMessage,
  ) {
    if (rows.isEmpty) return _EmptyMessage(emptyMessage);
    return SingleChildScrollView(
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
    );
  }

  List<Map<String, dynamic>> _records(Object? value) {
    if (value is! List) return const [];
    return value.whereType<Map<String, dynamic>>().toList();
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

  String _date(Object? value) {
    final date = DateTime.tryParse(value?.toString() ?? '');
    return date == null ? 'â€”' : DateFormat.yMMMd().format(date.toLocal());
  }

  String _periodLabel(String period) => switch (period) {
    'week' => 'This week',
    'month' => 'This month',
    _ => 'Today',
  };
}

class _FinanceTotals {
  double revenue = 0;
  double cost = 0;
  double profit = 0;
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.label, required this.value, this.detail});

  final String label;
  final String value;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final normalized = label.toLowerCase();
    final (icon, color) = switch (normalized) {
      final value when value.contains('loss') => (
        Icons.warning_amber_rounded,
        RetivoxTheme.danger,
      ),
      final value when value.contains('expense') || value.contains('cost') => (
        Icons.receipt_long_rounded,
        RetivoxTheme.accent,
      ),
      final value when value.contains('lent') => (
        Icons.account_balance_wallet_rounded,
        const Color(0xFFB7791F),
      ),
      final value when value.contains('revenue') => (
        Icons.payments_rounded,
        RetivoxTheme.success,
      ),
      final value when value.contains('profit') => (
        Icons.trending_up_rounded,
        RetivoxTheme.primaryLightMode,
      ),
      final value when value.contains('margin') => (
        Icons.pie_chart_rounded,
        const Color(0xFF7C3AED),
      ),
      _ => (Icons.analytics_rounded, const Color(0xFF2563EB)),
    };
    final isDark = theme.brightness == Brightness.dark;
    final viewportWidth = MediaQuery.sizeOf(context).width;
    return SizedBox(
      width: viewportWidth < 520 ? viewportWidth - 56 : 232,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: IntrinsicHeight(
          child: Row(
            children: [
              Container(width: 4, color: color),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(15),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              label,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.bodyMedium,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Container(
                            width: 32,
                            height: 32,
                            decoration: BoxDecoration(
                              color: color.withValues(
                                alpha: isDark ? 0.2 : 0.12,
                              ),
                              borderRadius: BorderRadius.circular(9),
                            ),
                            child: Icon(icon, size: 17, color: color),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Text(
                        value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontSize: 19,
                          color: color,
                        ),
                      ),
                      if (detail != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          detail!,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyMessage extends StatelessWidget {
  const _EmptyMessage(this.message);

  final String message;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 20),
    child: Text(message),
  );
}
