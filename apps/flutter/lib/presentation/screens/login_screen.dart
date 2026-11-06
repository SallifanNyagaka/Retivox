import 'package:flutter/material.dart';

import '../../core/auth/auth_repository.dart';
import '../../core/auth/offline_account_vault.dart';
import '../../core/auth/retivox_user.dart';

import 'package:supabase_flutter/supabase_flutter.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    required this.repository,
    required this.onlineSignInConfigured,
    required this.onAuthenticated,
    super.key,
  });

  final AuthRepository repository;
  final bool onlineSignInConfigured;
  final ValueChanged<RetivoxUser> onAuthenticated;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _pinController = TextEditingController();
  final _confirmPinController = TextEditingController();
  bool _isOnlineMode = true;
  bool _isBusy = false;
  String? _error;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _pinController.dispose();
    _confirmPinController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _isBusy = true;
      _error = null;
    });

    try {
      final user = _isOnlineMode
          ? await _signInOnline()
          : await widget.repository.unlockOffline(
              email: _emailController.text,
              pin: _pinController.text,
            );
      if (mounted) widget.onAuthenticated(user);
    } catch (error) {
      if (mounted) setState(() => _error = _readableError(error));
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  Future<RetivoxUser> _signInOnline() {
    final pin = _pinController.text;
    if (pin != _confirmPinController.text) {
      throw const AuthRepositoryException(
        'The offline PIN entries do not match.',
      );
    }
    return widget.repository.signInOnline(
      email: _emailController.text,
      password: _passwordController.text,
      offlinePin: pin,
    );
  }

  String _readableError(Object error) {
    if (error is AuthRepositoryException || error is OfflineAccountException) {
      return error.toString();
    }
    if (error is AuthException) {
      return error.message;
    }
    return 'Sign-in failed. Check your details and connection, then try again.';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
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
                Text(
                  'Sign in to your business workspace',
                  style: theme.textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 28),
                SegmentedButton<bool>(
                  segments: const [
                    ButtonSegment(
                      value: true,
                      label: Text('Online'),
                      icon: Icon(Icons.cloud_outlined),
                    ),
                    ButtonSegment(
                      value: false,
                      label: Text('Offline'),
                      icon: Icon(Icons.cloud_off_outlined),
                    ),
                  ],
                  selected: {_isOnlineMode},
                  onSelectionChanged: _isBusy
                      ? null
                      : (selection) => setState(() {
                          _isOnlineMode = selection.first;
                          _error = null;
                        }),
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.username],
                  enabled: !_isBusy,
                  decoration: const InputDecoration(labelText: 'Email'),
                ),
                if (_isOnlineMode) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _passwordController,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    enabled: !_isBusy && widget.onlineSignInConfigured,
                    decoration: const InputDecoration(labelText: 'Password'),
                  ),
                ],
                const SizedBox(height: 12),
                TextField(
                  controller: _pinController,
                  obscureText: true,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  enabled: !_isBusy,
                  decoration: InputDecoration(
                    labelText: 'Six-digit offline PIN',
                    helperText: _isOnlineMode
                        ? 'Set or update the PIN for this computer'
                        : 'For an account previously used on this computer',
                    counterText: '',
                  ),
                ),
                if (_isOnlineMode) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _confirmPinController,
                    obscureText: true,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    enabled: !_isBusy,
                    decoration: const InputDecoration(
                      labelText: 'Confirm offline PIN',
                      counterText: '',
                    ),
                  ),
                ],
                if (!widget.onlineSignInConfigured && _isOnlineMode) ...[
                  const SizedBox(height: 12),
                  const Text(
                    'Online sign-in is not configured. You can still unlock an account saved on this computer.',
                    textAlign: TextAlign.center,
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    _error!,
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed:
                      _isBusy ||
                          (_isOnlineMode && !widget.onlineSignInConfigured)
                      ? null
                      : _submit,
                  child: _isBusy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(
                          _isOnlineMode
                              ? 'Sign in and save this device'
                              : 'Unlock offline',
                        ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Offline data is encrypted on this computer. Offline access remains available until you sign out; account or permission changes can only be checked after reconnecting.',
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
