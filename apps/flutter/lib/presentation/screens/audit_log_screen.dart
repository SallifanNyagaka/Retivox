import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';

class AuditLogScreen extends StatefulWidget {
  const AuditLogScreen({
    required this.user,
    required this.repository,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;

  @override
  State<AuditLogScreen> createState() => _AuditLogScreenState();
}

class _AuditLogScreenState extends State<AuditLogScreen> {
  late Future<DashboardSnapshot> _snapshot;
  String _search = '';
  String _action = 'all';
  String _entityType = 'all';
  bool _loadingMore = false;
  bool _hasMore = true;
  Timer? _filterDebounce;
  int _historyRevision = 0;

  @override
  void initState() {
    super.initState();
    _snapshot = widget.repository.loadSection(widget.user, 'audit');
  }

  void _refresh() {
    _filterDebounce?.cancel();
    _historyRevision++;
    setState(() {
      _snapshot = _loadAuditHistory();
      _hasMore = true;
    });
  }

  Future<DashboardSnapshot> _loadAuditHistory({int offset = 0}) =>
      widget.repository.loadHistoryPage(
        widget.user,
        'audit',
        offset: offset,
        search: _search,
        action: _action,
        entityType: _entityType,
      );

  void _scheduleAuditFilterReload() {
    _filterDebounce?.cancel();
    _historyRevision++;
    _filterDebounce = Timer(const Duration(milliseconds: 350), () {
      if (!mounted) return;
      setState(() {
        _snapshot = _loadAuditHistory();
        _hasMore = true;
      });
    });
  }

  @override
  void dispose() {
    _filterDebounce?.cancel();
    super.dispose();
  }

  Future<void> _loadMore(DashboardSnapshot current) async {
    if (_loadingMore || !_hasMore || current.isCached) return;
    final revision = _historyRevision;
    setState(() => _loadingMore = true);
    try {
      final page = await _loadAuditHistory(offset: current.rows.length);
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
                    Text('Audit log', style: theme.textTheme.headlineSmall),
                    const SizedBox(height: 6),
                    Text(
                      'Review recorded business changes and their before-and-after values.',
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
          const SizedBox(height: 16),
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
            _cacheLabel(context, result.data!),
            const SizedBox(height: 14),
            Card(
              color: theme.colorScheme.surfaceContainerHigh,
              child: const Padding(
                padding: EdgeInsets.all(14),
                child: Text(
                  'Audit entries are read-only and encrypted in the local cache. Cached logs may include sensitive before-and-after values; sign out on shared devices.',
                ),
              ),
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                _MetricCard(
                  label: 'Loaded entries',
                  value: '${result.data!.rows.length}',
                ),
                _MetricCard(
                  label: 'Actors',
                  value:
                      '${result.data!.rows.map((row) => row['actor_id']).where((id) => id != null).toSet().length}',
                ),
                _MetricCard(
                  label: 'Actions',
                  value:
                      '${result.data!.rows.map((row) => row['action']).where((action) => action != null).toSet().length}',
                ),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: 420,
              child: TextField(
                onChanged: (value) {
                  setState(() => _search = value);
                  _scheduleAuditFilterReload();
                },
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  labelText: 'Search actor, action, or entity',
                  isDense: true,
                ),
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                SizedBox(
                  width: 240,
                  child: DropdownButtonFormField<String>(
                    initialValue: _action,
                    isDense: true,
                    decoration: const InputDecoration(
                      labelText: 'Action',
                      border: OutlineInputBorder(),
                    ),
                    items: [
                      const DropdownMenuItem(
                        value: 'all',
                        child: Text('All actions'),
                      ),
                      ..._distinctValues(result.data!.rows, 'action').map(
                        (value) => DropdownMenuItem(
                          value: value,
                          child: Text(value, overflow: TextOverflow.ellipsis),
                        ),
                      ),
                    ],
                    onChanged: (value) {
                      setState(() => _action = value ?? 'all');
                      _scheduleAuditFilterReload();
                    },
                  ),
                ),
                SizedBox(
                  width: 240,
                  child: DropdownButtonFormField<String>(
                    initialValue: _entityType,
                    isDense: true,
                    decoration: const InputDecoration(
                      labelText: 'Entity',
                      border: OutlineInputBorder(),
                    ),
                    items: [
                      const DropdownMenuItem(
                        value: 'all',
                        child: Text('All entities'),
                      ),
                      ..._distinctValues(result.data!.rows, 'entity_type').map(
                        (value) => DropdownMenuItem(
                          value: value,
                          child: Text(value, overflow: TextOverflow.ellipsis),
                        ),
                      ),
                    ],
                    onChanged: (value) {
                      setState(() => _entityType = value ?? 'all');
                      _scheduleAuditFilterReload();
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            _table(context, _filter(result.data!.rows)),
            if (result.data!.rows.length >= 200) ...[
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.center,
                child: OutlinedButton.icon(
                  onPressed: _loadingMore || !_hasMore || result.data!.isCached
                      ? null
                      : () => _loadMore(result.data!),
                  icon: _loadingMore
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.history),
                  label: Text(
                    result.data!.isCached
                        ? 'Connect to load older entries'
                        : _hasMore
                        ? 'Load older entries'
                        : 'No older entries',
                  ),
                ),
              ),
            ],
          ],
        ],
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
        Text(
          snapshot.isCached
              ? 'Showing saved data${timestamp == null ? '' : ' · last refreshed ${DateFormat.yMMMd().add_jm().format(timestamp)}'}'
              : 'Showing latest data${timestamp == null ? '' : ' · refreshed ${DateFormat.yMMMd().add_jm().format(timestamp)}'}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }

  List<Map<String, dynamic>> _filter(List<Map<String, dynamic>> rows) {
    final query = _search.trim().toLowerCase();
    return rows.where((row) {
      if (_action != 'all' && row['action']?.toString() != _action) {
        return false;
      }
      if (_entityType != 'all' &&
          row['entity_type']?.toString() != _entityType) {
        return false;
      }
      final values = [
        row['actor_name'],
        row['actor_id'],
        row['action'],
        row['entity_type'],
        row['entity_id'],
      ];
      return query.isEmpty ||
          values.any(
            (value) => value?.toString().toLowerCase().contains(query) ?? false,
          );
    }).toList();
  }

  List<String> _distinctValues(List<Map<String, dynamic>> rows, String key) =>
      rows
          .map((row) => row[key]?.toString())
          .whereType<String>()
          .where((value) => value.isNotEmpty)
          .toSet()
          .toList()
        ..sort();

  Widget _table(BuildContext context, List<Map<String, dynamic>> rows) {
    if (rows.isEmpty) {
      return const Card(
        child: ListTile(
          leading: Icon(Icons.history),
          title: Text('No audit entries found'),
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
            DataColumn(label: Text('Time')),
            DataColumn(label: Text('Actor')),
            DataColumn(label: Text('Action')),
            DataColumn(label: Text('Entity')),
            DataColumn(label: Text('Details')),
          ],
          rows: rows.map((row) {
            final createdAt = DateTime.tryParse(
              row['created_at']?.toString() ?? '',
            );
            return DataRow(
              onSelectChanged: (_) => showDialog<void>(
                context: context,
                builder: (context) => _AuditDetailsDialog(entry: row),
              ),
              cells: [
                DataCell(
                  Text(
                    createdAt == null
                        ? '—'
                        : DateFormat.MMMd().add_Hm().format(
                            createdAt.toLocal(),
                          ),
                  ),
                ),
                DataCell(Text(row['actor_name']?.toString() ?? 'System')),
                DataCell(Text(row['action']?.toString() ?? '—')),
                DataCell(
                  Text(
                    '${row['entity_type'] ?? '—'}'
                    '${row['entity_id'] == null ? '' : '\n${row['entity_id']}'}',
                  ),
                ),
                const DataCell(Icon(Icons.open_in_new, size: 18)),
              ],
            );
          }).toList(),
        ),
      ),
    );
  }
}

class _AuditDetailsDialog extends StatelessWidget {
  const _AuditDetailsDialog({required this.entry});

  final Map<String, dynamic> entry;

  @override
  Widget build(BuildContext context) {
    final formatter = const JsonEncoder.withIndent('  ');
    final theme = Theme.of(context);
    return AlertDialog(
      title: Text(entry['action']?.toString() ?? 'Audit details'),
      content: SizedBox(
        width: 720,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _field('Actor', entry['actor_name']?.toString() ?? 'System'),
              _field('Entity type', entry['entity_type']?.toString() ?? '—'),
              _field('Entity ID', entry['entity_id']?.toString() ?? '—'),
              _field('Recorded', entry['created_at']?.toString() ?? '—'),
              const SizedBox(height: 14),
              Text('Previous value', style: theme.textTheme.titleSmall),
              SelectableText(_json(formatter, entry['old_value'])),
              const SizedBox(height: 14),
              Text('New value', style: theme.textTheme.titleSmall),
              SelectableText(_json(formatter, entry['new_value'])),
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

  String _json(JsonEncoder formatter, Object? value) =>
      value == null ? '—' : formatter.convert(value);

  Widget _field(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 120, child: Text(label)),
        Expanded(child: SelectableText(value)),
      ],
    ),
  );
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.label, required this.value});

  final String label;
  final String value;

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
            Text(value, style: Theme.of(context).textTheme.headlineSmall),
          ],
        ),
      ),
    ),
  );
}
