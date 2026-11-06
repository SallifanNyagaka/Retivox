import 'package:supabase_flutter/supabase_flutter.dart';

import 'offline_account_vault.dart';
import 'retivox_user.dart';

class AuthRepository {
  const AuthRepository({required this.vault, required this.client});

  final OfflineAccountVault vault;
  final SupabaseClient? client;

  Future<RetivoxUser> signInOnline({
    required String email,
    required String password,
    required String offlinePin,
  }) async {
    final supabase = client;
    if (supabase == null) {
      throw const AuthRepositoryException(
        'Online sign-in is not configured on this computer.',
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
      await vault.authorizeAccount(profile, offlinePin);
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
