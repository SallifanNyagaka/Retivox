import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:app_links/app_links.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

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
  Timer? _emailLookupTimer;
  StreamSubscription<Uri>? _appLinkSubscription;
  final _registrationStorage = const FlutterSecureStorage();
  static const _registrationFlowKey = 'pending_native_registration';
  bool _isOnline = false;
  bool _isCheckingConnection = true;
  bool _isBusy = false;
  bool _setUpOfflineAccess = false;
  bool _useOfflinePin = false;
  bool _offlineForcedByConnection = false;
  bool? _hasOfflineAccess;
  bool _isCheckingOfflineAccess = false;
  int _offlineLookupRequest = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_refreshBackendStatus());
    _appLinkSubscription = AppLinks().uriLinkStream.listen(
      (uri) => unawaited(_handleRegistrationReturn(uri)),
      onError: (_) {},
    );
    _reachabilityTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => unawaited(_refreshBackendStatus()),
    );
  }

  @override
  void dispose() {
    _reachabilityTimer?.cancel();
    _emailLookupTimer?.cancel();
    unawaited(_appLinkSubscription?.cancel());
    _emailController.dispose();
    _passwordController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _refreshBackendStatus() async {
    if (_isBusy) return;
    final reachable = await widget.repository.isBackendReachable();
    if (!mounted) return;
    var checkOfflineAccount = false;
    setState(() {
      _isOnline = reachable;
      _isCheckingConnection = false;
      if (!reachable) {
        _offlineForcedByConnection = true;
        if (!_useOfflinePin) {
          _useOfflinePin = true;
          _passwordController.clear();
          _pinController.clear();
          _hasOfflineAccess = null;
          checkOfflineAccount = true;
        }
      } else if (_offlineForcedByConnection) {
        _offlineForcedByConnection = false;
        _useOfflinePin = false;
        _pinController.clear();
        _hasOfflineAccess = null;
      }
    });
    if (!reachable && (_useOfflinePin || checkOfflineAccount)) {
      _scheduleOfflineAccessCheck(immediate: true);
    }
  }

  void _onEmailChanged(String _) {
    _pinController.clear();
    _hasOfflineAccess = null;
    _emailLookupTimer?.cancel();
    if (_useOfflinePin) _scheduleOfflineAccessCheck();
  }

  void _scheduleOfflineAccessCheck({bool immediate = false}) {
    _emailLookupTimer?.cancel();
    if (immediate) {
      unawaited(_checkOfflineAccess());
    } else {
      _emailLookupTimer = Timer(
        const Duration(milliseconds: 350),
        () => unawaited(_checkOfflineAccess()),
      );
    }
  }

  Future<void> _checkOfflineAccess() async {
    final email = _emailController.text.trim();
    final request = ++_offlineLookupRequest;
    if (email.isEmpty) {
      if (mounted) {
        setState(() {
          _hasOfflineAccess = null;
          _isCheckingOfflineAccess = false;
        });
      }
      return;
    }
    if (mounted) setState(() => _isCheckingOfflineAccess = true);
    var available = false;
    try {
      available = await widget.repository.hasOfflineAccessForEmail(email);
    } catch (_) {
      available = false;
    }
    if (!mounted || request != _offlineLookupRequest) return;
    setState(() {
      _hasOfflineAccess = available;
      _isCheckingOfflineAccess = false;
    });
  }

  void _toggleSignInMode() {
    setState(() {
      _useOfflinePin = !_useOfflinePin;
      _offlineForcedByConnection = false;
      _setUpOfflineAccess = false;
      _error = null;
      _passwordController.clear();
      _pinController.clear();
      _hasOfflineAccess = null;
    });
    if (_useOfflinePin) _scheduleOfflineAccessCheck(immediate: true);
  }

  Future<void> _submit() async {
    setState(() {
      _isBusy = true;
      _error = null;
    });

    try {
      if (_useOfflinePin) {
        final user = await widget.repository.unlockOffline(
          email: _emailController.text,
          pin: _pinController.text,
        );
        if (mounted) widget.onAuthenticated(user);
      } else {
        final user = await widget.repository.signInOnline(
          email: _emailController.text,
          password: _passwordController.text,
          offlinePin: _setUpOfflineAccess ? _pinController.text : null,
        );
        if (mounted) widget.onAuthenticated(user);
      }
    } catch (error) {
      if (!mounted) return;
      if (!_useOfflinePin && !await widget.repository.isBackendReachable()) {
        setState(() {
          _isOnline = false;
          _useOfflinePin = true;
          _offlineForcedByConnection = true;
          _error = null;
          _passwordController.clear();
          _pinController.clear();
          _hasOfflineAccess = null;
        });
        _scheduleOfflineAccessCheck(immediate: true);
      } else {
        setState(() => _error = _readableError(error));
      }
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
    if (error is AuthException) {
      if (error.message.toLowerCase().contains('invalid login credentials')) {
        return 'We could not sign you in. Check your email and password, or if you are new to Retivox, create an account with us first.';
      }
      return error.message;
    }
    if (error is SocketException || error is TimeoutException) {
      return 'Retivox sign-in could not reach the online service. Check the connection and try again, or use your saved offline PIN.';
    }
    return 'Sign-in failed. Check your details and try again.';
  }

  String _randomToken() {
    final bytes = List<int>.generate(32, (_) => Random.secure().nextInt(256));
    return base64UrlEncode(bytes).replaceAll('=', '');
  }

  Future<void> _startAccountRegistration() async {
    if (_isBusy) return;
    setState(() {
      _isBusy = true;
      _error = null;
    });
    try {
      final registrationUrl = await widget.repository.accountRegistrationUrl();
      final state = _randomToken();
      final verifier = _randomToken();
      final digest = await Sha256().hash(utf8.encode(verifier));
      final challenge = base64UrlEncode(digest.bytes).replaceAll('=', '');
      await _registrationStorage.write(
        key: _registrationFlowKey,
        value: jsonEncode({
          'state': state,
          'verifier': verifier,
          'registrationUrl': registrationUrl,
          'expiresAt': DateTime.now().add(const Duration(minutes: 15)).toIso8601String(),
        }),
      );
      final uri = Uri.parse(registrationUrl).replace(
        queryParameters: {'native': '1', 'state': state, 'code_challenge': challenge},
      );
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        await _registrationStorage.delete(key: _registrationFlowKey);
        throw const AuthRepositoryException('The account creation page could not be opened.');
      }
    } catch (error) {
      if (mounted) setState(() => _error = _readableError(error));
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  Future<void> _handleRegistrationReturn(Uri uri) async {
    if (uri.scheme != 'retivox' || uri.host != 'auth' || uri.path != '/callback') return;
    final code = uri.queryParameters['code'] ?? '';
    final state = uri.queryParameters['state'] ?? '';
    if (code.isEmpty || state.isEmpty || _isBusy) return;
    setState(() {
      _isBusy = true;
      _error = null;
    });
    try {
      final stored = await _registrationStorage.read(key: _registrationFlowKey);
      if (stored == null) throw const AuthRepositoryException('The account sign-in handoff expired. Sign in with your new account.');
      final flow = jsonDecode(stored);
      if (flow is! Map<String, dynamic> || flow['state'] != state ||
          DateTime.tryParse(flow['expiresAt']?.toString() ?? '')?.isBefore(DateTime.now()) != false) {
        throw const AuthRepositoryException('The account sign-in handoff expired. Sign in with your new account.');
      }
      final verifier = flow['verifier']?.toString() ?? '';
      final registrationUrl = flow['registrationUrl']?.toString() ?? '';
      await _registrationStorage.delete(key: _registrationFlowKey);
      final user = await widget.repository.completeNativeRegistration(
        code: code,
        verifier: verifier,
        registrationUrl: registrationUrl,
      );
      if (mounted) widget.onAuthenticated(user);
    } catch (error) {
      if (mounted) setState(() => _error = _readableError(error));
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final showOnlineFields = !_useOfflinePin;
    final checking = _isCheckingConnection;
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
                          ? _isOnline
                                ? 'Online sign-in'
                                : 'Offline mode'
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
                  onChanged: _onEmailChanged,
                  decoration: const InputDecoration(labelText: 'Email'),
                ),
                const SizedBox(height: 12),
                if (showOnlineFields) ...[
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
                ] else if (_hasOfflineAccess == true) ...[
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
                      counterText: '',
                    ),
                  ),
                ] else ...[
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Text(
                      _isCheckingOfflineAccess
                          ? 'Checking for saved offline access...'
                          : _emailController.text.trim().isEmpty
                          ? 'Enter your email to check for a saved offline PIN.'
                          : 'Offline access is not set up for this account on this device. Connect to the internet and sign in to register a six-digit PIN.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 6),
                TextButton.icon(
                  onPressed: _isBusy ? null : _toggleSignInMode,
                  icon: Icon(
                    showOnlineFields
                        ? Icons.pin_outlined
                        : Icons.cloud_outlined,
                  ),
                  label: Text(
                    showOnlineFields
                        ? 'Use saved offline PIN instead'
                        : 'Sign in with email and password',
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    _error!,
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed:
                      _isBusy || (_useOfflinePin && _hasOfflineAccess != true)
                      ? null
                      : _submit,
                  child: _isBusy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(showOnlineFields ? 'Sign in' : 'Unlock offline'),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _isBusy ? null : _startAccountRegistration,
                  icon: const Icon(Icons.person_add_alt_1_outlined),
                  label: const Text('New here? Create an account'),
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
