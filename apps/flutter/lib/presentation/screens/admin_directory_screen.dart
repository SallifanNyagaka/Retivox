import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';
import 'admin_management_dialog.dart';

class AdminDirectoryScreen extends StatefulWidget {
  const AdminDirectoryScreen({
    required this.user,
    required this.repository,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;

  @override
  State<AdminDirectoryScreen> createState() => _AdminDirectoryScreenState();
}

class _AdminDirectoryScreenState extends State<AdminDirectoryScreen> {
  late Future<DashboardSnapshot> _snapshot;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _snapshot = widget.repository.loadSection(widget.user, 'admins');
  }

  void _refresh() {
    setState(() {
      _snapshot = widget.repository.loadSection(widget.user, 'admins');
    });
  }

  Future<void> _openManagementDialog(
    AdminManagementMode mode, {
    Map<String, dynamic>? admin,
  }) async {
    try {
      final branches = mode == AdminManagementMode.invite
          ? <Map<String, dynamic>>[]
          : await widget.repository.loadAdminBranchOptions(
              widget.user,
              includeInactive: mode == AdminManagementMode.branches,
            );
      if (!mounted) return;
      final currentBranches = admin?['branches'] is List
          ? (admin!['branches'] as List)
                .whereType<Map<String, dynamic>>()
                .map((branch) => branch['branch_id']?.toString())
                .whereType<String>()
                .toList()
          : const <String>[];
      final updated = await showDialog<bool>(
        context: context,
        builder: (context) => AdminManagementDialog(
          mode: mode,
          user: widget.user,
          repository: widget.repository,
          adminId: admin?['id']?.toString(),
          branches: branches,
          initialBranchIds: currentBranches,
        ),
      );
      if (!mounted || updated != true) return;
      _refresh();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Administrator details updated.')),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _toggleActive(Map<String, dynamic> admin) async {
    final id = admin['id']?.toString();
    if (id == null || id.isEmpty) return;
    final isActive = admin['is_active'] != true;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          isActive ? 'Activate administrator?' : 'Deactivate administrator?',
        ),
        content: Text(
          '${admin['name'] ?? 'This administrator'} will ${isActive ? 'regain' : 'lose'} access to the assigned branches.',
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
      await widget.repository.setAdminActive(
        user: widget.user,
        adminId: id,
        isActive: isActive,
      );
      if (!mounted) return;
      _refresh();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Administrator ${isActive ? 'activated' : 'deactivated'}.',
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
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
                    Text('Admins', style: theme.textTheme.headlineSmall),
                    const SizedBox(height: 6),
                    Text(
                      'Administrator accounts and branch assignments for this business.',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              if (widget.user.role == RetivoxRole.owner) ...[
                OutlinedButton.icon(
                  onPressed: () =>
                      _openManagementDialog(AdminManagementMode.invite),
                  icon: const Icon(Icons.mail_outline),
                  label: const Text('Invite'),
                ),
                const SizedBox(width: 8),
                FilledButton.icon(
                  onPressed: () =>
                      _openManagementDialog(AdminManagementMode.create),
                  icon: const Icon(Icons.person_add_alt_1),
                  label: const Text('Add admin'),
                ),
                const SizedBox(width: 8),
              ],
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
            _errorCard(context, result.error.toString())
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
            _readOnlyNotice(context),
            const SizedBox(height: 16),
            _summary(result.data!.rows),
            const SizedBox(height: 16),
            SizedBox(
              width: 420,
              child: TextField(
                onChanged: (value) => setState(() => _search = value),
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  labelText: 'Search admins',
                  isDense: true,
                ),
              ),
            ),
            const SizedBox(height: 14),
            _table(context, _filter(result.data!.rows)),
          ],
        ],
      ),
    );
  }

  Widget _errorCard(BuildContext context, String message) => Card(
    color: Theme.of(context).colorScheme.errorContainer,
    child: Padding(padding: const EdgeInsets.all(16), child: Text(message)),
  );

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

  Widget _readOnlyNotice(BuildContext context) => Card(
    color: Theme.of(context).colorScheme.surfaceContainerHigh,
    child: const Padding(
      padding: EdgeInsets.all(14),
      child: Text(
        'Administrator changes require an online owner session and the secure Retivox web API. Branch deletion and permanent account removal remain available only in the web dashboard.',
      ),
    ),
  );

  Widget _summary(List<Map<String, dynamic>> rows) {
    final active = rows.where((row) => row['is_active'] == true).length;
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        _MetricCard(label: 'Administrators', value: '${rows.length}'),
        _MetricCard(label: 'Active', value: '$active'),
        _MetricCard(label: 'Inactive', value: '${rows.length - active}'),
      ],
    );
  }

  List<Map<String, dynamic>> _filter(List<Map<String, dynamic>> rows) {
    final query = _search.trim().toLowerCase();
    if (query.isEmpty) return rows;
    return rows.where((row) {
      final branches = row['branches'] is List
          ? (row['branches'] as List).whereType<Map<String, dynamic>>()
          : const <Map<String, dynamic>>[];
      return [
        row['name'],
        row['email'],
        row['phone'],
        ...branches.map((branch) => branch['branch_name']),
      ].any(
        (value) => value?.toString().toLowerCase().contains(query) ?? false,
      );
    }).toList();
  }

  Widget _table(BuildContext context, List<Map<String, dynamic>> rows) {
    if (rows.isEmpty) {
      return const Card(
        child: ListTile(
          leading: Icon(Icons.people_outline),
          title: Text('No administrators found'),
        ),
      );
    }
    return Card(
      clipBehavior: Clip.antiAlias,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          columns: const [
            DataColumn(label: Text('Administrator')),
            DataColumn(label: Text('Email')),
            DataColumn(label: Text('Phone')),
            DataColumn(label: Text('Branches')),
            DataColumn(label: Text('Status')),
            DataColumn(label: Text('Joined')),
            DataColumn(label: Text('Actions')),
          ],
          rows: rows.map((row) {
            final assignments = row['branches'] is List
                ? (row['branches'] as List)
                      .whereType<Map<String, dynamic>>()
                      .toList()
                : const <Map<String, dynamic>>[];
            final joinedAt = DateTime.tryParse(
              row['created_at']?.toString() ?? '',
            );
            return DataRow(
              cells: [
                DataCell(Text(row['name']?.toString() ?? 'Admin')),
                DataCell(Text(row['email']?.toString() ?? '—')),
                DataCell(Text(row['phone']?.toString() ?? '—')),
                DataCell(
                  SizedBox(
                    width: 260,
                    child: Text(
                      assignments.isEmpty
                          ? 'No active assignment'
                          : assignments
                                .map(
                                  (item) =>
                                      item['branch_name']?.toString() ??
                                      'Branch',
                                )
                                .join(', '),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
                DataCell(
                  Chip(
                    label: Text(
                      row['is_active'] == true ? 'Active' : 'Inactive',
                    ),
                    visualDensity: VisualDensity.compact,
                  ),
                ),
                DataCell(
                  Text(
                    joinedAt == null
                        ? '—'
                        : DateFormat.yMMMd().format(joinedAt.toLocal()),
                  ),
                ),
                DataCell(
                  widget.user.role == RetivoxRole.owner
                      ? Wrap(
                          spacing: 2,
                          children: [
                            IconButton(
                              tooltip: 'Manage branch access',
                              onPressed: () => _openManagementDialog(
                                AdminManagementMode.branches,
                                admin: row,
                              ),
                              icon: const Icon(Icons.account_tree_outlined),
                            ),
                            IconButton(
                              tooltip: row['is_active'] == true
                                  ? 'Deactivate administrator'
                                  : 'Activate administrator',
                              onPressed: () => _toggleActive(row),
                              icon: Icon(
                                row['is_active'] == true
                                    ? Icons.pause_circle_outline
                                    : Icons.play_circle_outline,
                              ),
                            ),
                          ],
                        )
                      : const SizedBox.shrink(),
                ),
              ],
            );
          }).toList(),
        ),
      ),
    );
  }
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
