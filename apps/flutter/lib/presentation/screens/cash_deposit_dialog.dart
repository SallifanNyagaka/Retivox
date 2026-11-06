import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';

class CashDepositDialog extends StatefulWidget {
  const CashDepositDialog({
    required this.user,
    required this.repository,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;

  @override
  State<CashDepositDialog> createState() => _CashDepositDialogState();
}

class _CashDepositDialogState extends State<CashDepositDialog> {
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  final _note = TextEditingController();
  late String? _branchId;
  DateTime _date = DateTime.now();
  bool _saving = false;
  String? _error;

  List<BranchAccess> get _managedBranches => widget.user.branches
      .where((branch) => branch.role == 'admin' || branch.role == 'owner')
      .toList();

  @override
  void initState() {
    super.initState();
    _branchId = _managedBranches.firstOrNull?.id;
  }

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Record branch cash deposit'),
    content: SizedBox(
      width: 440,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _branchId,
              decoration: const InputDecoration(labelText: 'Branch'),
              items: _managedBranches
                  .map(
                    (branch) => DropdownMenuItem(
                      value: branch.id,
                      child: Text(branch.name),
                    ),
                  )
                  .toList(),
              onChanged: _saving
                  ? null
                  : (value) => setState(() => _branchId = value),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _amount,
              enabled: !_saving,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: InputDecoration(
                labelText: 'Deposited amount',
                prefixText: '${widget.user.currency} ',
              ),
            ),
            TextField(
              controller: _reference,
              enabled: !_saving,
              maxLength: 80,
              decoration: const InputDecoration(
                labelText: 'Deposit / bank reference',
              ),
            ),
            TextField(
              controller: _note,
              enabled: !_saving,
              maxLength: 180,
              decoration: const InputDecoration(labelText: 'Note (optional)'),
            ),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: _saving
                    ? null
                    : () async {
                        final selected = await showDatePicker(
                          context: context,
                          initialDate: _date,
                          firstDate: DateTime(2000),
                          lastDate: DateTime.now(),
                        );
                        if (selected != null) {
                          setState(() => _date = selected);
                        }
                      },
                icon: const Icon(Icons.calendar_today_outlined),
                label: Text(DateFormat.yMMMd().format(_date)),
              ),
            ),
            if (_error != null)
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: _saving ? null : () => Navigator.pop(context, false),
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
            : const Text('Record deposit'),
      ),
    ],
  );

  Future<void> _submit() async {
    final amount = double.tryParse(_amount.text.trim());
    if (_branchId == null ||
        amount == null ||
        !amount.isFinite ||
        amount <= 0 ||
        _reference.text.trim().length < 3) {
      setState(
        () => _error =
            'Choose a branch and enter a positive amount and reference.',
      );
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.repository.recordCashDeposit(
        widget.user,
        branchId: _branchId!,
        depositDate: _date,
        amount: amount,
        reference: _reference.text,
        note: _note.text,
      );
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}
