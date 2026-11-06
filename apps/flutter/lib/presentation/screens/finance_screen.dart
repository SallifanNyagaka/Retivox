import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';
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
                    ' · ${report['quantity_in_uom'] ?? '—'} ${report['uom_name'] ?? ''}',
                  ),
                  subtitle: Text(
                    '${report['branch_name'] ?? 'Branch'}'
                    ' · ${report['reporter_name'] ?? 'Team member'}'
                    ' · ${(report['loss_type']?.toString() ?? 'other').replaceAll('_', ' ')}'
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
                      '${report['branch_name'] ?? 'Branch'} · '
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

  static const _periods = ['today', 'week', 'month'];
  String _period = 'today';
  String _branchId = '';
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
      builder: (context, result) => ListView(
        padding: const EdgeInsets.all(28),
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
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
                ),
              ),
              if (widget.user.role == RetivoxRole.owner && result.hasData)
                Wrap(
                  spacing: 8,
                  children: [
                    FilledButton.icon(
                      onPressed:
                          result.connectionState == ConnectionState.waiting
                          ? null
                          : () => _showExpenseDialog(result.data!.rows.single),
                      icon: const Icon(Icons.add),
                      label: const Text('Record expense'),
                    ),
                    OutlinedButton.icon(
                      onPressed:
                          result.connectionState == ConnectionState.waiting
                          ? null
                          : _showInventoryLossDialog,
                      icon: const Icon(Icons.warning_amber_outlined),
                      label: const Text('Record inventory loss'),
                    ),
                    OutlinedButton.icon(
                      onPressed:
                          result.connectionState == ConnectionState.waiting
                          ? null
                          : _showCashDepositDialog,
                      icon: const Icon(Icons.account_balance_outlined),
                      label: const Text('Record cash deposit'),
                    ),
                  ],
                ),
              IconButton(
                tooltip: 'Refresh from server',
                onPressed: result.connectionState == ConnectionState.waiting
                    ? null
                    : _refresh,
                icon: const Icon(Icons.refresh),
              ),
            ],
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
            _pendingDamageReports(context, result.data!.rows.single),
            const SizedBox(height: 14),
            _cashDeposits(context, result.data!.rows.single),
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
            const SizedBox(height: 16),
            _summary(context, result.data!.rows.single),
          ],
        ],
      ),
    );
  }

  Widget _branchSelector(DashboardSnapshot snapshot) {
    final summary = snapshot.rows.single;
    final branches = _records(summary['branches']);
    return Align(
      alignment: Alignment.centerLeft,
      child: SizedBox(
        width: 320,
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
                ? 'Showing saved ${_periodLabel(_period).toLowerCase()} data${timestamp == null ? '' : ' · last refreshed ${DateFormat.yMMMd().add_jm().format(timestamp)}'}'
                : 'Showing latest ${_periodLabel(_period).toLowerCase()} data${timestamp == null ? '' : ' · refreshed ${DateFormat.yMMMd().add_jm().format(timestamp)}'}',
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
                    ' · ${_date(deposit['deposit_date'])}'
                    ' · ${currency.format(_number(deposit['amount']))}',
                  ),
                  subtitle: Text(
                    'Reference: ${deposit['deposit_reference'] ?? '—'}'
                    ' · Expected: ${currency.format(_number(deposit['expected_cash_amount']))}'
                    ' · Variance: ${currency.format(_number(deposit['variance_amount']))}'
                    '\n${deposit['status'] ?? 'pending'}'
                    '${deposit['review_note'] == null ? '' : ' · ${deposit['review_note']}'}',
                  ),
                  isThreeLine: true,
                  trailing: deposit['status'] == 'pending'
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
                    ' · Day ${template['due_day']}'
                    ' · ${currency.format(_number(template['default_amount']))}'
                    ' · ${template['is_active'] == true ? 'Active' : 'Paused'}',
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
                    ' · ${currency.format(_number(instance['amount']))}',
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
          ],
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Branch performance', style: theme.textTheme.titleMedium),
                const SizedBox(height: 10),
                _table(
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
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Product performance', style: theme.textTheme.titleMedium),
                const SizedBox(height: 10),
                _table(
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
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Operating expenses', style: theme.textTheme.titleMedium),
                const SizedBox(height: 10),
                _table(
                  const ['Date', 'Branch', 'Category', 'Description', 'Amount'],
                  expenses
                      .take(8)
                      .map(
                        (row) => [
                          _date(row['incurred_on']),
                          _nested(row['branches'])?['name']?.toString() ??
                              (row['branch_id'] == null
                                  ? 'Business-wide'
                                  : 'Branch'),
                          row['category']?.toString() ?? '—',
                          row['description']?.toString() ?? '—',
                          currency.format(_number(row['amount'])),
                        ],
                      )
                      .toList(),
                  'No expenses recorded in this period.',
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Inventory losses', style: theme.textTheme.titleMedium),
                const SizedBox(height: 10),
                _table(
                  const [
                    'Date',
                    'Branch',
                    'Product',
                    'Type',
                    'Reason',
                    'Net loss',
                  ],
                  losses
                      .take(8)
                      .map(
                        (row) => [
                          _date(row['created_at']),
                          _nested(row['branches'])?['name']?.toString() ??
                              'Branch',
                          _nested(row['products'])?['name']?.toString() ??
                              'Product',
                          (row['loss_type']?.toString() ?? '—').replaceAll(
                            '_',
                            ' ',
                          ),
                          row['reason']?.toString() ?? '—',
                          currency.format(_number(row['net_loss'])),
                        ],
                      )
                      .toList(),
                  'No inventory losses recorded in this period.',
                ),
              ],
            ),
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
    return date == null ? '—' : DateFormat.yMMMd().format(date.toLocal());
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
  Widget build(BuildContext context) => SizedBox(
    width: 220,
    child: Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 6),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            if (detail != null) ...[
              const SizedBox(height: 4),
              Text(detail!, style: Theme.of(context).textTheme.bodySmall),
            ],
          ],
        ),
      ),
    ),
  );
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
