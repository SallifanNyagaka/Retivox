import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/retivox_user.dart';
import '../../features/dashboard/dashboard_repository.dart';

class BusinessPaymentSettingsPanel extends StatefulWidget {
  const BusinessPaymentSettingsPanel({
    required this.user,
    required this.repository,
    super.key,
  });

  final RetivoxUser user;
  final DashboardRepository repository;

  @override
  State<BusinessPaymentSettingsPanel> createState() =>
      _BusinessPaymentSettingsPanelState();
}

class _BusinessPaymentSettingsPanelState
    extends State<BusinessPaymentSettingsPanel> {
  late Future<BusinessPaymentSettingsSnapshot> _settings;
  String? _busyAction;
  String? _notice;
  String? _error;

  @override
  void initState() {
    super.initState();
    _settings = widget.repository.loadBusinessPaymentSettings(widget.user);
  }

  @override
  void didUpdateWidget(covariant BusinessPaymentSettingsPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.user.id != widget.user.id ||
        oldWidget.repository != widget.repository) {
      _settings = widget.repository.loadBusinessPaymentSettings(widget.user);
      _error = null;
      _notice = null;
    }
  }

  Future<void> _refresh() async {
    setState(() {
      _error = null;
      _settings = widget.repository.loadBusinessPaymentSettings(widget.user);
    });
    try {
      await _settings;
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _save(Map<String, Object?> data) async {
    final provider = data['provider']?.toString() ?? '';
    setState(() {
      _busyAction = 'save:$provider';
      _error = null;
      _notice = null;
    });
    try {
      await widget.repository.saveBusinessPaymentProvider(widget.user, data);
      if (mounted) {
        setState(() {
          _notice = 'Provider settings saved securely.';
          _settings = widget.repository.loadBusinessPaymentSettings(
            widget.user,
          );
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  Future<void> _runAction(String action, {String? provider}) async {
    setState(() {
      _busyAction = '$action:${provider ?? ''}';
      _error = null;
      _notice = null;
    });
    try {
      final message = await widget.repository.runBusinessPaymentProviderAction(
        widget.user,
        action: action,
        provider: provider,
      );
      if (mounted) {
        setState(() {
          _notice = message;
          _settings = widget.repository.loadBusinessPaymentSettings(
            widget.user,
          );
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busyAction = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  Icons.account_balance_wallet_outlined,
                  color: theme.colorScheme.primary,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Payments & checkout',
                    style: theme.textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh payment settings',
                  onPressed: _busyAction == null ? _refresh : null,
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
            const SizedBox(height: 5),
            Text(
              'Choose how customers can pay. Provider credentials are saved securely online and are never stored in this computer’s cache.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 14),
            FutureBuilder<BusinessPaymentSettingsSnapshot>(
              future: _settings,
              builder: (context, result) {
                if (result.connectionState == ConnectionState.waiting &&
                    !result.hasData) {
                  return const Padding(
                    padding: EdgeInsets.all(16),
                    child: LinearProgressIndicator(),
                  );
                }
                if (result.hasError && !result.hasData) {
                  return Text(
                    result.error.toString(),
                    style: TextStyle(color: theme.colorScheme.error),
                  );
                }
                final snapshot = result.data;
                final providers = snapshot?.providers ?? const [];
                final daraja = _provider(providers, 'daraja');
                final pesapal = _provider(providers, 'pesapal');
                final online = snapshot != null && !snapshot.isCached;
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (snapshot?.isCached == true)
                      _NoticeBox(
                        icon: Icons.cloud_off_outlined,
                        color: theme.colorScheme.tertiary,
                        text: 'Showing the last saved settings. Provider changes, tests, and callback registration need a live connection.',
                      ),
                    if (snapshot?.updatedAt case final updatedAt?)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Text(
                          'Refreshed ${DateFormat.yMMMd().add_jm().format(updatedAt)}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        _MethodStatus(
                          icon: Icons.payments_outlined,
                          label: 'Cash',
                          detail: 'Available online and offline',
                          enabled: true,
                        ),
                        _MethodStatus(
                          icon: Icons.phone_android_outlined,
                          label: 'Mobile manual',
                          detail: 'Available online and offline',
                          enabled: true,
                        ),
                        _MethodStatus(
                          icon: Icons.phone_in_talk_outlined,
                          label: 'M-Pesa prompt',
                          detail: 'Daraja · online only',
                          enabled: _configured(daraja, 'daraja'),
                        ),
                        _MethodStatus(
                          icon: Icons.credit_card_outlined,
                          label: 'Card & bank checkout',
                          detail: 'Pesapal · online only',
                          enabled:
                              _configured(pesapal, 'pesapal') &&
                              pesapal?['pesapal_ipn_ready'] == true,
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    _ProviderEditor(
                      provider: 'daraja',
                      settings: daraja,
                      enabled: online && _busyAction == null,
                      saving: _busyAction == 'save:daraja',
                      testing: _busyAction == 'test:daraja',
                      registering: _busyAction == 'register_daraja_c2b:',
                      defaultCallbackUrl: _defaultCallback(
                        '/api/payments/daraja/callback',
                      ),
                      onSave: _save,
                      onTest: () => _runAction('test', provider: 'daraja'),
                      onRegister: () => _runAction('register_daraja_c2b'),
                    ),
                    const SizedBox(height: 8),
                    _ProviderEditor(
                      provider: 'pesapal',
                      settings: pesapal,
                      enabled: online && _busyAction == null,
                      saving: _busyAction == 'save:pesapal',
                      testing: _busyAction == 'test:pesapal',
                      registering: _busyAction == 'register_pesapal_ipn:',
                      defaultCallbackUrl: _defaultCallback(
                        '/api/payments/pesapal/ipn',
                      ),
                      onSave: _save,
                      onTest: () => _runAction('test', provider: 'pesapal'),
                      onRegister: () => _runAction('register_pesapal_ipn'),
                    ),
                    if (_notice != null) ...[
                      const SizedBox(height: 10),
                      _NoticeBox(
                        icon: Icons.check_circle_outline,
                        color: theme.colorScheme.primary,
                        text: _notice!,
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 10),
                      _NoticeBox(
                        icon: Icons.error_outline,
                        color: theme.colorScheme.error,
                        text: _error!,
                      ),
                    ],
                    const SizedBox(height: 10),
                    Text(
                      'Card and bank checkout remain pending until Pesapal confirms payment. Online methods are also subject to your subscription plan. Offline checkout continues to allow Cash and Mobile manual.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Map<String, dynamic>? _provider(
    List<Map<String, dynamic>> providers,
    String name,
  ) {
    for (final item in providers) {
      if (item['provider'] == name) return item;
    }
    return null;
  }

  bool _configured(Map<String, dynamic>? settings, String provider) {
    if (settings == null || settings['is_active'] != true) return false;
    return settings['consumer_key_set'] == true &&
        settings['consumer_secret_set'] == true &&
        (provider != 'daraja' || settings['passkey_set'] == true);
  }

  String _defaultCallback(String path) {
    final base = widget.repository.webApiClient?.baseUrl.trim() ?? '';
    final uri = Uri.tryParse(base);
    if (uri == null || !uri.hasAuthority) return '';
    return uri.resolve(path).toString();
  }
}

class _ProviderEditor extends StatefulWidget {
  const _ProviderEditor({
    required this.provider,
    required this.settings,
    required this.enabled,
    required this.saving,
    required this.testing,
    required this.registering,
    required this.defaultCallbackUrl,
    required this.onSave,
    required this.onTest,
    required this.onRegister,
  });

  final String provider;
  final Map<String, dynamic>? settings;
  final bool enabled;
  final bool saving;
  final bool testing;
  final bool registering;
  final String defaultCallbackUrl;
  final Future<void> Function(Map<String, Object?> data) onSave;
  final VoidCallback onTest;
  final VoidCallback onRegister;

  @override
  State<_ProviderEditor> createState() => _ProviderEditorState();
}

class _ProviderEditorState extends State<_ProviderEditor> {
  late final TextEditingController _shortcode;
  late final TextEditingController _tillNumber;
  late final TextEditingController _reference;
  late final TextEditingController _callback;
  late final TextEditingController _consumerKey;
  late final TextEditingController _consumerSecret;
  late final TextEditingController _passkey;
  late String _environment;
  late String _transactionType;
  bool _expanded = false;

  bool get _isDaraja => widget.provider == 'daraja';

  @override
  void initState() {
    super.initState();
    final settings = widget.settings;
    _shortcode = TextEditingController(
      text: settings?['business_shortcode']?.toString() ?? '',
    );
    _tillNumber = TextEditingController(
      text: settings?['till_number']?.toString() ?? '',
    );
    _reference = TextEditingController(
      text: settings?['account_reference']?.toString() ?? 'RETIVOX',
    );
    _callback = TextEditingController(
      text: settings?['callback_url']?.toString() ?? widget.defaultCallbackUrl,
    );
    _consumerKey = TextEditingController();
    _consumerSecret = TextEditingController();
    _passkey = TextEditingController();
    _environment = settings?['environment']?.toString() ?? 'sandbox';
    _transactionType =
        settings?['transaction_type']?.toString() ?? 'CustomerPayBillOnline';
  }

  @override
  void didUpdateWidget(covariant _ProviderEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.settings, widget.settings)) {
      final settings = widget.settings;
      _shortcode.text = settings?['business_shortcode']?.toString() ?? '';
      _tillNumber.text = settings?['till_number']?.toString() ?? '';
      _reference.text = settings?['account_reference']?.toString() ?? 'RETIVOX';
      _callback.text =
          settings?['callback_url']?.toString() ?? widget.defaultCallbackUrl;
      _environment = settings?['environment']?.toString() ?? 'sandbox';
      _transactionType =
          settings?['transaction_type']?.toString() ?? 'CustomerPayBillOnline';
    }
  }

  @override
  void dispose() {
    _shortcode.dispose();
    _tillNumber.dispose();
    _reference.dispose();
    _callback.dispose();
    _consumerKey.dispose();
    _consumerSecret.dispose();
    _passkey.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final configured =
        widget.settings?['is_active'] == true &&
        widget.settings?['consumer_key_set'] == true &&
        widget.settings?['consumer_secret_set'] == true &&
        (!_isDaraja || widget.settings?['passkey_set'] == true);
    final callbackReady = _isDaraja
        ? configured
        : configured && widget.settings?['pesapal_ipn_ready'] == true;
    return Card.outlined(
      child: ExpansionTile(
        initiallyExpanded: _expanded,
        onExpansionChanged: (value) => setState(() => _expanded = value),
        leading: Icon(
          _isDaraja ? Icons.phone_android : Icons.credit_card,
          color: theme.colorScheme.primary,
        ),
        title: Text(
          _isDaraja ? 'M-Pesa Daraja prompt' : 'Card & bank checkout',
        ),
        subtitle: Text(
          !configured
              ? 'Not configured'
              : callbackReady
              ? 'Configured and ready'
              : 'Credentials saved · callback setup needed',
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [
          Wrap(
            spacing: 12,
            runSpacing: 10,
            children: [
              SizedBox(
                width: 210,
                child: DropdownButtonFormField<String>(
                  initialValue: _environment,
                  decoration: const InputDecoration(labelText: 'Environment'),
                  items: const [
                    DropdownMenuItem(value: 'sandbox', child: Text('Sandbox')),
                    DropdownMenuItem(
                      value: 'production',
                      child: Text('Production'),
                    ),
                  ],
                  onChanged: widget.enabled
                      ? (value) =>
                            setState(() => _environment = value ?? _environment)
                      : null,
                ),
              ),
              if (_isDaraja)
                SizedBox(
                  width: 240,
                  child: TextFormField(
                    controller: _shortcode,
                    enabled: widget.enabled,
                    decoration: const InputDecoration(
                      labelText: 'Store / API shortcode',
                      hintText: 'BusinessShortCode and STK password shortcode',
                    ),
                  ),
                ),
              if (_isDaraja)
                SizedBox(
                  width: 240,
                  child: TextFormField(
                    controller: _tillNumber,
                    enabled: widget.enabled,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Customer-facing Buy Goods Till',
                      hintText: 'PartyB; required for Buy Goods',
                    ),
                  ),
                ),
              if (_isDaraja)
                SizedBox(
                  width: 220,
                  child: DropdownButtonFormField<String>(
                    initialValue: _transactionType,
                    decoration: const InputDecoration(
                      labelText: 'Transaction type',
                    ),
                    items: const [
                      DropdownMenuItem(
                        value: 'CustomerPayBillOnline',
                        child: Text('PayBill'),
                      ),
                      DropdownMenuItem(
                        value: 'CustomerBuyGoodsOnline',
                        child: Text('Buy Goods Till'),
                      ),
                    ],
                    onChanged: widget.enabled
                        ? (value) => setState(
                            () => _transactionType = value ?? _transactionType,
                          )
                        : null,
                  ),
                ),
              SizedBox(
                width: 220,
                child: TextFormField(
                  controller: _reference,
                  enabled: widget.enabled,
                  decoration: const InputDecoration(
                    labelText: 'Account reference',
                    hintText: 'RETIVOX',
                  ),
                ),
              ),
              SizedBox(
                width: 460,
                child: TextFormField(
                  controller: _callback,
                  enabled: widget.enabled,
                  keyboardType: TextInputType.url,
                  decoration: InputDecoration(
                    labelText: _isDaraja
                        ? 'STK callback URL'
                        : 'Pesapal IPN URL',
                    hintText:
                        'https://your-retivox-domain.example/api/payments/...',
                  ),
                ),
              ),
              SizedBox(
                width: 300,
                child: TextFormField(
                  controller: _consumerKey,
                  enabled: widget.enabled,
                  decoration: InputDecoration(
                    labelText: 'Consumer key',
                    hintText: widget.settings?['consumer_key_set'] == true
                        ? 'Saved securely · enter to replace'
                        : 'Required for first setup',
                  ),
                ),
              ),
              SizedBox(
                width: 300,
                child: TextFormField(
                  controller: _consumerSecret,
                  enabled: widget.enabled,
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: 'Consumer secret',
                    hintText: widget.settings?['consumer_secret_set'] == true
                        ? 'Saved securely · enter to replace'
                        : 'Required for first setup',
                  ),
                ),
              ),
              if (_isDaraja)
                SizedBox(
                  width: 300,
                  child: TextFormField(
                    controller: _passkey,
                    enabled: widget.enabled,
                    obscureText: true,
                    decoration: InputDecoration(
                      labelText: 'Lipa na M-Pesa passkey',
                      hintText: widget.settings?['passkey_set'] == true
                          ? 'Saved securely · enter to replace'
                          : 'Required for first setup',
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Leave saved credential fields blank to keep the stored value. Secrets are sent directly to Retivox and encrypted in Supabase Vault.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                onPressed: widget.enabled && !widget.saving
                    ? () => widget.onSave({
                        'provider': widget.provider,
                        'environment': _environment,
                        'businessShortcode': _isDaraja
                            ? _shortcode.text.trim()
                            : '',
                        if (_isDaraja)
                          'tillNumber': _tillNumber.text.trim(),
                        'accountReference': _reference.text.trim(),
                        if (_isDaraja) 'transactionType': _transactionType,
                        'callbackUrl': _callback.text.trim(),
                        'consumerKey': _consumerKey.text.trim(),
                        'consumerSecret': _consumerSecret.text.trim(),
                        'passkey': _isDaraja ? _passkey.text.trim() : '',
                      })
                    : null,
                icon: widget.saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.save_outlined),
                label: Text(widget.saving ? 'Saving…' : 'Save securely'),
              ),
              OutlinedButton.icon(
                onPressed: widget.enabled && configured && !widget.testing
                    ? widget.onTest
                    : null,
                icon: const Icon(Icons.network_check),
                label: Text(widget.testing ? 'Testing…' : 'Test connection'),
              ),
              OutlinedButton.icon(
                onPressed: widget.enabled && configured && !widget.registering
                    ? widget.onRegister
                    : null,
                icon: const Icon(Icons.link),
                label: Text(
                  widget.registering
                      ? 'Registering…'
                      : _isDaraja
                      ? 'Register PayBill/Till callbacks'
                      : widget.settings?['pesapal_ipn_ready'] == true
                      ? 'IPN registered'
                      : 'Register Pesapal IPN',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MethodStatus extends StatelessWidget {
  const _MethodStatus({
    required this.icon,
    required this.label,
    required this.detail,
    required this.enabled,
  });

  final IconData icon;
  final String label;
  final String detail;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = enabled
        ? theme.colorScheme.primary
        : theme.colorScheme.outline;
    return Container(
      constraints: const BoxConstraints(minWidth: 185, maxWidth: 260),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 9),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: theme.textTheme.labelLarge),
                Text(
                  detail,
                  maxLines: 2,
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
    );
  }
}

class _NoticeBox extends StatelessWidget {
  const _NoticeBox({
    required this.icon,
    required this.color,
    required this.text,
  });

  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.08),
      border: Border.all(color: color.withValues(alpha: 0.25)),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(text, style: TextStyle(color: color)),
        ),
      ],
    ),
  );
}
