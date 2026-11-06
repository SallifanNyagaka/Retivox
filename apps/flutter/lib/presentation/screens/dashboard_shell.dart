import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';
import '../../features/sales/sale_repository.dart';
import 'account_settings_screen.dart';
import 'admin_directory_screen.dart';
import 'analytics_screen.dart';
import 'audit_log_screen.dart';
import 'dashboard_data_screen.dart';
import 'finance_screen.dart';
import 'pos_screen.dart';
import 'transfers_screen.dart';

class DashboardShell extends StatefulWidget {
  const DashboardShell({
    required this.user,
    required this.dashboardRepository,
    required this.saleRepository,
    required this.darkMode,
    required this.onDarkModeChanged,
    required this.onSignOut,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository dashboardRepository;
  final SaleRepository saleRepository;
  final bool darkMode;
  final Future<void> Function(bool enabled) onDarkModeChanged;
  final VoidCallback onSignOut;

  @override
  State<DashboardShell> createState() => _DashboardShellState();
}

class _DashboardShellState extends State<DashboardShell> {
  final _connectivity = Connectivity();
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  String _selectedSection = 'overview';
  bool _isConnected = false;
  int _pendingSales = 0;
  bool _isRefreshing = false;

  List<_NavGroup> get _groups => switch (widget.user.role) {
    RetivoxRole.owner => _ownerGroups,
    RetivoxRole.admin => _adminGroups,
    RetivoxRole.employee => _employeeGroups,
  };

  @override
  void initState() {
    super.initState();
    _subscription = _connectivity.onConnectivityChanged.listen(
      (results) {
        if (mounted) {
          setState(
            () => _isConnected = results.any(
              (result) => result != ConnectivityResult.none,
            ),
          );
        }
      },
      onError: (Object error, StackTrace stackTrace) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Connection status unavailable: $error')),
          );
        }
      },
    );
    unawaited(_refreshStatus());
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  Future<void> _refreshStatus() async {
    setState(() => _isRefreshing = true);
    try {
      final connectivity = await _connectivity.checkConnectivity();
      final pending = await widget.saleRepository.database.countSalesForAccount(
        widget.user.id,
      );
      if (mounted) {
        setState(() {
          _isConnected = connectivity.any(
            (result) => result != ConnectivityResult.none,
          );
          _pendingSales = pending;
        });
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not refresh desktop status: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _isRefreshing = false);
    }
  }

  Future<void> _refreshAndSync() async {
    try {
      await _refreshStatus();
      await widget.saleRepository.syncPending(widget.user);
      await _refreshStatus();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Sync failed; saved data is still on this device: $error',
            ),
          ),
        );
      }
    }
  }

  void _selectSection(_NavItem item) {
    if (!item.available) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '${item.label} is in the dashboard parity rollout and is not available in this build yet.',
          ),
        ),
      );
      return;
    }
    setState(() => _selectedSection = item.id);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Row(
          children: [
            _RoleSidebar(
              businessName: widget.user.businessName,
              user: widget.user,
              groups: _groups,
              selectedSection: _selectedSection,
              onSelect: _selectSection,
              onSignOut: widget.onSignOut,
            ),
            Expanded(
              child: Column(
                children: [
                  _TopPanel(
                    user: widget.user,
                    isConnected: _isConnected,
                    pendingSales: _pendingSales,
                    isRefreshing: _isRefreshing,
                    onRefresh: _refreshAndSync,
                    onSignOut: widget.onSignOut,
                  ),
                  Expanded(
                    child: ColoredBox(
                      color: theme.colorScheme.surfaceContainerLowest,
                      child: _selectedSection == 'sales'
                          ? PosScreen(
                              user: widget.user,
                              repository: widget.saleRepository,
                              onSignOut: widget.onSignOut,
                              embedded: true,
                            )
                          : _selectedSection == 'overview'
                          ? _OverviewWorkspace(
                              user: widget.user,
                              isConnected: _isConnected,
                              pendingSales: _pendingSales,
                              onOpenSales: () =>
                                  setState(() => _selectedSection = 'sales'),
                              onRefresh: _refreshAndSync,
                            )
                          : _selectedSection == 'analytics'
                          ? AnalyticsScreen(
                              user: widget.user,
                              repository: widget.dashboardRepository,
                            )
                          : _selectedSection == 'transfers'
                          ? TransfersScreen(
                              user: widget.user,
                              repository: widget.dashboardRepository,
                            )
                          : _selectedSection == 'admins'
                          ? AdminDirectoryScreen(
                              user: widget.user,
                              repository: widget.dashboardRepository,
                            )
                          : _selectedSection == 'finances'
                          ? FinanceScreen(
                              user: widget.user,
                              repository: widget.dashboardRepository,
                            )
                          : _selectedSection == 'audit'
                          ? AuditLogScreen(
                              user: widget.user,
                              repository: widget.dashboardRepository,
                            )
                          : _selectedSection == 'settings'
                          ? AccountSettingsScreen(
                              user: widget.user,
                              repository: widget.dashboardRepository,
                              darkMode: widget.darkMode,
                              onDarkModeChanged: widget.onDarkModeChanged,
                              onSignOut: widget.onSignOut,
                            )
                          : DashboardDataScreen(
                              user: widget.user,
                              section: _selectedSection,
                              repository: widget.dashboardRepository,
                            ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TopPanel extends StatelessWidget {
  const _TopPanel({
    required this.user,
    required this.isConnected,
    required this.pendingSales,
    required this.isRefreshing,
    required this.onRefresh,
    required this.onSignOut,
  });

  final RetivoxUser user;
  final bool isConnected;
  final int pendingSales;
  final bool isRefreshing;
  final VoidCallback onRefresh;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final role = user.role.name[0].toUpperCase() + user.role.name.substring(1);
    return Container(
      height: 66,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          bottom: BorderSide(color: theme.colorScheme.outlineVariant),
        ),
      ),
      child: Row(
        children: [
          Text(
            'Retivox',
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w700,
              color: theme.colorScheme.primary,
            ),
          ),
          const SizedBox(width: 20),
          Expanded(
            child: Text(
              user.email,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Chip(
            avatar: Icon(
              isConnected
                  ? Icons.cloud_done_outlined
                  : Icons.cloud_off_outlined,
              size: 18,
            ),
            label: Text(isConnected ? 'Online' : 'Offline'),
            visualDensity: VisualDensity.compact,
          ),
          const SizedBox(width: 8),
          Chip(
            avatar: const Icon(Icons.sync, size: 18),
            label: Text(
              pendingSales == 0 ? 'All synced' : '$pendingSales pending',
            ),
            visualDensity: VisualDensity.compact,
          ),
          const SizedBox(width: 8),
          Text('$role · ${user.name}', style: theme.textTheme.bodyMedium),
          IconButton(
            tooltip: 'Refresh and sync',
            onPressed: isRefreshing ? null : onRefresh,
            icon: isRefreshing
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Sign out',
            onPressed: onSignOut,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
    );
  }
}

class _RoleSidebar extends StatelessWidget {
  const _RoleSidebar({
    required this.businessName,
    required this.user,
    required this.groups,
    required this.selectedSection,
    required this.onSelect,
    required this.onSignOut,
  });

  final String businessName;
  final RetivoxUser user;
  final List<_NavGroup> groups;
  final String selectedSection;
  final ValueChanged<_NavItem> onSelect;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: 252,
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          right: BorderSide(color: theme.colorScheme.outlineVariant),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 22, 18, 18),
            child: Row(
              children: [
                CircleAvatar(
                  backgroundColor: theme.colorScheme.primaryContainer,
                  foregroundColor: theme.colorScheme.onPrimaryContainer,
                  child: const Icon(Icons.storefront_outlined),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        businessName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        user.branches.firstOrNull?.name ?? 'Employee workspace',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
              children: [
                for (final group in groups) ...[
                  if (group.label.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 14, 12, 6),
                      child: Text(
                        group.label.toUpperCase(),
                        style: theme.textTheme.labelSmall?.copyWith(
                          letterSpacing: 0.8,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  for (final item in group.items)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Tooltip(
                        message: item.available
                            ? item.label
                            : '${item.label} is being implemented',
                        child: ListTile(
                          dense: true,
                          enabled: item.available,
                          selected: selectedSection == item.id,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(9),
                          ),
                          leading: Icon(item.icon, size: 20),
                          title: Text(item.label),
                          trailing: item.available
                              ? null
                              : Icon(
                                  Icons.lock_outline,
                                  size: 15,
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                          onTap: () => onSelect(item),
                        ),
                      ),
                    ),
                ],
              ],
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(10),
            child: ListTile(
              dense: true,
              leading: const Icon(Icons.logout),
              title: const Text('Sign out'),
              onTap: onSignOut,
            ),
          ),
        ],
      ),
    );
  }
}

class _OverviewWorkspace extends StatelessWidget {
  const _OverviewWorkspace({
    required this.user,
    required this.isConnected,
    required this.pendingSales,
    required this.onOpenSales,
    required this.onRefresh,
  });

  final RetivoxUser user;
  final bool isConnected;
  final int pendingSales;
  final VoidCallback onOpenSales;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(28),
      children: [
        Text('Overview', style: theme.textTheme.headlineSmall),
        const SizedBox(height: 6),
        Text(
          'Welcome, ${user.name}. This workspace adapts to your ${user.role.name} access.',
          style: theme.textTheme.bodyMedium,
        ),
        const SizedBox(height: 24),
        Wrap(
          spacing: 16,
          runSpacing: 16,
          children: [
            _SummaryCard(
              title: 'Connection',
              value: isConnected ? 'Online' : 'Offline',
              detail: isConnected
                  ? 'Server features are reachable'
                  : 'Using saved information on this device',
              icon: isConnected ? Icons.cloud_done_outlined : Icons.cloud_off,
            ),
            _SummaryCard(
              title: 'Branches',
              value: '${user.branches.length}',
              detail: 'Branches available to this account',
              icon: Icons.store_outlined,
            ),
            _SummaryCard(
              title: 'Pending sales',
              value: '$pendingSales',
              detail: pendingSales == 0
                  ? 'No unsynced or unresolved sales'
                  : 'Saved locally; sync when connected',
              icon: Icons.sync,
            ),
          ],
        ),
        const SizedBox(height: 24),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Your branches', style: theme.textTheme.titleLarge),
                const SizedBox(height: 8),
                if (user.branches.isEmpty)
                  const Text('No branch access is saved for this account.')
                else
                  ...user.branches.map(
                    (branch) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.store_outlined),
                      title: Text(branch.name),
                      subtitle: Text('${branch.role} access'),
                    ),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 20),
        Align(
          alignment: Alignment.centerLeft,
          child: Wrap(
            spacing: 12,
            children: [
              FilledButton.icon(
                onPressed: onOpenSales,
                icon: const Icon(Icons.point_of_sale),
                label: const Text('Open point of sale'),
              ),
              OutlinedButton.icon(
                onPressed: onRefresh,
                icon: const Icon(Icons.refresh),
                label: const Text('Refresh and sync'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        const _RolloutNotice(),
      ],
    );
  }
}

class _TransactionsWorkspace extends StatefulWidget {
  const _TransactionsWorkspace({
    required this.user,
    required this.repository,
    required this.onRefresh,
  });

  final RetivoxUser user;
  final SaleRepository repository;
  final VoidCallback onRefresh;

  @override
  State<_TransactionsWorkspace> createState() => _TransactionsWorkspaceState();
}

class _TransactionsWorkspaceState extends State<_TransactionsWorkspace> {
  late Future<List<LocalSale>> _sales;

  @override
  void initState() {
    super.initState();
    _sales = widget.repository.listSales(widget.user.id);
  }

  void _reload() {
    setState(() => _sales = widget.repository.listSales(widget.user.id));
    widget.onRefresh();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return FutureBuilder<List<LocalSale>>(
      future: _sales,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Center(
            child: SelectableText(
              'Could not load local transaction history: ${snapshot.error}',
            ),
          );
        }
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final sales = snapshot.data!;
        return ListView(
          padding: const EdgeInsets.all(28),
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Transactions',
                        style: theme.textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        'Sales recorded on this desktop. Online transaction history is being connected.',
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh',
                  onPressed: _reload,
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
            const SizedBox(height: 20),
            if (sales.isEmpty)
              const Card(
                child: ListTile(
                  leading: Icon(Icons.receipt_long_outlined),
                  title: Text('No locally saved sales yet'),
                  subtitle: Text(
                    'Sales recorded on this desktop will appear here.',
                  ),
                ),
              )
            else
              Card(
                clipBehavior: Clip.antiAlias,
                child: Column(
                  children: [
                    for (final sale in sales)
                      ListTile(
                        leading: const Icon(Icons.receipt_long_outlined),
                        title: Text(
                          '${widget.user.currency} ${sale.totalAmount.toStringAsFixed(2)}',
                        ),
                        subtitle: Text(
                          '${sale.recordedAt} · ${sale.status.replaceAll('_', ' ')}'
                          '${sale.errorMessage == null ? '' : '\n${sale.errorMessage}'}',
                        ),
                        isThreeLine: sale.errorMessage != null,
                      ),
                  ],
                ),
              ),
            const SizedBox(height: 18),
            const _RolloutNotice(),
          ],
        );
      },
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.title,
    required this.value,
    required this.detail,
    required this.icon,
  });

  final String title;
  final String value;
  final String detail;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      width: 260,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: theme.colorScheme.primary),
              const SizedBox(height: 12),
              Text(title, style: theme.textTheme.bodyMedium),
              const SizedBox(height: 4),
              Text(value, style: theme.textTheme.headlineSmall),
              const SizedBox(height: 4),
              Text(detail, style: theme.textTheme.bodySmall),
            ],
          ),
        ),
      ),
    );
  }
}

class _RolloutNotice extends StatelessWidget {
  const _RolloutNotice();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      color: theme.colorScheme.secondaryContainer,
      child: const Padding(
        padding: EdgeInsets.all(16),
        child: Text(
          'Desktop dashboard parity is being built in sections. Unavailable sections are marked in the navigation; they are not yet represented as complete.',
        ),
      ),
    );
  }
}

class _NavGroup {
  const _NavGroup(this.label, this.items);

  final String label;
  final List<_NavItem> items;
}

class _NavItem {
  const _NavItem({
    required this.id,
    required this.label,
    required this.icon,
    this.available = false,
  });

  final String id;
  final String label;
  final IconData icon;
  final bool available;
}

const _ownerGroups = <_NavGroup>[
  _NavGroup('', [
    _NavItem(
      id: 'overview',
      label: 'Overview',
      icon: Icons.dashboard_outlined,
      available: true,
    ),
    _NavItem(
      id: 'analytics',
      label: 'Analytics',
      icon: Icons.query_stats_outlined,
      available: true,
    ),
  ]),
  _NavGroup('Management', [
    _NavItem(
      id: 'branches',
      label: 'Branches',
      icon: Icons.store_outlined,
      available: true,
    ),
    _NavItem(
      id: 'stock',
      label: 'Stock',
      icon: Icons.inventory_2_outlined,
      available: true,
    ),
    _NavItem(
      id: 'products',
      label: 'Products',
      icon: Icons.sell_outlined,
      available: true,
    ),
    _NavItem(
      id: 'transfers',
      label: 'Transfers',
      icon: Icons.swap_horiz,
      available: true,
    ),
  ]),
  _NavGroup('People', [
    _NavItem(
      id: 'admins',
      label: 'Admins',
      icon: Icons.admin_panel_settings_outlined,
      available: true,
    ),
    _NavItem(
      id: 'employees',
      label: 'Employees',
      icon: Icons.people_outline,
      available: true,
    ),
    _NavItem(
      id: 'suppliers',
      label: 'Suppliers',
      icon: Icons.local_shipping_outlined,
      available: true,
    ),
    _NavItem(
      id: 'deliveries',
      label: 'Deliveries',
      icon: Icons.inventory_outlined,
      available: true,
    ),
  ]),
  _NavGroup('Finance', [
    _NavItem(
      id: 'sales',
      label: 'New transaction',
      icon: Icons.point_of_sale,
      available: true,
    ),
    _NavItem(
      id: 'finances',
      label: 'Finances',
      icon: Icons.account_balance_wallet_outlined,
      available: true,
    ),
    _NavItem(
      id: 'transactions',
      label: 'Transactions',
      icon: Icons.receipt_long_outlined,
      available: true,
    ),
  ]),
  _NavGroup('System', [
    _NavItem(
      id: 'audit',
      label: 'Audit log',
      icon: Icons.security_outlined,
      available: true,
    ),
    _NavItem(
      id: 'settings',
      label: 'Settings',
      icon: Icons.settings_outlined,
      available: true,
    ),
  ]),
];

const _adminGroups = <_NavGroup>[
  _NavGroup('', [
    _NavItem(
      id: 'overview',
      label: 'Overview',
      icon: Icons.dashboard_outlined,
      available: true,
    ),
  ]),
  _NavGroup('Management', [
    _NavItem(
      id: 'stock',
      label: 'Stock',
      icon: Icons.inventory_2_outlined,
      available: true,
    ),
    _NavItem(
      id: 'damages',
      label: 'Damages',
      icon: Icons.warning_amber_outlined,
      available: true,
    ),
    _NavItem(
      id: 'products',
      label: 'Products',
      icon: Icons.sell_outlined,
      available: true,
    ),
    _NavItem(
      id: 'transfers',
      label: 'Transfers',
      icon: Icons.swap_horiz,
      available: true,
    ),
  ]),
  _NavGroup('People', [
    _NavItem(
      id: 'employees',
      label: 'Employees',
      icon: Icons.people_outline,
      available: true,
    ),
    _NavItem(
      id: 'suppliers',
      label: 'Suppliers',
      icon: Icons.local_shipping_outlined,
      available: true,
    ),
    _NavItem(
      id: 'deliveries',
      label: 'Deliveries',
      icon: Icons.inventory_outlined,
      available: true,
    ),
  ]),
  _NavGroup('Finance', [
    _NavItem(
      id: 'sales',
      label: 'New transaction',
      icon: Icons.point_of_sale,
      available: true,
    ),
    _NavItem(
      id: 'transactions',
      label: 'Transactions',
      icon: Icons.receipt_long_outlined,
      available: true,
    ),
  ]),
  _NavGroup('System', [
    _NavItem(
      id: 'settings',
      label: 'Settings',
      icon: Icons.settings_outlined,
      available: true,
    ),
  ]),
];

const _employeeGroups = <_NavGroup>[
  _NavGroup('', [
    _NavItem(
      id: 'overview',
      label: 'Overview',
      icon: Icons.dashboard_outlined,
      available: true,
    ),
    _NavItem(
      id: 'sales',
      label: 'Point of sale',
      icon: Icons.point_of_sale,
      available: true,
    ),
    _NavItem(
      id: 'transactions',
      label: 'Transactions',
      icon: Icons.receipt_long_outlined,
      available: true,
    ),
  ]),
  _NavGroup('Workspace', [
    _NavItem(
      id: 'damages',
      label: 'Damaged stock',
      icon: Icons.warning_amber_outlined,
      available: true,
    ),
    _NavItem(
      id: 'settings',
      label: 'Settings',
      icon: Icons.settings_outlined,
      available: true,
    ),
  ]),
];
