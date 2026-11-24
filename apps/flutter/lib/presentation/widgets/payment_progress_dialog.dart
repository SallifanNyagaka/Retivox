import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/sales/sale_repository.dart';

class PaymentProgressDialog extends StatefulWidget {
  const PaymentProgressDialog({
    required this.user,
    required this.repository,
    required this.paymentId,
    this.onStartPrompt,
    required this.onPrintReceipt,
    super.key,
  });

  final RetivoxUser user;
  final SaleRepository repository;
  final String paymentId;
  final Future<void> Function()? onStartPrompt;
  final VoidCallback onPrintReceipt;

  @override
  State<PaymentProgressDialog> createState() => _PaymentProgressDialogState();
}

class _PaymentProgressDialogState extends State<PaymentProgressDialog> {
  Timer? _pollTimer;
  Map<String, dynamic>? _attempt;
  bool _loading = false;
  bool _unavailable = false;
  bool _starting = false;
  String? _startError;

  @override
  void initState() {
    super.initState();
    if (widget.onStartPrompt != null) {
      _starting = true;
      unawaited(_startPrompt());
    } else {
      unawaited(_refresh());
    }
    _pollTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      unawaited(_refresh());
    });
  }

  Future<void> _startPrompt() async {
    try {
      await widget.onStartPrompt?.call();
    } catch (error) {
      if (mounted) setState(() => _startError = error.toString());
    } finally {
      if (mounted) setState(() => _starting = false);
      await _refresh();
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    if (_loading) return;
    _loading = true;
    try {
      final attempt = await widget.repository.loadPaymentAttemptStatus(
        widget.user,
        widget.paymentId,
      );
      if (!mounted) return;
      setState(() {
        if (attempt != null) _attempt = attempt;
        _unavailable = attempt == null;
      });
    } catch (_) {
      if (mounted) setState(() => _unavailable = true);
    } finally {
      _loading = false;
    }
  }

  String _money(Object? value) {
    final amount = double.tryParse(value?.toString() ?? '');
    return amount == null
        ? '—'
        : '${widget.user.currency} ${amount.toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    final status = _attempt?['status']?.toString().toLowerCase() ?? '';
    final succeeded = status == 'verified' || status == 'succeeded';
    final failed = status == 'rejected' || status == 'failed';
    final title = _starting
        ? 'Preparing payment...'
        : _startError != null
        ? 'Prompt could not be sent'
        : succeeded
        ? 'Payment successful'
        : failed
        ? 'Payment unsuccessful'
        : 'Check your phone';
    final detail = _starting
        ? 'Retivox is saving the payment attempt and contacting Safaricom.'
        : _startError != null
        ? 'The sale remains saved, but the prompt was not confirmed as sent. Do not record this sale again. ${_startError!}'
        : succeeded
        ? 'Safaricom confirmed this payment. Retivox has saved the verified result.'
        : failed
        ? 'The payment attempt failed. The saved sale is available in the transaction history.'
        : 'Enter your M-PESA PIN. Retivox is waiting for provider confirmation.';

    return AlertDialog(
      title: Column(
        children: [
          if (_starting || (!succeeded && !failed && _startError == null))
            const Padding(
              padding: EdgeInsets.only(bottom: 14),
              child: CircularProgressIndicator(),
            )
          else
            Icon(
              succeeded ? Icons.check_circle_rounded : Icons.error_rounded,
              size: 52,
              color: succeeded ? Colors.green : Colors.red,
            ),
          Text(title, textAlign: TextAlign.center),
        ],
      ),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(detail, textAlign: TextAlign.center),
            if (_attempt != null) ...[
              const SizedBox(height: 16),
              _row('Amount', _money(_attempt!['amount'])),
              _row(
                'Method',
                (_attempt!['payment_method']?.toString() ?? 'M-PESA')
                    .replaceAll('_', ' '),
              ),
              _row('Status', status.replaceAll('_', ' ')),
              if (succeeded && _attempt!['confirmed_reference'] != null)
                _row('Reference', _attempt!['confirmed_reference'].toString()),
              if (succeeded && _attempt!['verified_at'] != null)
                _row(
                  'Confirmed',
                  DateTime.tryParse(_attempt!['verified_at'].toString())
                          ?.toLocal()
                          .toString() ??
                      '',
                ),
            ],
            if (_unavailable) ...[
              const SizedBox(height: 12),
              const Text(
                'Status could not be refreshed. The payment remains saved and can be checked again when Retivox is reachable.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.orange),
              ),
            ],
          ],
        ),
      ),
      actionsAlignment: MainAxisAlignment.center,
      actions: [
        if (!_starting && !succeeded && !failed && _startError == null)
          TextButton.icon(
            onPressed: _loading ? null : _refresh,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Check status'),
          ),
        if (succeeded)
          FilledButton.icon(
            onPressed: widget.onPrintReceipt,
            icon: const Icon(Icons.print_rounded),
            label: const Text('Print receipt'),
          ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Close'),
        ),
      ],
    );
  }

  Widget _row(String label, String value) => Padding(
    padding: const EdgeInsets.only(top: 7),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 88, child: Text(label)),
        Expanded(child: Text(value, textAlign: TextAlign.right)),
      ],
    ),
  );
}
