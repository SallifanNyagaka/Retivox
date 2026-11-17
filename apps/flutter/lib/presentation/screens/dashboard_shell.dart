import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';
import '../../features/sales/sale_repository.dart';
import '../theme/retivox_theme.dart';
import '../widgets/retivox_badge.dart';
import '../widgets/retivox_role_badge.dart';
import 'account_settings_screen.dart';
import 'admin_directory_screen.dart';
import 'analytics_screen.dart';
import 'audit_log_screen.dart';
import 'dashboard_data_screen.dart';
import 'finance_screen.dart';
import 'pos_screen.dart';
import 'transfers_screen.dart';
import '../widgets/overview_section.dart';

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
  Timer? _connectionTimer;
  String _selectedSection = 'overview';
  bool _isConnected = false;
  int _overviewRefreshVersion = 0;
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
    unawaited(_refreshStatus());
    _connectionTimer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => unawaited(_refreshStatus()),
    );
  }

  @override
  void dispose() {
    _connectionTimer?.cancel();
    super.dispose();
  }

  Future<void> _refreshStatus() async {
    setState(() => _isRefreshing = true);
    try {
      final reachable = await widget.dashboardRepository.isBackendReachable();
      final pending = await widget.saleRepository.database.countSalesForAccount(
        widget.user.id,
      );
      if (mounted) {
        final connectionChanged = reachable != _isConnected;
        final reconnected = reachable && !_isConnected;
        setState(() {
          _isConnected = reachable;
          _pendingSales = pending;
          if (connectionChanged) _overviewRefreshVersion++;
        });
        if (reconnected) unawaited(_syncPendingOnReconnect());
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
      await _syncQueuedData();
      await _refreshStatus();
      if (mounted) setState(() => _overviewRefreshVersion++);
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

  Future<void> _syncPendingOnReconnect() async {
    await _syncQueuedData();
    try {
      final pending = await widget.saleRepository.database.countSalesForAccount(
        widget.user.id,
      );
      if (mounted)
        setState(() {
          _pendingSales = pending;
          _overviewRefreshVersion++;
        });
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Could not refresh the pending change count: $error'),
          ),
        );
      }
    }
  }

  Future<void> _syncQueuedData() async {
    final failures = <String>[];
    try {
      await widget.dashboardRepository.syncPendingBranchCreates(widget.user);
    } catch (error) {
      failures.add('stores: $error');
    }
    try {
      await widget.saleRepository.syncPending(widget.user);
    } catch (error) {
      failures.add('sales: $error');
    }
    try {
      await widget.dashboardRepository.syncPendingDashboardActions(widget.user);
    } catch (error) {
      failures.add('dashboard changes: $error');
    }
    if (failures.isNotEmpty && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Some saved changes remain queued: ${failures.join(' · ')}',
          ),
        ),
      );
    }
  }

  void _selectSection(_NavItem item) {
    setState(() => _selectedSection = item.id);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final bg = isDark
        ? RetivoxTheme.backgroundDark
        : RetivoxTheme.backgroundLight;

    return Scaffold(
      backgroundColor: bg,
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
                    repository: widget.dashboardRepository,
                    isConnected: _isConnected,
                    pendingSales: _pendingSales,
                    isRefreshing: _isRefreshing,
                    darkMode: widget.darkMode,
                    onDarkModeChanged: widget.onDarkModeChanged,
                    onRefresh: _refreshAndSync,
                    onSignOut: widget.onSignOut,
                  ),
                  Expanded(
                    child: ColoredBox(
                      color: bg,
                      child: _selectedSection == 'sales'
                          ? PosScreen(
                              user: widget.user,
                              repository: widget.saleRepository,
                              onSignOut: widget.onSignOut,
                              embedded: true,
                            )
                          : _selectedSection == 'overview'
                          ? OverviewSection(
                              user: widget.user,
                              repository: widget.dashboardRepository,
                              refreshVersion: _overviewRefreshVersion,
                              onRefresh: _refreshAndSync,
                              onNavigate: (section) =>
                                  setState(() => _selectedSection = section),
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
                              refreshVersion: _overviewRefreshVersion,
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

/// Topbar matching apps/web/app/dashboard/layout.tsx (56px height, surface background, RoleBadge).
class _TopPanel extends StatelessWidget {
  const _TopPanel({
    required this.user,
    required this.repository,
    required this.isConnected,
    required this.pendingSales,
    required this.isRefreshing,
    required this.darkMode,
    required this.onDarkModeChanged,
    required this.onRefresh,
    required this.onSignOut,
  });

  final RetivoxUser user;
  final DashboardRepository repository;
  final bool isConnected;
  final int pendingSales;
  final bool isRefreshing;
  final bool darkMode;
  final Future<void> Function(bool enabled) onDarkModeChanged;
  final VoidCallback onRefresh;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final surface = isDark
        ? RetivoxTheme.surfaceDark
        : RetivoxTheme.surfaceLight;
    final border = isDark ? RetivoxTheme.borderDark : RetivoxTheme.borderLight;
    final textPrimary = isDark
        ? RetivoxTheme.textPrimaryDark
        : RetivoxTheme.textPrimaryLight;
    final textMuted = isDark
        ? RetivoxTheme.textMutedDark
        : RetivoxTheme.textMutedLight;

    return Container(
      height: RetivoxTheme.topbarHeight,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      decoration: BoxDecoration(
        color: surface,
        border: Border(bottom: BorderSide(color: border)),
      ),
      child: Row(
        children: [
          // Business name matching web topbar
          Text(
            user.businessName,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: textMuted,
            ),
          ),
          const Spacer(),

          // Connection status pill
          RetivoxBadge(
            variant: isConnected
                ? RetivoxBadgeVariant.success
                : RetivoxBadgeVariant.muted,
            label: isConnected ? 'Online' : 'Offline',
            leading: Icon(
              isConnected ? Icons.cloud_done_rounded : Icons.cloud_off_rounded,
              size: 13,
              color: isConnected
                  ? (isDark ? const Color(0xFF34D399) : const Color(0xFF047857))
                  : textMuted,
            ),
          ),
          const SizedBox(width: 8),

          // Sync status pill
          RetivoxBadge(
            variant: pendingSales == 0
                ? RetivoxBadgeVariant.muted
                : RetivoxBadgeVariant.warning,
            label: pendingSales == 0 ? 'All synced' : '$pendingSales pending',
            leading: Icon(
              Icons.sync_rounded,
              size: 13,
              color: pendingSales == 0
                  ? textMuted
                  : (isDark
                        ? const Color(0xFFFBBF24)
                        : const Color(0xFFB45309)),
            ),
          ),
          const SizedBox(width: 12),

          // Refresh button
          IconButton(
            tooltip: 'Refresh & sync',
            iconSize: 18,
            visualDensity: VisualDensity.compact,
            padding: const EdgeInsets.all(6),
            constraints: const BoxConstraints(),
            onPressed: isRefreshing ? null : onRefresh,
            icon: isRefreshing
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(Icons.refresh_rounded, color: textMuted),
          ),
          const SizedBox(width: 4),

          IconButton(
            tooltip: 'Notifications',
            iconSize: 18,
            visualDensity: VisualDensity.compact,
            padding: const EdgeInsets.all(6),
            constraints: const BoxConstraints(),
            onPressed: () => _showNotifications(context),
            icon: Icon(Icons.notifications_outlined, color: textMuted),
          ),
          const SizedBox(width: 4),

          // Dark mode toggle
          IconButton(
            tooltip: darkMode
                ? 'Switch to light theme'
                : 'Switch to dark theme',
            iconSize: 18,
            visualDensity: VisualDensity.compact,
            padding: const EdgeInsets.all(6),
            constraints: const BoxConstraints(),
            onPressed: () => onDarkModeChanged(!darkMode),
            icon: Icon(
              darkMode ? Icons.light_mode_outlined : Icons.dark_mode_outlined,
              color: textMuted,
            ),
          ),
          const SizedBox(width: 16),

          // User Name
          Text(
            user.name,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: textPrimary,
            ),
          ),
          const SizedBox(width: 10),

          // Role Badge
          RetivoxRoleBadge(role: user.role.name),
          const SizedBox(width: 8),
          OutlinedButton.icon(
            onPressed: onSignOut,
            icon: const Icon(Icons.logout_rounded, size: 16),
            label: const Text('Sign out'),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              minimumSize: Size.zero,
              visualDensity: VisualDensity.compact,
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _showNotifications(BuildContext context) async {
    try {
      final notices = await repository.loadNotifications(user);
      if (!context.mounted) return;
      await showDialog<void>(context: context, builder: (dialogContext) => AlertDialog(
        title: const Text('Notifications'),
        content: SizedBox(width: 480, height: 420, child: notices.isEmpty
          ? const Center(child: Text('You have no notifications.'))
          : ListView.separated(itemCount: notices.length, separatorBuilder: (_, _) => const Divider(height: 1), itemBuilder: (context, index) {
              final notice = notices[index];
              return ListTile(dense: true, leading: Icon(notice['is_read'] == true ? Icons.notifications_none : Icons.notifications_active_outlined), title: Text(notice['title']?.toString() ?? 'Notification'), subtitle: Text('${notice['body'] ?? ''}\n${notice['created_at'] ?? ''}'));
            })),
        actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Close'))],
      ));
    } catch (error) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not load notifications: $error')));
    }
  }
}

/// Sidebar matching apps/web/components/dashboard/Sidebar.tsx (240px width, uppercase section headers, active green pill).
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
    final isDark = theme.brightness == Brightness.dark;
    final surface = isDark
        ? RetivoxTheme.surfaceDark
        : RetivoxTheme.surfaceLight;
    final border = isDark ? RetivoxTheme.borderDark : RetivoxTheme.borderLight;
    final primaryColor = isDark
        ? RetivoxTheme.primaryDarkMode
        : RetivoxTheme.primaryLightMode;
    final textPrimary = isDark
        ? RetivoxTheme.textPrimaryDark
        : RetivoxTheme.textPrimaryLight;
    final textMuted = isDark
        ? RetivoxTheme.textMutedDark
        : RetivoxTheme.textMutedLight;

    return Container(
      width: RetivoxTheme.sidebarWidth,
      decoration: BoxDecoration(
        color: surface,
        border: Border(right: BorderSide(color: border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Logo & Business branding matching web
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: primaryColor,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      alignment: Alignment.center,
                      child: const Text(
                        'R',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      'Retivox',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: primaryColor,
                        letterSpacing: -0.3,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  businessName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: textPrimary,
                  ),
                ),
                Text(
                  user.branches.firstOrNull?.name ?? 'Headquarters',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11, color: textMuted),
                ),
              ],
            ),
          ),
          Divider(color: border, height: 1),

          // Nav Sections matching web
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
              children: [
                for (final group in groups) ...[
                  if (group.label.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(10, 14, 10, 6),
                      child: Text(
                        group.label.toUpperCase(),
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: textMuted,
                          letterSpacing: 0.8,
                        ),
                      ),
                    ),
                  for (final item in group.items) ...[
                    _NavItemTile(
                      item: item,
                      isSelected: selectedSection == item.id,
                      onTap: () => onSelect(item),
                    ),
                    const SizedBox(height: 2),
                  ],
                ],
              ],
            ),
          ),
          Divider(color: border, height: 1),

          // User info and sign out footer
          Padding(
            padding: const EdgeInsets.all(12),
            child: InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: onSignOut,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 8,
                ),
                child: Row(
                  children: [
                    Icon(Icons.logout_rounded, size: 18, color: textMuted),
                    const SizedBox(width: 10),
                    Text(
                      'Sign out',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: textMuted,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Navigation item tile styled to match Retivox web sidebar links.
class _NavItemTile extends StatelessWidget {
  const _NavItemTile({
    required this.item,
    required this.isSelected,
    required this.onTap,
  });

  final _NavItem item;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    final primaryColor = isDark
        ? RetivoxTheme.primaryDarkMode
        : RetivoxTheme.primaryLightMode;
    final activeBg = isDark
        ? RetivoxTheme.successDark
        : RetivoxTheme.primaryLight;
    final textMuted = isDark
        ? RetivoxTheme.textMutedDark
        : RetivoxTheme.textMutedLight;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? activeBg : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              Icon(
                item.icon,
                size: 18,
                color: isSelected ? primaryColor : textMuted,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  item.label,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                    color: isSelected ? primaryColor : textMuted,
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

/// Overview dashboard matching apps/web/app/dashboard/owner/page.tsx.
class _NavGroup {
  const _NavGroup(this.label, this.items);

  final String label;
  final List<_NavItem> items;
}

class _NavItem {
  const _NavItem({required this.id, required this.label, required this.icon});

  final String id;
  final String label;
  final IconData icon;
}

const _ownerGroups = <_NavGroup>[
  _NavGroup('', [
    _NavItem(id: 'overview', label: 'Overview', icon: Icons.dashboard_outlined),
    _NavItem(
      id: 'analytics',
      label: 'Analytics',
      icon: Icons.query_stats_outlined,
    ),
  ]),
  _NavGroup('Management', [
    _NavItem(id: 'branches', label: 'Branches', icon: Icons.store_outlined),
    _NavItem(id: 'stock', label: 'Stock', icon: Icons.inventory_2_outlined),
    _NavItem(id: 'products', label: 'Products', icon: Icons.sell_outlined),
    _NavItem(id: 'transfers', label: 'Transfers', icon: Icons.swap_horiz),
  ]),
  _NavGroup('People', [
    _NavItem(
      id: 'admins',
      label: 'Admins',
      icon: Icons.admin_panel_settings_outlined,
    ),
    _NavItem(id: 'employees', label: 'Employees', icon: Icons.people_outline),
    _NavItem(
      id: 'suppliers',
      label: 'Suppliers',
      icon: Icons.local_shipping_outlined,
    ),
    _NavItem(
      id: 'deliveries',
      label: 'Deliveries',
      icon: Icons.inventory_outlined,
    ),
  ]),
  _NavGroup('Finance', [
    _NavItem(id: 'sales', label: 'New transaction', icon: Icons.point_of_sale),
    _NavItem(
      id: 'finances',
      label: 'Finances',
      icon: Icons.account_balance_wallet_outlined,
    ),
    _NavItem(
      id: 'transactions',
      label: 'Transactions',
      icon: Icons.receipt_long_outlined,
    ),
    _NavItem(id: 'cash_deposits', label: 'Cash deposits', icon: Icons.payments_outlined),
  ]),
  _NavGroup('System', [
    _NavItem(id: 'audit', label: 'Audit log', icon: Icons.security_outlined),
    _NavItem(id: 'settings', label: 'Settings', icon: Icons.settings_outlined),
  ]),
];

const _adminGroups = <_NavGroup>[
  _NavGroup('', [
    _NavItem(id: 'overview', label: 'Overview', icon: Icons.dashboard_outlined),
  ]),
  _NavGroup('Management', [
    _NavItem(id: 'stock', label: 'Stock', icon: Icons.inventory_2_outlined),
    _NavItem(
      id: 'damages',
      label: 'Damages',
      icon: Icons.warning_amber_outlined,
    ),
    _NavItem(id: 'products', label: 'Products', icon: Icons.sell_outlined),
    _NavItem(id: 'transfers', label: 'Transfers', icon: Icons.swap_horiz),
  ]),
  _NavGroup('People', [
    _NavItem(id: 'employees', label: 'Employees', icon: Icons.people_outline),
    _NavItem(
      id: 'suppliers',
      label: 'Suppliers',
      icon: Icons.local_shipping_outlined,
    ),
    _NavItem(
      id: 'deliveries',
      label: 'Deliveries',
      icon: Icons.inventory_outlined,
    ),
  ]),
  _NavGroup('Finance', [
    _NavItem(id: 'sales', label: 'New transaction', icon: Icons.point_of_sale),
    _NavItem(
      id: 'transactions',
      label: 'Transactions',
      icon: Icons.receipt_long_outlined,
    ),
    _NavItem(id: 'cash_deposits', label: 'Cash deposits', icon: Icons.payments_outlined),
  ]),
  _NavGroup('System', [
    _NavItem(id: 'settings', label: 'Settings', icon: Icons.settings_outlined),
  ]),
];

const _employeeGroups = <_NavGroup>[
  _NavGroup('', [
    _NavItem(id: 'overview', label: 'Overview', icon: Icons.dashboard_outlined),
    _NavItem(id: 'sales', label: 'Point of sale', icon: Icons.point_of_sale),
    _NavItem(
      id: 'transactions',
      label: 'Transactions',
      icon: Icons.receipt_long_outlined,
    ),
    _NavItem(id: 'cash_deposits', label: 'Cash deposits', icon: Icons.payments_outlined),
  ]),
  _NavGroup('Workspace', [
    _NavItem(
      id: 'damages',
      label: 'Damaged stock',
      icon: Icons.warning_amber_outlined,
    ),
    _NavItem(id: 'settings', label: 'Settings', icon: Icons.settings_outlined),
  ]),
];
