import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';
import '../models/overview_snapshot.dart';
import '../theme/retivox_theme.dart';
import 'retivox_card.dart';
import 'retivox_metric_card.dart';

class OverviewSection extends StatefulWidget {
  const OverviewSection({
    required this.user,
    required this.repository,
    this.refreshVersion = 0,
    this.onRefresh,
    this.onNavigate,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;
  final int refreshVersion;
  final Future<void> Function()? onRefresh;
  final ValueChanged<String>? onNavigate;

  @override
  State<OverviewSection> createState() => _OverviewSectionState();
}

class _OverviewSectionState extends State<OverviewSection> {
  OverviewSnapshot? _snapshot;
  bool _loading = true;
  String? _error;
  final _money = NumberFormat('#,##0.00', 'en_KE');
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    _refreshTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted && !_loading) unawaited(_load());
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant OverviewSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.refreshVersion != oldWidget.refreshVersion) {
      unawaited(_load());
    }
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = _snapshot == null;
        _error = null;
      });
    }
    try {
      final data = await widget.repository.loadOverview(widget.user);
      if (mounted) setState(() => _snapshot = data);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _refresh() async {
    await _load();
    await widget.onRefresh?.call();
  }

  String _amount(Object? value) => _money.format(_number(value));

  String? _timeText(Object? value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '');
    return parsed == null
        ? null
        : DateFormat('h:mm a').format(parsed.toLocal());
  }

  double _number(Object? value) => value is num
      ? value.toDouble()
      : double.tryParse(value?.toString() ?? '') ?? 0;

  String _name(Map<String, dynamic> row) =>
      row['name']?.toString() ??
      row['productName']?.toString() ??
      row['product_name']?.toString() ??
      row['sku']?.toString() ??
      'Item';

  Widget _rankedCard(
    String title,
    List<Map<String, dynamic>> rows, {
    required String emptyText,
    bool showCurrency = false,
    bool emphasize = false,
  }) {
    final theme = Theme.of(context);
    final muted = theme.brightness == Brightness.dark
        ? RetivoxTheme.textMutedDark
        : RetivoxTheme.textMutedLight;
    return RetivoxCard(
      padding: RetivoxCardPadding.md,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          RetivoxCardHeader(title: title),
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(emptyText, style: TextStyle(color: muted)),
            )
          else
            for (final row in rows.take(5)) ...[
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 7),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        _name(row),
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontWeight: emphasize
                              ? FontWeight.w600
                              : FontWeight.w500,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      _rankValue(row, showCurrency: showCurrency),
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
              if (row != rows.take(5).last) const Divider(height: 1),
            ],
        ],
      ),
    );
  }

  String _rankValue(Map<String, dynamic> row, {required bool showCurrency}) {
    if (showCurrency) {
      final value = row['sales'] ?? row['revenue'] ?? row['totalSales'] ?? 0;
      return '${widget.user.currency} ${_amount(value)}';
    }
    final quantity = row['qty'] ?? row['quantity'] ?? row['base_quantity'];
    if (quantity != null) return '${_number(quantity).toStringAsFixed(0)} sold';
    final transactions = row['transactions'] ?? row['transactionCount'];
    if (transactions != null) return '$transactions transactions';
    return '${row['sales'] ?? row['count'] ?? 0} sales';
  }

  Widget _metricGrid(OverviewSnapshot overview) => LayoutBuilder(
    builder: (context, constraints) {
      final columns = constraints.maxWidth >= 1200
          ? 4
          : constraints.maxWidth >= 900
          ? 3
          : constraints.maxWidth >= 560
          ? 2
          : 1;
      final metrics = <Widget>[
        _metric(
          'Sales today',
          '${widget.user.currency} ${_amount(overview.totalSalesToday)}',
          Icons.payments_outlined,
        ),
        _metric(
          'Transactions today',
          '${overview.totalTransactionsToday}',
          Icons.receipt_long_outlined,
        ),
        _metric(
          'M-Pesa',
          '${overview.mpesaTransactions} · ${widget.user.currency} ${_amount(overview.mpesaSalesToday)}',
          Icons.phone_android_outlined,
        ),
        _metric(
          'Cash',
          '${overview.cashTransactions} · ${widget.user.currency} ${_amount(overview.cashSalesToday)}',
          Icons.payments_rounded,
        ),
        _metric(
          'Pending approvals',
          '${overview.pendingApprovals}',
          Icons.pending_actions_outlined,
          warning: overview.pendingApprovals > 0,
        ),
        _metric(
          'Low stock alerts',
          '${overview.stockAlerts.length}',
          Icons.inventory_2_outlined,
          warning: overview.stockAlerts.isNotEmpty,
        ),
      ];
      if (widget.user.role == RetivoxRole.owner) {
        metrics.addAll([
          _metric(
            'Net profit today',
            '${widget.user.currency} ${_amount(overview.totalProfitToday)}',
            Icons.trending_up_rounded,
          ),
          InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () => widget.onNavigate?.call('finances'),
            child: _metric(
              'Total lent (outstanding)',
              '${widget.user.currency} ${_amount(overview.totalLent)}',
              Icons.account_balance_wallet_outlined,
            ),
          ),
          _metric(
            'Losses today',
            '${widget.user.currency} ${_amount(overview.totalLosses)}',
            Icons.warning_amber_rounded,
            warning: overview.totalLosses > 0,
          ),
        ]);
        for (final entry in overview.paymentMethodsToday.entries) {
          metrics.add(
            _metric(
              entry.key.replaceAll('_', ' '),
              '${widget.user.currency} ${_amount(entry.value)}',
              Icons.payments_outlined,
            ),
          );
        }
      } else {
        metrics.add(
          _metric(
            'Your sales today',
            '${widget.user.currency} ${_amount(overview.mySalesToday)}',
            Icons.person_outline_rounded,
          ),
        );
        metrics.add(
          _metric(
            'Your transactions',
            '${overview.myTransactionsToday}',
            Icons.receipt_long_outlined,
          ),
        );
      }
      final cardWidth = (constraints.maxWidth - (columns - 1) * 12) / columns;
      return Wrap(
        spacing: 12,
        runSpacing: 12,
        children: [
          for (final metric in metrics)
            SizedBox(width: cardWidth, child: metric),
        ],
      );
    },
  );

  Widget _metric(
    String label,
    String value,
    IconData icon, {
    bool warning = false,
  }) {
    final normalized = label.toLowerCase();
    final accent = warning || normalized.contains('loss')
        ? RetivoxTheme.danger
        : normalized.contains('profit') || normalized.contains('cash')
        ? RetivoxTheme.success
        : normalized.contains('lent') || normalized.contains('mpesa')
        ? RetivoxTheme.accent
        : normalized.contains('stock')
        ? const Color(0xFF7C3AED)
        : const Color(0xFF2563EB);
    return RetivoxMetricCard(
      label: label,
      value: value,
      icon: Icon(icon, size: 18),
      accentColor: accent,
      valueColor: warning ? RetivoxTheme.danger : null,
      delta: warning ? 'Review needed' : null,
      deltaType: warning ? RetivoxDeltaType.down : RetivoxDeltaType.neutral,
    );
  }

  Widget _alerts(
    List<Map<String, dynamic>> alerts,
    List<Map<String, dynamic>> creditAlerts,
  ) {
    final theme = Theme.of(context);
    final muted = theme.brightness == Brightness.dark
        ? RetivoxTheme.textMutedDark
        : RetivoxTheme.textMutedLight;
    final today = DateTime.now();
    final todayDate = DateTime(today.year, today.month, today.day);
    final creditRows = creditAlerts.map((account) {
      final due = DateTime.tryParse(account['due_date']?.toString() ?? '');
      final daysLeft = due == null
          ? 0
          : DateTime(due.year, due.month, due.day).difference(todayDate).inDays;
      final balance = NumberFormat.currency(name: widget.user.currency)
          .format(_number(account['balance_due']));
      return <String, dynamic>{
        'severity': daysLeft < 0 ? 'high' : 'warning',
        'title': daysLeft < 0
            ? 'Credit payment overdue'
            : daysLeft == 0
            ? 'Credit payment due today'
            : 'Credit payment due in $daysLeft ${daysLeft == 1 ? 'day' : 'days'}',
        'description':
            '${account['customer_name'] ?? 'Customer'} · $balance outstanding',
        'branchName': account['branch_name'],
      };
    }).toList();
    final allAlerts = [...creditRows, ...alerts];
    return RetivoxCard(
      padding: RetivoxCardPadding.md,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          RetivoxCardHeader(
            title: 'Warnings and activity flags',
            subtitle: 'Items that may need a closer review',
          ),
          if (allAlerts.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'No flagged activity in the latest overview.',
                style: TextStyle(color: muted),
              ),
            )
          else
            for (final alert in allAlerts.take(8))
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                leading: Icon(
                  alert['severity']?.toString() == 'high'
                      ? Icons.error_outline_rounded
                      : Icons.warning_amber_rounded,
                  color: alert['severity']?.toString() == 'high'
                      ? RetivoxTheme.danger
                      : RetivoxTheme.accent,
                ),
                title: Text(alert['title']?.toString() ?? 'Review activity'),
                subtitle: Text(
                  [alert['description'], alert['branchName']]
                      .where(
                        (value) => value != null && value.toString().isNotEmpty,
                      )
                      .join(' · '),
                ),
              ),
        ],
      ),
    );
  }

  Widget _recentTransactions(List<Map<String, dynamic>> rows) {
    final theme = Theme.of(context);
    final muted = theme.brightness == Brightness.dark
        ? RetivoxTheme.textMutedDark
        : RetivoxTheme.textMutedLight;
    return RetivoxCard(
      padding: RetivoxCardPadding.md,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          RetivoxCardHeader(
            title: 'Recent transactions today',
            action: TextButton(
              onPressed: widget.onNavigate == null
                  ? null
                  : () => widget.onNavigate!('transactions'),
              child: const Text('View history'),
            ),
          ),
          if (rows.isEmpty)
            Text(
              'No transactions recorded today.',
              style: TextStyle(color: muted),
            )
          else
            for (final row in rows) ...[
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: Text(row['branchName']?.toString() ?? 'Branch'),
                subtitle: Text(
                  [
                        row['employeeName']?.toString(),
                        _timeText(row['recordedAt']),
                      ]
                      .whereType<String>()
                      .where((value) => value.isNotEmpty)
                      .join(' · '),
                ),
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '${widget.user.currency} ${_amount(row['amount'])}',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    Text(
                      row['status']?.toString() ?? '',
                      style: TextStyle(color: muted, fontSize: 11),
                    ),
                  ],
                ),
              ),
              if (row != rows.last) const Divider(height: 1),
            ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.brightness == Brightness.dark
        ? RetivoxTheme.textMutedDark
        : RetivoxTheme.textMutedLight;
    final snapshot = _snapshot;
    if (_loading && snapshot == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (snapshot == null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _error ?? 'Overview is not available.',
              style: TextStyle(color: muted),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _refresh,
              icon: const Icon(Icons.refresh),
              label: const Text('Try again'),
            ),
          ],
        ),
      );
    }

    final overview = snapshot;
    final updated = overview.updatedAt?.toLocal();
    final updatedLabel = updated == null
        ? 'Saved overview'
        : 'Updated ${DateFormat('MMM d, h:mm a').format(updated)}';
    final isOwner = widget.user.role == RetivoxRole.owner;
    final isAdmin = widget.user.role == RetivoxRole.admin;

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Business overview',
                      style: theme.textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      overview.isCached
                          ? '$updatedLabel · Offline snapshot'
                          : '$updatedLabel · ${overview.activeBranches} active branches',
                      style: TextStyle(color: muted),
                    ),
                  ],
                ),
              ),
              if (widget.onNavigate != null)
                FilledButton.icon(
                  onPressed: () => widget.onNavigate!('sales'),
                  icon: const Icon(Icons.add_shopping_cart_rounded),
                  label: const Text('New transaction'),
                ),
              IconButton(
                tooltip: 'Refresh overview',
                onPressed: _loading ? null : _refresh,
                icon: _loading
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.refresh_rounded),
              ),
            ],
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(
              'Showing the latest saved overview. $_error',
              style: TextStyle(color: muted),
            ),
          ],
          const SizedBox(height: 16),
          _metricGrid(overview),
          const SizedBox(height: 16),
          _alerts(overview.operationalAlerts, overview.creditDueAlerts),
          const SizedBox(height: 16),
          LayoutBuilder(
            builder: (context, constraints) {
              if (constraints.maxWidth < 760) {
                return Column(
                  children: [
                    _rankedCard(
                      'Best-selling items today',
                      overview.bestSellingItems,
                      emptyText: 'No item sales recorded today.',
                    ),
                    const SizedBox(height: 12),
                    _rankedCard(
                      'Lowest-selling items today',
                      overview.lowSellingItems,
                      emptyText: 'No low-selling items to show.',
                    ),
                  ],
                );
              }
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: _rankedCard(
                      'Best-selling items today',
                      overview.bestSellingItems,
                      emptyText: 'No item sales recorded today.',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _rankedCard(
                      'Lowest-selling items today',
                      overview.lowSellingItems,
                      emptyText: 'No low-selling items to show.',
                    ),
                  ),
                ],
              );
            },
          ),
          if (isOwner || isAdmin) ...[
            const SizedBox(height: 16),
            LayoutBuilder(
              builder: (context, constraints) {
                final cards = <Widget>[
                  _rankedCard(
                    'Best-performing stores',
                    overview.bestStores,
                    emptyText: 'No store performance data today.',
                    showCurrency: true,
                    emphasize: true,
                  ),
                  _rankedCard(
                    'Best-performing employees',
                    overview.bestEmployees,
                    emptyText: 'No employee sales data today.',
                    showCurrency: true,
                  ),
                  if (isOwner)
                    _rankedCard(
                      'Best-performing admins',
                      overview.bestAdmins,
                      emptyText: 'No admin sales data today.',
                      showCurrency: true,
                    ),
                ];
                if (constraints.maxWidth < 760) {
                  return Column(
                    children: [
                      for (var i = 0; i < cards.length; i++) ...[
                        cards[i],
                        if (i < cards.length - 1) const SizedBox(height: 12),
                      ],
                    ],
                  );
                }
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (var i = 0; i < cards.length; i++) ...[
                      Expanded(child: cards[i]),
                      if (i < cards.length - 1) const SizedBox(width: 12),
                    ],
                  ],
                );
              },
            ),
          ],
          const SizedBox(height: 16),
          _recentTransactions(overview.recentTransactions),
          const SizedBox(height: 16),
          _rankedCard(
            'Branch overview',
            overview.branchOverview,
            emptyText: 'No branch performance data today.',
            showCurrency: true,
          ),
          if (overview.stockAlerts.isNotEmpty) ...[
            const SizedBox(height: 16),
            _rankedCard(
              'Stock warnings',
              overview.stockAlerts,
              emptyText: 'No stock warnings.',
              emphasize: true,
            ),
          ],
        ],
      ),
    );
  }
}
