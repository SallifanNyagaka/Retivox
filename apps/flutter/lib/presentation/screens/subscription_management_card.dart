import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';

class SubscriptionManagementCard extends StatefulWidget {
  const SubscriptionManagementCard({
    required this.user,
    required this.repository,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;

  @override
  State<SubscriptionManagementCard> createState() =>
      _SubscriptionManagementCardState();
}

class _SubscriptionManagementCardState
    extends State<SubscriptionManagementCard> {
  late Future<Map<String, dynamic>> _snapshot;
  final _reference = TextEditingController();
  final _phone = TextEditingController();
  String? _selectedPlanKey;
  String? _billingInterval;
  String _paymentMethod = 'mpesa_stk';
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _snapshot = widget.repository.loadSubscription(widget.user);
  }

  @override
  void dispose() {
    _reference.dispose();
    _phone.dispose();
    super.dispose();
  }

  void _refresh() {
    setState(() {
      _snapshot = widget.repository.loadSubscription(widget.user);
    });
  }

  Future<void> _submit() async {
    final snapshot = await _snapshot;
    final plans = _rows(snapshot['plans']);
    final subscription = _map(snapshot['subscription']);
    final activePlan =
        subscription?['plan']?.toString() ??
        _map(snapshot['business'])?['subscription_plan']?.toString() ??
        'trial';
    final billingInterval =
        _billingInterval ??
        subscription?['next_billing_interval']?.toString() ??
        subscription?['billing_interval']?.toString() ??
        'monthly';
    final planKey =
        _selectedPlanKey ??
        subscription?['next_plan_key']?.toString() ??
        (activePlan == 'trial' ? '' : activePlan);
    final plan = plans.where((item) => item['plan_key'] == planKey);
    if (planKey.isEmpty || plan.isEmpty) {
      _notify('Choose a subscription plan.');
      return;
    }
    final selectedPlan = plan.first;
    if (billingInterval == 'monthly' &&
            selectedPlan['monthly_enabled'] != true ||
        billingInterval == 'yearly' && selectedPlan['yearly_enabled'] != true ||
        billingInterval == 'lifetime' &&
            selectedPlan['lifetime_enabled'] != true) {
      _notify('That billing option is not available for the selected plan.');
      return;
    }
    final licenseType = subscription?['license_type']?.toString();
    if (licenseType == 'lifetime' && billingInterval != 'lifetime') {
      _notify(
        'A lifetime license can only be changed to another lifetime plan.',
      );
      return;
    }
    final paymentMethod =
        billingInterval == 'lifetime' && _paymentMethod == 'mpesa_stk'
        ? 'mpesa_manual'
        : _paymentMethod;
    if (paymentMethod == 'mpesa_stk' && _phone.text.trim().isEmpty) {
      _notify('Enter the Safaricom phone number for the M-Pesa prompt.');
      return;
    }
    if (paymentMethod != 'mpesa_stk' && _reference.text.trim().length < 3) {
      _notify('Enter a payment reference of at least 3 characters.');
      return;
    }

    setState(() => _saving = true);
    try {
      if (paymentMethod == 'mpesa_stk') {
        await widget.repository.initiateSubscriptionStkPush(
          user: widget.user,
          phone: _phone.text,
          planKey: planKey,
          billingInterval: billingInterval,
        );
        _notify('M-Pesa prompt sent. Complete it on your phone.');
      } else {
        await widget.repository.submitSubscriptionPayment(
          user: widget.user,
          planKey: planKey,
          billingInterval: billingInterval,
          paymentMethod: paymentMethod,
          referenceCode: _reference.text,
          payerPhone: _phone.text,
        );
        _reference.clear();
        _notify('Payment reference submitted for verification.');
      }
      _refresh();
    } catch (error) {
      _notify(error.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _notify(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Map<String, dynamic>>(
      future: _snapshot,
      builder: (context, result) {
        if (result.hasError) {
          return Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Subscription',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  Text(result.error.toString()),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: _refresh,
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry'),
                    ),
                  ),
                ],
              ),
            ),
          );
        }
        if (!result.hasData) {
          return const Card(
            child: Padding(
              padding: EdgeInsets.all(28),
              child: Center(child: CircularProgressIndicator()),
            ),
          );
        }

        final snapshot = result.data!;
        final business = _map(snapshot['business']);
        final subscription = _map(snapshot['subscription']);
        final plans = _rows(snapshot['plans']);
        final payments = _rows(snapshot['paymentRequests']);
        final activePlan =
            subscription?['plan']?.toString() ??
            business?['subscription_plan']?.toString() ??
            'trial';
        final billingInterval =
            _billingInterval ??
            subscription?['next_billing_interval']?.toString() ??
            subscription?['billing_interval']?.toString() ??
            'monthly';
        final lifetimeLicense =
            subscription?['license_type']?.toString() == 'lifetime';
        final effectivePaymentMethod =
            billingInterval == 'lifetime' && _paymentMethod == 'mpesa_stk'
            ? 'mpesa_manual'
            : _paymentMethod;
        final selectedPlanKey =
            _selectedPlanKey ??
            subscription?['next_plan_key']?.toString() ??
            (activePlan == 'trial' ? null : activePlan);
        final selectedPlan = plans.where(
          (plan) => plan['plan_key'] == selectedPlanKey,
        );
        final selected = selectedPlan.isEmpty ? null : selectedPlan.first;
        final unroundedAmount = selected == null
            ? 0.0
            : billingInterval == 'yearly'
            ? double.tryParse(selected['yearly_amount']?.toString() ?? '') ?? 0
            : billingInterval == 'lifetime'
            ? double.tryParse(selected['lifetime_amount']?.toString() ?? '') ??
                  0
            : double.tryParse(selected['monthly_amount']?.toString() ?? '') ??
                  0;
        final amount = (unroundedAmount * 100).round() / 100;
        final currency =
            selected?['currency']?.toString() ?? widget.user.currency;

        return Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Subscription',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ),
                    IconButton(
                      tooltip: 'Refresh subscription',
                      onPressed: _saving ? null : _refresh,
                      icon: const Icon(Icons.refresh),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  '${_planName(plans, activePlan)} · ${business?['subscription_status'] ?? subscription?['status'] ?? 'Unknown status'}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                if (subscription?['current_period_end'] != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Current period ends ${_formatDate(subscription!['current_period_end'])}',
                  ),
                ],
                if (subscription?['next_plan_key'] != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Pending plan: ${_planName(plans, subscription!['next_plan_key'].toString())} · awaits payment verification.',
                  ),
                ],
                const Divider(height: 28),
                Text(
                  lifetimeLicense
                      ? 'Choose a lifetime plan'
                      : 'Choose or upgrade your plan',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _intervalChip(
                      'monthly',
                      'Monthly',
                      billingInterval,
                      disabled: lifetimeLicense,
                    ),
                    _intervalChip(
                      'yearly',
                      'Yearly',
                      billingInterval,
                      disabled: lifetimeLicense,
                    ),
                    _intervalChip('lifetime', 'Lifetime', billingInterval),
                  ],
                ),
                if (lifetimeLicense) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Lifetime licenses can be upgraded to another lifetime tier; recurring billing is not available.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
                const SizedBox(height: 12),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: plans
                      .where((plan) => plan['plan_key'] != 'trial')
                      .map((plan) {
                        final key = plan['plan_key']?.toString() ?? '';
                        final current = key == activePlan;
                        final isSelected = key == selectedPlanKey;
                        final available = billingInterval == 'monthly'
                            ? plan['monthly_enabled'] == true
                            : billingInterval == 'yearly'
                            ? plan['yearly_enabled'] == true
                            : plan['lifetime_enabled'] == true;
                        final planPrice = billingInterval == 'lifetime'
                            ? double.tryParse(
                                    plan['lifetime_amount']?.toString() ?? '',
                                  ) ??
                                  0
                            : billingInterval == 'yearly'
                            ? double.tryParse(
                                    plan['yearly_amount']?.toString() ?? '',
                                  ) ??
                                  0
                            : double.tryParse(
                                    plan['monthly_amount']?.toString() ?? '',
                                  ) ??
                                  0;
                        final planCurrency =
                            plan['currency']?.toString() ?? currency;
                        return SizedBox(
                          width: 230,
                          child: InkWell(
                            borderRadius: BorderRadius.circular(12),
                            onTap:
                                _saving ||
                                    !available ||
                                    (lifetimeLicense &&
                                        billingInterval != 'lifetime')
                                ? null
                                : () => setState(() => _selectedPlanKey = key),
                            child: Container(
                              constraints: const BoxConstraints(minHeight: 144),
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: isSelected
                                    ? Theme.of(context)
                                          .colorScheme
                                          .primaryContainer
                                    : Theme.of(context).colorScheme.surface,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: isSelected || current
                                      ? Theme.of(context).colorScheme.primary
                                      : Theme.of(context).dividerColor,
                                  width: isSelected ? 2 : 1,
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          plan['name']?.toString() ?? key,
                                          style: Theme.of(context)
                                              .textTheme
                                              .titleSmall
                                              ?.copyWith(
                                                fontWeight: FontWeight.w700,
                                              ),
                                        ),
                                      ),
                                      if (current)
                                        const Chip(label: Text('Current')),
                                      if (!current && isSelected)
                                        const Chip(label: Text('Selected')),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    available
                                        ? _formatMoney(planPrice, planCurrency)
                                        : 'Not available',
                                    style: Theme.of(context)
                                        .textTheme
                                        .titleLarge
                                        ?.copyWith(fontWeight: FontWeight.w800),
                                  ),
                                  Text(
                                    billingInterval == 'monthly'
                                        ? 'per month'
                                        : billingInterval == 'yearly'
                                        ? 'per year'
                                        : 'one-time payment',
                                    style: Theme.of(context)
                                        .textTheme
                                        .bodySmall,
                                  ),
                                  if ((plan['description']?.toString() ?? '')
                                      .isNotEmpty) ...[
                                    const SizedBox(height: 8),
                                    Text(
                                      plan['description'].toString(),
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ),
                        );
                      })
                      .toList(),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: effectivePaymentMethod,
                  decoration: const InputDecoration(
                    labelText: 'Payment method',
                  ),
                  items: [
                    if (billingInterval != 'lifetime')
                      const DropdownMenuItem(
                        value: 'mpesa_stk',
                        child: Text('M-Pesa prompt'),
                      ),
                    DropdownMenuItem(
                      value: 'mpesa_manual',
                      child: Text('M-Pesa reference'),
                    ),
                    DropdownMenuItem(
                      value: 'bank_transfer',
                      child: Text('Bank transfer'),
                    ),
                    DropdownMenuItem(
                      value: 'cash_deposit',
                      child: Text('Cash deposit'),
                    ),
                    DropdownMenuItem(value: 'other', child: Text('Other')),
                  ],
                  onChanged: _saving
                      ? null
                      : (value) {
                          if (value != null) {
                            setState(() => _paymentMethod = value);
                          }
                        },
                ),
                if (effectivePaymentMethod == 'mpesa_stk' ||
                    effectivePaymentMethod == 'mpesa_manual') ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'M-Pesa phone number',
                    ),
                  ),
                ],
                if (effectivePaymentMethod != 'mpesa_stk') ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _reference,
                    decoration: const InputDecoration(
                      labelText: 'Payment reference',
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                Text(
                  selected == null
                      ? 'Choose a plan to view the payment amount.'
                      : 'Amount due: ${_formatMoney(amount, currency)}',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 12),
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilledButton.icon(
                    onPressed: _saving ? null : _submit,
                    icon: _saving
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.payment_outlined),
                    label: Text(
                      effectivePaymentMethod == 'mpesa_stk'
                          ? 'Send M-Pesa prompt'
                          : 'Upgrade / continue with selected plan',
                    ),
                  ),
                ),
                if (payments.isNotEmpty) ...[
                  const Divider(height: 32),
                  Text(
                    'Recent payment requests',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  ...payments.take(5).map(_paymentTile),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _intervalChip(
    String value,
    String label,
    String selected, {
    bool disabled = false,
  }) => FilterChip(
    label: Text(label),
    selected: selected == value,
    onSelected: _saving || disabled
        ? null
        : (enabled) {
            if (!enabled) return;
            setState(() {
              _billingInterval = value;
              if (value == 'lifetime' && _paymentMethod == 'mpesa_stk') {
                _paymentMethod = 'mpesa_manual';
              }
            });
          },
  );

  Widget _paymentTile(Map<String, dynamic> payment) {
    final amount = double.tryParse(payment['amount']?.toString() ?? '') ?? 0;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        payment['status'] == 'verified'
            ? Icons.check_circle_outline
            : payment['status'] == 'rejected'
            ? Icons.cancel_outlined
            : Icons.schedule_outlined,
      ),
      title: Text(
        '${_formatMoney(amount, payment['currency']?.toString() ?? widget.user.currency)} · ${payment['plan_key'] ?? 'Plan'}',
      ),
      subtitle: Text(
        '${payment['payment_method'] ?? 'Payment'} · ${payment['reference_code'] ?? '—'} · ${payment['status'] ?? 'pending'}',
      ),
      trailing: Text(_formatDate(payment['submitted_at'])),
      isThreeLine: true,
    );
  }

  static List<Map<String, dynamic>> _rows(dynamic value) => value is List
      ? value.whereType<Map<String, dynamic>>().toList()
      : const [];

  static Map<String, dynamic>? _map(dynamic value) =>
      value is Map<String, dynamic> ? value : null;

  static String _planName(List<Map<String, dynamic>> plans, String key) {
    for (final plan in plans) {
      if (plan['plan_key'] == key) return plan['name']?.toString() ?? key;
    }
    return key == 'trial' ? 'Free' : key;
  }

  static String _formatDate(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '');
    return date == null ? '—' : DateFormat.yMMMd().format(date.toLocal());
  }

  static String _formatMoney(double value, String currency) {
    try {
      return NumberFormat.simpleCurrency(name: currency).format(value);
    } on ArgumentError {
      return '$currency ${value.toStringAsFixed(2)}';
    }
  }
}
