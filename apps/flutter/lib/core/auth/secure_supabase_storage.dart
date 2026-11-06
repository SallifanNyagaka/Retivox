import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class SecureSupabaseStorage extends LocalStorage {
  SecureSupabaseStorage({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const _sessionKey = 'retivox.supabase.session.v1';

  final FlutterSecureStorage _storage;

  @override
  Future<void> initialize() async {}

  @override
  Future<bool> hasAccessToken() async => await accessToken() != null;

  @override
  Future<String?> accessToken() async {
    final value = await _storage.read(key: _sessionKey);
    if (value == null) return null;
    final session = jsonDecode(value);
    return session is Map<String, dynamic>
        ? session['access_token'] as String?
        : null;
  }

  @override
  Future<void> persistSession(String persistSessionString) =>
      _storage.write(key: _sessionKey, value: persistSessionString);

  @override
  Future<void> removePersistedSession() => _storage.delete(key: _sessionKey);
}
