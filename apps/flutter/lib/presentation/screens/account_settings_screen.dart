import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';
import 'subscription_management_card.dart';

class AccountSettingsScreen extends StatefulWidget {
  const AccountSettingsScreen({
    required this.user,
    required this.repository,
    required this.darkMode,
    required this.onDarkModeChanged,
    required this.onSignOut,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;
  final bool darkMode;
  final Future<void> Function(bool enabled) onDarkModeChanged;
  final VoidCallback onSignOut;

  @override
  State<AccountSettingsScreen> createState() => _AccountSettingsScreenState();
}

class _AccountSettingsScreenState extends State<AccountSettingsScreen> {
  late Future<DashboardSnapshot> _snapshot;

  @override
  void initState() {
    super.initState();
    _snapshot = widget.repository.loadSection(widget.user, 'settings');
  }

  void _refresh() {
    setState(() {
      _snapshot = widget.repository.loadSection(widget.user, 'settings');
    });
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
                    Text('Settings', style: theme.textTheme.headlineSmall),
                    const SizedBox(height: 6),
                    Text(
                      'Account and business information for this signed-in user.',
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
            const SizedBox(height: 16),
            _profileCard(context, result.data!.rows.single),
            const SizedBox(height: 16),
            _branchCard(context),
            if (widget.user.role == RetivoxRole.owner) ...[
              const SizedBox(height: 16),
              SubscriptionManagementCard(
                user: widget.user,
                repository: widget.repository,
              ),
            ],
            const SizedBox(height: 16),
            Card(
              child: SwitchListTile(
                secondary: const Icon(Icons.dark_mode_outlined),
                title: const Text('Dark appearance'),
                subtitle: const Text(
                  'Use a dark color scheme on this computer.',
                ),
                value: widget.darkMode,
                onChanged: (enabled) async {
                  try {
                    await widget.onDarkModeChanged(enabled);
                  } catch (error) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            'Could not save appearance preference: $error',
                          ),
                        ),
                      );
                    }
                  }
                },
              ),
            ),
            const SizedBox(height: 16),
            Card(
              child: ListTile(
                leading: const Icon(Icons.logout),
                title: const Text('Sign out'),
                subtitle: const Text(
                  'Signing out clears this account’s offline access on this computer.',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: widget.onSignOut,
              ),
            ),
            const SizedBox(height: 8),
            if (widget.user.role == RetivoxRole.owner)
              Text(
                'Subscription payments are processed online. The server verifies payment before changing the plan.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
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
              ? 'Showing saved account information${timestamp == null ? '' : ' · last refreshed ${DateFormat.yMMMd().add_jm().format(timestamp)}'}'
              : 'Showing latest account information${timestamp == null ? '' : ' · refreshed ${DateFormat.yMMMd().add_jm().format(timestamp)}'}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }

  Widget _profileCard(BuildContext context, Map<String, dynamic> profile) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Account', style: theme.textTheme.titleLarge),
            const SizedBox(height: 14),
            _field('Name', profile['name']?.toString()),
            _field('Email', profile['email']?.toString()),
            _field('Phone', profile['phone']?.toString()),
            _field('Role', _capitalize(profile['global_role']?.toString())),
            _field(
              'Account status',
              profile['is_active'] == true ? 'Active' : 'Inactive',
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: () => _editPersonalProfile(profile),
                  icon: const Icon(Icons.person_outline),
                  label: const Text('Edit personal details'),
                ),
                OutlinedButton.icon(
                  onPressed: _changePassword,
                  icon: const Icon(Icons.lock_outline),
                  label: const Text('Change password'),
                ),
              ],
            ),
            const Divider(height: 28),
            Text('Business', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            _field('Business', profile['business_name']?.toString()),
            _field('Currency', profile['business_currency']?.toString()),
            _field('Country', profile['business_country']?.toString()),
            _field('Time zone', profile['business_timezone']?.toString()),
            if (widget.user.role == RetivoxRole.owner) ...[
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  onPressed: () => _editBusiness(profile),
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('Edit business profile'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _editPersonalProfile(Map<String, dynamic> profile) async {
    final name = TextEditingController(text: profile['name']?.toString() ?? '');
    final phone = TextEditingController(
      text: profile['phone']?.toString() ?? '',
    );
    var saving = false;
    String? error;
    try {
      final saved = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: const Text('Edit personal details'),
            content: SizedBox(
              width: 420,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: name,
                    enabled: !saving,
                    maxLength: 120,
                    decoration: const InputDecoration(labelText: 'Name'),
                  ),
                  TextField(
                    controller: phone,
                    enabled: !saving,
                    maxLength: 40,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'Phone'),
                  ),
                  if (error != null)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                ],
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
                        setDialogState(() {
                          saving = true;
                          error = null;
                        });
                        try {
                          await widget.repository.updatePersonalProfile(
                            widget.user,
                            name: name.text,
                            phone: phone.text,
                          );
                          if (!dialogContext.mounted) return;
                          Navigator.pop(dialogContext, true);
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
                    : const Text('Save details'),
              ),
            ],
          ),
        ),
      );
      if (saved == true && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Personal details updated.')),
        );
      }
    } finally {
      name.dispose();
      phone.dispose();
    }
  }

  Future<void> _changePassword() async {
    final currentPassword = TextEditingController();
    final newPassword = TextEditingController();
    final confirmation = TextEditingController();
    var saving = false;
    String? error;
    try {
      final saved = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: const Text('Change password'),
            content: SizedBox(
              width: 420,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final entry in [
                    ('Current password', currentPassword),
                    ('New password', newPassword),
                    ('Confirm new password', confirmation),
                  ])
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: TextField(
                        controller: entry.$2,
                        enabled: !saving,
                        obscureText: true,
                        decoration: InputDecoration(labelText: entry.$1),
                      ),
                    ),
                  if (error != null)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Use at least 8 characters with uppercase, lowercase, and a number.',
                    ),
                  ),
                ],
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
                        setDialogState(() {
                          saving = true;
                          error = null;
                        });
                        try {
                          await widget.repository.changePassword(
                            widget.user,
                            currentPassword: currentPassword.text,
                            newPassword: newPassword.text,
                            confirmation: confirmation.text,
                          );
                          if (!dialogContext.mounted) return;
                          Navigator.pop(dialogContext, true);
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
                    : const Text('Update password'),
              ),
            ],
          ),
        ),
      );
      if (saved == true && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Password updated successfully.')),
        );
      }
    } finally {
      currentPassword.dispose();
      newPassword.dispose();
      confirmation.dispose();
    }
  }

  Future<void> _editBusiness(Map<String, dynamic> profile) async {
    final name = TextEditingController(
      text: profile['business_name']?.toString() ?? '',
    );
    final country = TextEditingController(
      text: profile['business_country']?.toString() ?? '',
    );
    final currency = TextEditingController(
      text: profile['business_currency']?.toString() ?? '',
    );
    final timezone = TextEditingController(
      text: profile['business_timezone']?.toString() ?? '',
    );
    var saving = false;
    String? error;
    try {
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: const Text('Edit business profile'),
            content: SizedBox(
              width: 440,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: name,
                      enabled: !saving,
                      maxLength: 120,
                      decoration: const InputDecoration(
                        labelText: 'Business name',
                      ),
                    ),
                    TextField(
                      controller: country,
                      enabled: !saving,
                      maxLength: 2,
                      decoration: const InputDecoration(
                        labelText: 'Country code',
                        hintText: 'KE',
                      ),
                    ),
                    TextField(
                      controller: currency,
                      enabled: !saving,
                      maxLength: 3,
                      decoration: const InputDecoration(
                        labelText: 'Currency code',
                        hintText: 'KES',
                      ),
                    ),
                    TextField(
                      controller: timezone,
                      enabled: !saving,
                      maxLength: 80,
                      decoration: const InputDecoration(
                        labelText: 'Time zone',
                        hintText: 'Africa/Nairobi',
                      ),
                    ),
                    if (error != null)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
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
                        setDialogState(() {
                          saving = true;
                          error = null;
                        });
                        try {
                          await widget.repository.updateBusinessProfile(
                            widget.user,
                            name: name.text,
                            country: country.text,
                            currency: currency.text,
                            timezone: timezone.text,
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
                    : const Text('Save business profile'),
              ),
            ],
          ),
        ),
      );
    } finally {
      name.dispose();
      country.dispose();
      currency.dispose();
      timezone.dispose();
    }
  }

  Widget _branchCard(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Branch access', style: theme.textTheme.titleLarge),
            const SizedBox(height: 8),
            if (widget.user.branches.isEmpty)
              const Text('No branch assignments are saved for this account.')
            else
              for (final branch in widget.user.branches)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.store_outlined),
                  title: Text(branch.name),
                  subtitle: Text('${_capitalize(branch.role)} access'),
                ),
          ],
        ),
      ),
    );
  }

  Widget _field(String label, String? rawValue) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 140, child: Text(label)),
        Expanded(
          child: SelectableText(
            rawValue == null || rawValue.trim().isEmpty ? '—' : rawValue,
          ),
        ),
      ],
    ),
  );

  String _capitalize(String? value) {
    if (value == null || value.isEmpty) return '—';
    return value[0].toUpperCase() + value.substring(1);
  }
}
