import 'package:flutter/material.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';

enum AdminManagementMode { create, invite, branches }

class AdminManagementDialog extends StatefulWidget {
  const AdminManagementDialog({
    required this.mode,
    required this.user,
    required this.repository,
    this.adminId,
    this.branches = const [],
    this.initialBranchIds = const [],
    super.key,
  });

  final AdminManagementMode mode;
  final RetivoxUser user;
  final DashboardRepository repository;
  final String? adminId;
  final List<Map<String, dynamic>> branches;
  final List<String> initialBranchIds;

  @override
  State<AdminManagementDialog> createState() => _AdminManagementDialogState();
}

class _AdminManagementDialogState extends State<AdminManagementDialog> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  late final Set<String> _selectedBranchIds = {...widget.initialBranchIds};
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  String get _title => switch (widget.mode) {
    AdminManagementMode.create => 'Create administrator',
    AdminManagementMode.invite => 'Invite administrator',
    AdminManagementMode.branches => 'Manage branch access',
  };

  Future<void> _submit() async {
    if (widget.mode != AdminManagementMode.branches &&
        !(_formKey.currentState?.validate() ?? false)) {
      return;
    }

    setState(() => _saving = true);
    try {
      switch (widget.mode) {
        case AdminManagementMode.create:
          await widget.repository.createAdmin(
            user: widget.user,
            name: _name.text,
            email: _email.text,
            phone: _phone.text,
            password: _password.text,
            branchIds: _selectedBranchIds.toList(),
          );
        case AdminManagementMode.invite:
          await widget.repository.inviteAdmin(
            user: widget.user,
            email: _email.text,
          );
        case AdminManagementMode.branches:
          await widget.repository.updateAdminBranches(
            user: widget.user,
            adminId: widget.adminId!,
            branchIds: _selectedBranchIds.toList(),
          );
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.toString())));
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_title),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.mode == AdminManagementMode.create) ...[
                  TextFormField(
                    controller: _name,
                    decoration: const InputDecoration(labelText: 'Full name'),
                    validator: (value) => value == null || value.trim().isEmpty
                        ? 'Enter the administrator name.'
                        : null,
                  ),
                  const SizedBox(height: 12),
                  _emailField(),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _phone,
                    decoration: const InputDecoration(labelText: 'Phone'),
                    validator: (value) => value == null || value.trim().isEmpty
                        ? 'Enter the administrator phone.'
                        : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _password,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Temporary password',
                    ),
                    validator: (value) => (value?.length ?? 0) < 8
                        ? 'Use at least 8 characters.'
                        : null,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Branch access',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  _branchChoices(),
                ],
                if (widget.mode == AdminManagementMode.invite) _emailField(),
                if (widget.mode == AdminManagementMode.branches) ...[
                  const Text(
                    'Select the branches this administrator can manage.',
                  ),
                  const SizedBox(height: 12),
                  _branchChoices(),
                ],
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _saving ? null : _submit,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(
                  widget.mode == AdminManagementMode.invite
                      ? 'Send invite'
                      : 'Save',
                ),
        ),
      ],
    );
  }

  Widget _emailField() => TextFormField(
    controller: _email,
    keyboardType: TextInputType.emailAddress,
    decoration: const InputDecoration(labelText: 'Email'),
    validator: (value) {
      final email = value?.trim() ?? '';
      return email.contains('@') && email.contains('.')
          ? null
          : 'Enter a valid email address.';
    },
  );

  Widget _branchChoices() {
    if (widget.branches.isEmpty) {
      return const Text('No active branches are available.');
    }
    return Wrap(
      spacing: 8,
      runSpacing: 4,
      children: widget.branches.map((branch) {
        final id = branch['id']?.toString() ?? '';
        final active = branch['is_active'] != false;
        final selected = _selectedBranchIds.contains(id);
        final name =
            '${branch['name']?.toString() ?? 'Branch'}${active ? '' : ' (Inactive)'}';
        return FilterChip(
          label: Text(name),
          selected: selected,
          onSelected: _saving || (!active && !selected)
              ? null
              : (selected) => setState(() {
                  if (selected) {
                    _selectedBranchIds.add(id);
                  } else {
                    _selectedBranchIds.remove(id);
                  }
                }),
        );
      }).toList(),
    );
  }
}
