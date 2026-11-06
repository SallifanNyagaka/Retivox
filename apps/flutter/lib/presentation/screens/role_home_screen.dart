import 'package:flutter/material.dart';

import '../../core/auth/auth_repository.dart';
import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';
import '../../features/sales/sale_repository.dart';
import 'dashboard_shell.dart';

class RoleHomeScreen extends StatelessWidget {
  const RoleHomeScreen({
    required this.user,
    required this.repository,
    required this.dashboardRepository,
    required this.saleRepository,
    required this.darkMode,
    required this.onDarkModeChanged,
    required this.onSignedOut,
    super.key,
  });

  final RetivoxUser user;
  final AuthRepository repository;
  final DashboardRepository dashboardRepository;
  final SaleRepository saleRepository;
  final bool darkMode;
  final Future<void> Function(bool enabled) onDarkModeChanged;
  final VoidCallback onSignedOut;

  Future<void> _signOut(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out on this computer?'),
        content: const Text(
          'Signing out removes this account’s offline PIN access. Saved sales remain encrypted and will be available for sync after the account signs in online again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await repository.signOut(user);
    onSignedOut();
  }

  @override
  Widget build(BuildContext context) {
    return DashboardShell(
      user: user,
      dashboardRepository: dashboardRepository,
      saleRepository: saleRepository,
      darkMode: darkMode,
      onDarkModeChanged: onDarkModeChanged,
      onSignOut: () => _signOut(context),
    );
  }
}
