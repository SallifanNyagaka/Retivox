import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';

class AnalyticsScreen extends StatefulWidget {
  const AnalyticsScreen({
    required this.user,
    required this.repository,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;

  @override
  State<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends State<AnalyticsScreen> {
  static const _ranges = [7, 30, 90];
  int _rangeDays = 30;
  late Future<DashboardSnapshot> _snapshot;

  @override
  void initState() {
    super.initState();
    _snapshot = _load();
  }

  Future<DashboardSnapshot> _load() =>
      widget.repository.loadAnalytics(widget.user, rangeDays: _rangeDays);

  void _refresh() {
    setState(() => _snapshot = _load());
  }

  void _selectRange(int days) {
    setState(() {
      _rangeDays = days;
      _snapshot = _load();
    });
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
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Analytics', style: theme.textTheme.headlineSmall),
                      const SizedBox(height: 6),
                      Text(
                        'Revenue and performance across all branches',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
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
            const SizedBox(height: 18),
            Wrap(
              spacing: 8,
              children: [
                for (final days in _ranges)
                  ChoiceChip(
                    label: Text('Last $days days'),
                    selected: _rangeDays == days,
                    onSelected: (_) => _selectRange(days),
                  ),
              ],
            ),
            const SizedBox(height: 18),
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
            else
              _content(context, result.data!),
          ],
        );
      },
    );
  }

  Widget _content(BuildContext context, DashboardSnapshot snapshot) {
    final theme = Theme.of(context);
    final summary = snapshot.rows.single;
    final revenueByDay = _records(summary['revenueByDay']);
    final revenueByBranch = _records(summary['revenueByBranch']);
    final topProducts = _records(summary['topProducts']);
    final paymentMethods = _records(summary['paymentMethods']);
    final transactionCount = _number(summary['transactionCount']).toInt();
    final totalRevenue = revenueByBranch.fold<double>(
      0,
      (total, branch) => total + _number(branch['total']),
    );
    final averageOrderValue = transactionCount == 0
        ? 0.0
        : totalRevenue / transactionCount;
    final bestBranch = revenueByBranch.isEmpty
        ? '—'
        : _text(revenueByBranch.first['branchName'], fallback: '—');
    final paymentTotal = paymentMethods.fold<double>(
      0,
      (total, method) => total + _number(method['total']),
    );
    final currency = NumberFormat.currency(name: widget.user.currency);
    final timestamp = snapshot.updatedAt?.toLocal();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Icon(
              snapshot.isCached
                  ? Icons.storage_outlined
                  : Icons.cloud_done_outlined,
              size: 17,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                snapshot.isCached
                    ? 'Showing saved analytics${timestamp == null ? '' : ' · last refreshed ${DateFormat.yMMMd().add_jm().format(timestamp)}'}'
                    : 'Showing latest analytics${timestamp == null ? '' : ' · refreshed ${DateFormat.yMMMd().add_jm().format(timestamp)}'}',
                style: theme.textTheme.bodySmall,
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 16,
          runSpacing: 16,
          children: [
            _MetricCard(
              label: 'Total revenue',
              value: currency.format(totalRevenue),
            ),
            _MetricCard(
              label: 'Total transactions',
              value: '$transactionCount',
            ),
            _MetricCard(
              label: 'Average order value',
              value: currency.format(averageOrderValue),
            ),
            _MetricCard(label: 'Best performing branch', value: bestBranch),
          ],
        ),
        const SizedBox(height: 16),
        LayoutBuilder(
          builder: (context, constraints) {
            final width = constraints.maxWidth >= 1180
                ? (constraints.maxWidth - 16) / 2
                : constraints.maxWidth;
            return Wrap(
              spacing: 16,
              runSpacing: 16,
              children: [
                SizedBox(
                  width: width,
                  child: _DataCard(
                    title: 'Revenue trend',
                    child: _table(
                      headers: const ['Date', 'Revenue'],
                      rows: revenueByDay
                          .map(
                            (row) => [
                              _date(row['date']),
                              currency.format(_number(row['total'])),
                            ],
                          )
                          .toList(),
                      emptyMessage: 'No revenue recorded in this period.',
                    ),
                  ),
                ),
                SizedBox(
                  width: width,
                  child: _DataCard(
                    title: 'Top products',
                    child: _table(
                      headers: const ['Product', 'Quantity', 'Revenue'],
                      rows: topProducts
                          .map(
                            (row) => [
                              _text(row['productName'], fallback: 'Product'),
                              _text(row['totalQty'], fallback: '0'),
                              currency.format(_number(row['totalRevenue'])),
                            ],
                          )
                          .toList(),
                      emptyMessage: 'No product sales in this period.',
                    ),
                  ),
                ),
              ],
            );
          },
        ),
        const SizedBox(height: 16),
        _DataCard(
          title: 'Payment method breakdown',
          child: paymentMethods.isEmpty
              ? const _EmptyMessage('No payments in this period.')
              : Column(
                  children: [
                    for (final method in paymentMethods)
                      _PaymentMethodRow(
                        method: _text(method['method'], fallback: 'Unknown'),
                        count: _number(method['count']).toInt(),
                        total: _number(method['total']),
                        percent: paymentTotal == 0
                            ? 0
                            : _number(method['total']) / paymentTotal,
                        currency: currency,
                      ),
                  ],
                ),
        ),
        const SizedBox(height: 16),
        _DataCard(
          title: 'Branch performance',
          child: _table(
            headers: const ['Branch', 'Revenue', 'Rank'],
            rows: [
              for (var index = 0; index < revenueByBranch.length; index++)
                [
                  _text(
                    revenueByBranch[index]['branchName'],
                    fallback: 'Branch',
                  ),
                  currency.format(_number(revenueByBranch[index]['total'])),
                  _ordinal(index + 1),
                ],
            ],
            emptyMessage: 'No branch revenue in this period.',
          ),
        ),
      ],
    );
  }

  Widget _table({
    required List<String> headers,
    required List<List<String>> rows,
    required String emptyMessage,
  }) {
    if (rows.isEmpty) return _EmptyMessage(emptyMessage);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        columns: headers
            .map((header) => DataColumn(label: Text(header)))
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

  double _number(Object? value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString() ?? '') ?? 0;
  }

  String _text(Object? value, {required String fallback}) {
    final text = value?.toString().trim();
    return text == null || text.isEmpty ? fallback : text;
  }

  String _date(Object? value) {
    final parsed = DateTime.tryParse(value?.toString() ?? '');
    return parsed == null ? '—' : DateFormat.MMMd().format(parsed.toLocal());
  }

  String _ordinal(int rank) => switch (rank) {
    1 => '1st',
    2 => '2nd',
    3 => '3rd',
    _ => '${rank}th',
  };
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      width: 230,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DataCard extends StatelessWidget {
  const _DataCard({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              title,
              style: Theme.of(context).textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

class _PaymentMethodRow extends StatelessWidget {
  const _PaymentMethodRow({
    required this.method,
    required this.count,
    required this.total,
    required this.percent,
    required this.currency,
  });

  final String method;
  final int count;
  final double total;
  final double percent;
  final NumberFormat currency;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(method, style: theme.textTheme.bodyMedium),
                    Text(
                      '$count transactions · ${currency.format(total)}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              Text('${(percent * 100).round()}%'),
            ],
          ),
          const SizedBox(height: 8),
          LinearProgressIndicator(value: percent.clamp(0, 1)),
        ],
      ),
    );
  }
}

class _EmptyMessage extends StatelessWidget {
  const _EmptyMessage(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 20),
      child: Text(
        message,
        style: Theme.of(context).textTheme.bodyMedium
            ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
      ),
    );
  }
}
