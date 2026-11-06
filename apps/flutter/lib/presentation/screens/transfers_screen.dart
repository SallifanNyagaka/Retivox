import 'package:flutter/material.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';
import 'transfer_initiate_dialog.dart';

class TransfersScreen extends StatefulWidget {
  const TransfersScreen({
    required this.user,
    required this.repository,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;

  @override
  State<TransfersScreen> createState() => _TransfersScreenState();
}

class _TransfersScreenState extends State<TransfersScreen> {
  static const _statuses = [
    'all',
    'initiated',
    'in_transit',
    'partially_received',
    'received',
    'disputed',
  ];
  late Future<DashboardSnapshot> _snapshot;
  late Future<TransferOptionsSnapshot> _options;
  String _status = 'all';
  String _search = '';

  @override
  void initState() {
    super.initState();
    _snapshot = widget.repository.loadSection(widget.user, 'transfers');
    _options = widget.repository.loadTransferOptions(widget.user);
  }

  void _refresh() {
    setState(() {
      _snapshot = widget.repository.loadSection(widget.user, 'transfers');
      _options = widget.repository.loadTransferOptions(widget.user);
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
                      Text('Transfers', style: theme.textTheme.headlineSmall),
                      const SizedBox(height: 6),
                      Text(
                        'Track stock movements between branches you manage.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                FutureBuilder<TransferOptionsSnapshot>(
                  future: _options,
                  builder: (context, options) => FilledButton.icon(
                    onPressed:
                        options.hasData &&
                            !options.data!.isCached &&
                            options.data!.branches.length > 1
                        ? () => _startTransfer(options.data!)
                        : null,
                    icon: const Icon(Icons.add),
                    label: const Text('New transfer'),
                  ),
                ),
                const SizedBox(width: 8),
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
              const SizedBox(height: 14),
              _readOnlyNotice(context),
              const SizedBox(height: 16),
              _summaryCards(result.data!.rows),
              const SizedBox(height: 18),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final status in _statuses)
                    ChoiceChip(
                      label: Text(_statusLabel(status)),
                      selected: _status == status,
                      onSelected: (_) => setState(() => _status = status),
                    ),
                ],
              ),
              const SizedBox(height: 14),
              SizedBox(
                width: 420,
                child: TextField(
                  onChanged: (value) => setState(() => _search = value),
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search),
                    labelText: 'Search branches, products, or people',
                    isDense: true,
                  ),
                ),
              ),
              const SizedBox(height: 14),
              _history(
                context,
                _filter(result.data!.rows),
                actionsEnabled: !result.data!.isCached,
              ),
              const SizedBox(height: 8),
              Text(
                'Showing up to the latest 50 transfers.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        );
      },
    );
  }

  Widget _cacheLabel(DashboardSnapshot snapshot) {
    final updatedAt = snapshot.updatedAt?.toLocal();
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
              ? 'Showing saved data${updatedAt == null ? '' : ' · last refreshed ${updatedAt.toString().substring(0, 16)}'}'
              : 'Showing latest data${updatedAt == null ? '' : ' · refreshed ${updatedAt.toString().substring(0, 16)}'}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }

  Widget _readOnlyNotice(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      color: theme.colorScheme.surfaceContainerHigh,
      child: const Padding(
        padding: EdgeInsets.all(14),
        child: Text(
          'Creating a transfer reserves stock, so it requires an online connection. Approvals and receipt confirmations also run online and are validated by the server.',
        ),
      ),
    );
  }

  Future<void> _startTransfer(TransferOptionsSnapshot options) async {
    final created = await showDialog<bool>(
      context: context,
      builder: (context) => TransferInitiateDialog(
        user: widget.user,
        repository: widget.repository,
        options: options,
      ),
    );
    if (created == true) {
      _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Transfer initiated successfully.')),
        );
      }
    }
  }

  Widget _summaryCards(List<Map<String, dynamic>> rows) {
    int count(String status) =>
        rows.where((row) => row['status']?.toString() == status).length;
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        _MetricCard(label: 'Total transfers', value: '${rows.length}'),
        _MetricCard(label: 'In transit', value: '${count('in_transit')}'),
        _MetricCard(label: 'Completed', value: '${count('received')}'),
        _MetricCard(label: 'Disputed', value: '${count('disputed')}'),
      ],
    );
  }

  List<Map<String, dynamic>> _filter(List<Map<String, dynamic>> rows) {
    final query = _search.trim().toLowerCase();
    return rows.where((row) {
      if (_status != 'all' && row['status']?.toString() != _status) {
        return false;
      }
      if (query.isEmpty) return true;
      final itemRows = row['items'] is List
          ? (row['items'] as List).whereType<Map<String, dynamic>>()
          : const <Map<String, dynamic>>[];
      final searchable = [
        row['from_branch_name'],
        row['to_branch_name'],
        row['initiated_by_name'],
        row['received_by_name'],
        row['status'],
        row['notes'],
        ...itemRows.expand((item) {
          final product = _nested(item['products']);
          return [product?['name'], product?['sku']];
        }),
      ];
      return searchable.any(
        (value) => value?.toString().toLowerCase().contains(query) ?? false,
      );
    }).toList();
  }

  Widget _history(
    BuildContext context,
    List<Map<String, dynamic>> rows, {
    required bool actionsEnabled,
  }) {
    if (rows.isEmpty) {
      return const Card(
        child: ListTile(
          leading: Icon(Icons.swap_horiz_outlined),
          title: Text('No transfers found'),
          subtitle: Text('Try another status or search while connected.'),
        ),
      );
    }
    return Card(
      clipBehavior: Clip.antiAlias,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          showCheckboxColumn: false,
          columns: const [
            DataColumn(label: Text('From')),
            DataColumn(label: Text('To')),
            DataColumn(label: Text('Items')),
            DataColumn(label: Text('Initiated by')),
            DataColumn(label: Text('Date')),
            DataColumn(label: Text('Status')),
            DataColumn(label: Text('Actions')),
            DataColumn(label: Text('Details')),
          ],
          rows: rows.map((row) {
            final itemCount = row['items'] is List
                ? (row['items'] as List).length
                : 0;
            final date = DateTime.tryParse(
              row['initiated_at']?.toString() ?? '',
            );
            final status = row['status']?.toString() ?? '';
            final canApprove =
                actionsEnabled &&
                widget.user.role == RetivoxRole.owner &&
                status == 'initiated';
            final canReceive =
                actionsEnabled &&
                (widget.user.role == RetivoxRole.owner ||
                    widget.user.role == RetivoxRole.admin) &&
                status == 'in_transit' &&
                widget.user.branches.any(
                  (branch) =>
                      branch.id == row['to_branch_id']?.toString() &&
                      (branch.role == 'admin' || branch.role == 'owner'),
                );
            return DataRow(
              onSelectChanged: (_) => showDialog<void>(
                context: context,
                builder: (context) => _TransferDetailsDialog(transfer: row),
              ),
              cells: [
                DataCell(Text(row['from_branch_name']?.toString() ?? 'Branch')),
                DataCell(Text(row['to_branch_name']?.toString() ?? 'Branch')),
                DataCell(Text('$itemCount')),
                DataCell(
                  Text(row['initiated_by_name']?.toString() ?? 'Team member'),
                ),
                DataCell(
                  Text(date?.toLocal().toString().substring(0, 10) ?? '—'),
                ),
                DataCell(Text(_statusLabel(row['status']?.toString() ?? ''))),
                DataCell(
                  canApprove || canReceive
                      ? TextButton(
                          onPressed: () =>
                              _confirmTransferAction(row, approve: canApprove),
                          child: Text(canApprove ? 'Approve' : 'Mark received'),
                        )
                      : const Text('—'),
                ),
                const DataCell(Icon(Icons.open_in_new, size: 18)),
              ],
            );
          }).toList(),
        ),
      ),
    );
  }

  Future<void> _confirmTransferAction(
    Map<String, dynamic> transfer, {
    required bool approve,
  }) async {
    final transferId = transfer['id']?.toString();
    if (transferId == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(approve ? 'Approve transfer?' : 'Mark transfer received?'),
        content: Text(
          approve ? 'This will move the transfer into transit.' : 'Confirm that the stock arrived. This updates inventory at both branches.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      if (approve) {
        await widget.repository.approveTransfer(widget.user, transferId);
      } else {
        await widget.repository.receiveTransfer(widget.user, transferId);
      }
      _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              approve ? 'Transfer approved.' : 'Transfer marked received.',
            ),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Transfer action failed: $error')),
        );
      }
    }
  }

  String _statusLabel(String status) => switch (status) {
    'all' => 'All',
    'in_transit' => 'In Transit',
    'partially_received' => 'Partially received',
    '' => 'Unknown',
    _ => status[0].toUpperCase() + status.substring(1),
  };

  Map<String, dynamic>? _nested(Object? value) {
    if (value is Map<String, dynamic>) return value;
    if (value is List &&
        value.isNotEmpty &&
        value.first is Map<String, dynamic>) {
      return value.first as Map<String, dynamic>;
    }
    return null;
  }
}

class _TransferDetailsDialog extends StatelessWidget {
  const _TransferDetailsDialog({required this.transfer});

  final Map<String, dynamic> transfer;

  @override
  Widget build(BuildContext context) {
    final items = transfer['items'] is List
        ? (transfer['items'] as List).whereType<Map<String, dynamic>>().toList()
        : const <Map<String, dynamic>>[];
    final theme = Theme.of(context);
    final initiatedAt = DateTime.tryParse(
      transfer['initiated_at']?.toString() ?? '',
    );
    final receivedAt = DateTime.tryParse(
      transfer['received_at']?.toString() ?? '',
    );
    return AlertDialog(
      title: const Text('Transfer details'),
      content: SizedBox(
        width: 620,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _detail('From', transfer['from_branch_name']?.toString()),
              _detail('To', transfer['to_branch_name']?.toString()),
              _detail('Status', transfer['status']?.toString()),
              _detail(
                'Initiated by',
                transfer['initiated_by_name']?.toString(),
              ),
              _detail('Initiated', initiatedAt?.toLocal().toString()),
              _detail('Received by', transfer['received_by_name']?.toString()),
              _detail('Received', receivedAt?.toLocal().toString()),
              _detail('Notes', transfer['notes']?.toString()),
              const SizedBox(height: 16),
              Text('Items', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              if (items.isEmpty)
                const Text('No line items are available.')
              else
                for (final item in items) _item(item),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Close'),
        ),
      ],
    );
  }

  Widget _detail(String label, String? value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 125, child: Text(label)),
        Expanded(
          child: SelectableText(
            value?.trim().isNotEmpty == true ? value! : '—',
          ),
        ),
      ],
    ),
  );

  Widget _item(Map<String, dynamic> item) {
    final product = _nested(item['products']);
    final unit = _nested(item['units_of_measure']);
    final sent = item['base_quantity_sent'] ?? item['quantity_sent'] ?? 0;
    final received =
        item['base_quantity_received'] ?? item['quantity_received'];
    final quantityInUom = item['quantity_in_uom'];
    final unitName = unit?['abbreviation'] ?? unit?['name'];
    final productName = product?['name']?.toString() ?? 'Product';
    final sku = product?['sku'];
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text('$productName${sku == null ? '' : ' · $sku'}'),
      subtitle: Text(
        'Sent: ${_quantity(quantityInUom ?? sent)}${unitName == null ? '' : ' $unitName'}'
        '${received == null ? '' : ' · Received: ${_quantity(received)} base units'}'
        '${item['quantity_discrepancy'] == null ? '' : ' · Discrepancy: ${_quantity(item['quantity_discrepancy'])}'}',
      ),
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

  String _quantity(Object? value) {
    final number = double.tryParse(value?.toString() ?? '');
    if (number == null || !number.isFinite) return value?.toString() ?? '—';
    return number == number.roundToDouble()
        ? number.toInt().toString()
        : number
              .toStringAsFixed(4)
              .replaceFirst(RegExp(r'0+$'), '')
              .replaceFirst(RegExp(r'\.$'), '');
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
