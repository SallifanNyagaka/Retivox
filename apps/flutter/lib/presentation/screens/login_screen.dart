import 'dart:async';

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/auth/auth_repository.dart';
import '../../core/auth/offline_account_vault.dart';
import '../../core/auth/retivox_user.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    required this.repository,
    required this.onAuthenticated,
    super.key,
  });

  final AuthRepository repository;
  final ValueChanged<RetivoxUser> onAuthenticated;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _pinController = TextEditingController();
  Timer? _reachabilityTimer;
  bool _isOnline = false;
  bool _isCheckingConnection = true;
  bool _isBusy = false;
  bool _setUpOfflineAccess = false;
  bool _forceOnlineSignIn = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_refreshBackendStatus());
    _reachabilityTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => unawaited(_refreshBackendStatus()),
    );
  }

  @override
  void dispose() {
    _reachabilityTimer?.cancel();
    _emailController.dispose();
    _passwordController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _refreshBackendStatus() async {
    if (_isBusy) return;
    final reachable = await widget.repository.isBackendReachable();
    if (!mounted) return;
    setState(() {
      _isOnline = reachable;
      _isCheckingConnection = false;
    });
  }

  Future<void> _submit() async {
    setState(() {
      _isBusy = true;
      _error = null;
    });

    try {
      // Recheck immediately before choosing a sign-in path. A connected
      // network interface alone does not prove the database is reachable.
      final reachable = await widget.repository.isBackendReachable();
      if (reachable || _forceOnlineSignIn) {
        final user = await widget.repository.signInOnline(
          email: _emailController.text,
          password: _passwordController.text,
          offlinePin: _setUpOfflineAccess ? _pinController.text : null,
        );
        if (mounted) widget.onAuthenticated(user);
      } else {
        final user = await widget.repository.unlockOffline(
          email: _emailController.text,
          pin: _pinController.text,
        );
        if (mounted) widget.onAuthenticated(user);
      }
    } catch (error) {
      if (mounted) setState(() => _error = _readableError(error));
    } finally {
      if (mounted) {
        setState(() {
          _isBusy = false;
          _isCheckingConnection = false;
        });
        unawaited(_refreshBackendStatus());
      }
    }
  }

  String _readableError(Object error) {
    if (error is AuthRepositoryException || error is OfflineAccountException) {
      return error.toString();
    }
    if (error is AuthException) return error.message;
    if (error is SocketException || error is TimeoutException) {
      return 'Retivox sign-in could not reach the online service. Check the connection and try again, or use your saved offline PIN.';
    }
    return 'Sign-in failed. Check your details and try again.';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final showOnlineFields = _isOnline || _forceOnlineSignIn;
    final checking = _isCheckingConnection && !_isOnline;
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 430),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Icon(Icons.storefront_outlined, size: 44),
                const SizedBox(height: 12),
                Text(
                  'Retivox',
                  style: theme.textTheme.headlineMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 6),
                const Text(
                  'Sign in to your business workspace',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 18),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      showOnlineFields
                          ? Icons.cloud_done_outlined
                          : Icons.cloud_off_outlined,
                      size: 18,
                      color: showOnlineFields
                          ? theme.colorScheme.primary
                          : theme.colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      checking
                          ? 'Checking connection…'
                          : showOnlineFields
                          ? 'Online sign-in'
                          : 'Offline sign-in',
                      style: theme.textTheme.labelLarge,
                    ),
                  ],
                ),
                const SizedBox(height: 22),
                TextField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.username],
                  enabled: !_isBusy,
                  textInputAction: showOnlineFields
                      ? TextInputAction.next
                      : TextInputAction.done,
                  onSubmitted: (_) {
                    if (!showOnlineFields) _submit();
                  },
                  decoration: const InputDecoration(labelText: 'Email'),
                ),
                const SizedBox(height: 12),
                if (checking) ...[
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: LinearProgressIndicator(),
                  ),
                ] else if (showOnlineFields) ...[
                  if (!_isOnline && _forceOnlineSignIn) ...[
                    Text(
                      'Retrying online sign-in even though the connection check failed.',
                      style: theme.textTheme.bodySmall,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                  ],
                  TextField(
                    controller: _passwordController,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    enabled: !_isBusy,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _submit(),
                    decoration: const InputDecoration(labelText: 'Password'),
                  ),
                  const SizedBox(height: 8),
                  TextButton.icon(
                    onPressed: _isBusy
                        ? null
                        : () => setState(() {
                            _setUpOfflineAccess = !_setUpOfflineAccess;
                            _pinController.clear();
                          }),
                    icon: Icon(
                      _setUpOfflineAccess
                          ? Icons.expand_less
                          : Icons.pin_outlined,
                    ),
                    label: Text(
                      _setUpOfflineAccess
                          ? 'Cancel offline access setup'
                          : 'Set up offline access on this computer',
                    ),
                  ),
                  if (_setUpOfflineAccess) ...[
                    TextField(
                      controller: _pinController,
                      obscureText: true,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      enabled: !_isBusy,
                      decoration: const InputDecoration(
                        labelText: 'Choose a six-digit offline PIN',
                        helperText: 'Used only when the backend is unreachable',
                        counterText: '',
                      ),
                    ),
                  ],
                  if (!_isOnline && _forceOnlineSignIn) ...[
                    TextButton.icon(
                      onPressed: _isBusy
                          ? null
                          : () => setState(() => _forceOnlineSignIn = false),
                      icon: const Icon(Icons.pin_outlined),
                      label: const Text('Use offline PIN instead'),
                    ),
                  ],
                ] else ...[
                  TextField(
                    controller: _pinController,
                    obscureText: true,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    enabled: !_isBusy,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _submit(),
                    decoration: const InputDecoration(
                      labelText: 'Six-digit offline PIN',
                      helperText:
                          'For an account previously used on this computer',
                      counterText: '',
                    ),
                  ),
                  if (widget.repository.isOnlineSignInConfigured) ...[
                    const SizedBox(height: 6),
                    TextButton.icon(
                      onPressed: _isBusy
                          ? null
                          : () => setState(() => _forceOnlineSignIn = true),
                      icon: const Icon(Icons.cloud_outlined),
                      label: const Text('Try online password sign-in'),
                    ),
                  ],
                ],
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    _error!,
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _isBusy || checking ? null : _submit,
                  child: _isBusy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(showOnlineFields ? 'Sign in' : 'Unlock offline'),
                ),
                const SizedBox(height: 16),
                Text(
                  showOnlineFields
                      ? 'Your password is checked online. You can optionally set an offline PIN for this computer.'
                      : 'Offline access is available only for an account previously saved on this computer. Changes made offline sync when the backend is reachable again.',
                  style: theme.textTheme.bodySmall,
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
