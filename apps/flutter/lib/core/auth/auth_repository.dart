import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import 'offline_account_vault.dart';
import 'retivox_user.dart';
import '../network/backend_health_check.dart';
import '../database/app_database.dart';

class AuthRepository {
  const AuthRepository({
    required this.vault,
    required this.client,
    required this.backendHealthCheck,
    required this.database,
  });

  final OfflineAccountVault vault;
  final SupabaseClient? client;
  final BackendHealthCheck backendHealthCheck;
  final AppDatabase database;

  bool get isOnlineSignInConfigured =>
      client != null && backendHealthCheck.isConfigured;

  Future<RetivoxUser> signInOnline({
    required String email,
    required String password,
    String? offlinePin,
  }) async {
    final supabase = client;
    if (supabase == null) {
      throw const AuthRepositoryException(
        'Online sign-in is not configured in this installation. Install a build with the Supabase URL and publishable key.',
      );
    }

    final response = await supabase.auth.signInWithPassword(
      email: email.trim(),
      password: password,
    );
    final authUser = response.user;
    if (authUser == null) {
      throw const AuthRepositoryException(
        'Sign-in did not return a user account.',
      );
    }

    try {
      final profile = await _loadProfile(supabase, authUser.id);
      await vault.authorizeAccount(profile, offlinePin: offlinePin);
      return profile;
    } catch (_) {
      await supabase.auth.signOut(scope: SignOutScope.local);
      rethrow;
    }
  }

  Future<RetivoxUser> unlockOffline({
    required String email,
    required String pin,
  }) => vault.unlockOffline(email, pin);

  Future<bool> hasOfflineAccessForEmail(String email) =>
      vault.hasOfflineAccessForEmail(email);

  Future<String> accountRegistrationUrl() async {
    final cached = await database.readPreference('account_registration_url');
    final supabase = client;
    if (supabase != null && backendHealthCheck.isConfigured) {
      try {
        final response = await supabase.rpc('public_app_runtime_config');
        final rows = response is List ? response : const [];
        final row = rows.whereType<Map>().firstOrNull;
        final configured = row?['account_registration_url']?.toString() ?? '';
        final safeUrl = _validatedRegistrationUrl(configured);
        if (safeUrl != null) {
          await database.writePreference('account_registration_url', safeUrl);
          return safeUrl;
        }
      } catch (_) {
        // A previously saved public URL remains usable when the service is
        // temporarily unavailable. Creating the account itself still needs
        // the web service.
      }
    }
    final cachedUrl = _validatedRegistrationUrl(cached ?? '');
    if (cachedUrl != null) return cachedUrl;
    throw const AuthRepositoryException(
      'The account creation page is not configured yet. Connect to the internet and ask a Retivox platform developer to configure it.',
    );
  }

  Future<RetivoxUser> completeNativeRegistration({
    required String code,
    required String verifier,
    required String registrationUrl,
  }) async {
    final supabase = client;
    if (supabase == null) {
      throw const AuthRepositoryException(
        'Online sign-in is not configured in this installation.',
      );
    }
    final webOrigin = Uri.parse(registrationUrl).origin;
    final endpoint = Uri.parse(webOrigin).resolve('/api/native-auth/handoff');
    final response = await http
        .post(
          endpoint,
          headers: const {'Content-Type': 'application/json'},
          body: jsonEncode({'code': code, 'verifier': verifier}),
        )
        .timeout(const Duration(seconds: 20));
    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic> || response.statusCode < 200 || response.statusCode >= 300 || decoded['success'] != true) {
      throw AuthRepositoryException(
        decoded is Map<String, dynamic>
            ? decoded['error']?.toString() ?? 'Could not finish account sign-in.'
            : 'The account service returned invalid data.',
      );
    }
    final refreshToken = decoded['refresh_token']?.toString() ?? '';
    if (refreshToken.isEmpty) {
      throw const AuthRepositoryException('The account sign-in handoff is incomplete.');
    }

    try {
      final session = await supabase.auth.setSession(refreshToken);
      final authUser = session.user;
      if (authUser == null) {
        throw const AuthRepositoryException('Account sign-in did not return a user.');
      }
      final profile = await _loadProfile(supabase, authUser.id);
      await vault.authorizeAccount(profile);
      return profile;
    } catch (_) {
      await supabase.auth.signOut(scope: SignOutScope.local);
      rethrow;
    }
  }

  String? _validatedRegistrationUrl(String value) {
    final uri = Uri.tryParse(value.trim());
    if (uri == null || !uri.hasAuthority || uri.userInfo.isNotEmpty ||
        uri.query.isNotEmpty || uri.fragment.isNotEmpty ||
        !(uri.scheme == 'https' ||
            (uri.scheme == 'http' && (uri.host == 'localhost' || uri.host == '127.0.0.1')))) {
      return null;
    }
    return uri.toString();
  }

  /// Restores the locally authorized account after Android recreates the
  /// process. The profile remains encrypted in SQLite and its active-account
  /// marker is held by platform secure storage.
  Future<RetivoxUser?> restoreActiveSession() async {
    try {
      final user = await vault.loadActiveAccount();
      if (user == null) return null;

      final authenticatedUserId = client?.auth.currentUser?.id;
      if (authenticatedUserId != null && authenticatedUserId != user.id) {
        // A different Supabase identity means this is no longer the locally
        // active account. Never restore one account over another's session.
        await vault.clearActiveAccount(user.id);
        return null;
      }
      return user;
    } on OfflineAccountException {
      await vault.clearActiveAccount();
      return null;
    } on FormatException {
      await vault.clearActiveAccount();
      return null;
    } on TypeError {
      await vault.clearActiveAccount();
      return null;
    }
  }

  /// Checks Supabase Auth directly rather than treating a connected Wi-Fi or
  /// Ethernet interface as proof that the sign-in service is reachable.
  Future<bool> isBackendReachable() =>
      client != null && backendHealthCheck.isConfigured
      ? backendHealthCheck.isReachable()
      : Future.value(false);

  Future<void> signOut(RetivoxUser user) async {
    if (client != null) {
      await client!.auth.signOut(scope: SignOutScope.local);
    }
    await vault.signOutOfflineAccess(user.id);
  }

  Future<RetivoxUser> _loadProfile(
    SupabaseClient supabase,
    String userId,
  ) async {
    final profile = await supabase
        .from('users')
        .select('id, business_id, name, email, global_role, is_active')
        .eq('id', userId)
        .maybeSingle();

    if (profile == null) {
      throw const AuthRepositoryException(
        'Your Retivox profile could not be found.',
      );
    }
    if (profile['is_active'] != true) {
      throw const AuthRepositoryException(
        'This account is inactive. Contact your business owner.',
      );
    }

    final businessId = profile['business_id'] as String?;
    if (businessId == null || businessId.isEmpty) {
      throw const AuthRepositoryException(
        'This account is not linked to a business.',
      );
    }

    final role = retivoxRoleFromString(profile['global_role'] as String?);
    final roleRows = await supabase.rpc(
      'get_user_branch_roles',
      params: {'p_user_id': userId},
    );
    if (roleRows is! List) {
      throw const AuthRepositoryException(
        'The server returned an invalid branch-access response.',
      );
    }

    final branchRoles = roleRows
        .whereType<Map<String, dynamic>>()
        .where((row) => row['branch_id'] is String && row['role'] is String)
        .toList();
    final branchIds = branchRoles
        .map((row) => row['branch_id'] as String)
        .toSet()
        .toList();
    final branches = <BranchAccess>[];
    var currency = 'KES';

    if (branchIds.isNotEmpty) {
      final branchRows = await supabase
          .from('branches')
          .select('id, name')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .isFilter('deleted_at', null)
          .inFilter('id', branchIds)
          .order('name');

      for (final branch in branchRows) {
        final id = branch['id'] as String;
        final branchRole = branchRoles.firstWhere(
          (row) => row['branch_id'] == id,
          orElse: () => const <String, dynamic>{},
        );
        if (branchRole.isNotEmpty) {
          branches.add(
            BranchAccess(
              id: id,
              name: branch['name'] as String? ?? 'Branch',
              role: branchRole['role'] as String,
            ),
          );
        }
      }
    }

    if (role == RetivoxRole.employee && branches.isEmpty) {
      throw const AuthRepositoryException(
        'Your employee branch assignment is not active.',
      );
    }

    final business = await supabase
        .from('businesses')
        .select('name, currency')
        .eq('id', businessId)
        .maybeSingle();
    if (business != null) {
      currency = business['currency'] as String? ?? currency;
    }

    return RetivoxUser(
      id: userId,
      businessId: businessId,
      name: profile['name'] as String? ?? 'Retivox user',
      email: profile['email'] as String? ?? '',
      businessName: business?['name'] as String? ?? 'Retivox',
      role: role,
      branches: branches,
      currency: currency,
    );
  }
}

class AuthRepositoryException implements Exception {
  const AuthRepositoryException(this.message);

  final String message;

  @override
  String toString() => message;
}
