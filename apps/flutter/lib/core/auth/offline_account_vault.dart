import 'dart:convert';
import 'dart:math';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../database/app_database.dart';
import 'retivox_user.dart';

class OfflineAccountVault {
  OfflineAccountVault({
    required this.database,
    FlutterSecureStorage? secureStorage,
  }) : _secureStorage = secureStorage ?? const FlutterSecureStorage();

  static const _accountsKey = 'retivox.offline.accounts.v1';
  static const _dataKeyPrefix = 'retivox.offline.data-key.';
  static const _pinIterations = 210000;
  final AppDatabase database;
  final FlutterSecureStorage _secureStorage;

  static final _kdf = Pbkdf2(
    macAlgorithm: Hmac.sha256(),
    iterations: _pinIterations,
    bits: 256,
  );
  static final _cipher = AesGcm.with256bits();

  Future<void> authorizeAccount(RetivoxUser user, String pin) async {
    _validatePin(pin);
    final accounts = await _readAccounts();
    final existing = accounts[user.id];
    final dataKey = await _getOrCreateDataKey(user.id);
    final salt = existing?['salt'] as String? ?? _randomBase64(16);
    final verifier = await _derivePin(pin, base64Decode(salt));

    accounts[user.id] = {
      'email': user.email.trim().toLowerCase(),
      'salt': salt,
      'verifier': base64Encode(verifier),
      'failedAttempts': 0,
      'lockedUntil': null,
    };

    await _secureStorage.write(key: _accountsKey, value: jsonEncode(accounts));
    await _saveProfile(user, dataKey);
  }

  Future<RetivoxUser> unlockOffline(String email, String pin) async {
    _validatePin(pin);
    final accounts = await _readAccounts();
    MapEntry<String, Map<String, dynamic>>? entry;
    for (final candidate in accounts.entries) {
      if (candidate.value['email'] == email.trim().toLowerCase()) {
        entry = candidate;
        break;
      }
    }
    if (entry == null) {
      throw const OfflineAccountException(
        'No offline account is registered for that email on this computer.',
      );
    }

    final accountId = entry.key;
    final record = entry.value;
    final lockedUntilText = record['lockedUntil'] as String?;
    if (lockedUntilText != null) {
      final lockedUntil = DateTime.tryParse(lockedUntilText);
      if (lockedUntil != null && lockedUntil.isAfter(DateTime.now().toUtc())) {
        throw const OfflineAccountException(
          'Too many incorrect PIN attempts. Please wait before trying again.',
        );
      }
    }

    final derived = await _derivePin(
      pin,
      base64Decode(record['salt'] as String),
    );
    if (!_constantTimeEquals(
      derived,
      base64Decode(record['verifier'] as String),
    )) {
      final attempts = (record['failedAttempts'] as int? ?? 0) + 1;
      final lockMinutes = attempts < 5 ? 0 : min(15, 1 << min(attempts - 5, 4));
      record['failedAttempts'] = attempts;
      record['lockedUntil'] = lockMinutes == 0
          ? null
          : DateTime.now()
                .toUtc()
                .add(Duration(minutes: lockMinutes))
                .toIso8601String();
      await _secureStorage.write(
        key: _accountsKey,
        value: jsonEncode(accounts),
      );
      throw const OfflineAccountException('Email or offline PIN is incorrect.');
    }

    record['failedAttempts'] = 0;
    record['lockedUntil'] = null;
    await _secureStorage.write(key: _accountsKey, value: jsonEncode(accounts));

    final profile = await database.readAccount(accountId);
    if (profile == null) {
      throw const OfflineAccountException(
        'The saved account profile is unavailable. Sign in while online to refresh this device.',
      );
    }
    final dataKey = await _readDataKey(accountId);
    return RetivoxUser.fromJson(
      jsonDecode(await _open(profile, dataKey)) as Map<String, dynamic>,
    );
  }

  Future<RetivoxUser?> loadAuthorizedAccount(String accountId) async {
    final accounts = await _readAccounts();
    if (!accounts.containsKey(accountId)) return null;
    final profile = await database.readAccount(accountId);
    if (profile == null) return null;
    final dataKey = await _readDataKey(accountId);
    final decoded = jsonDecode(await _open(profile, dataKey));
    if (decoded is! Map<String, dynamic>) {
      throw const OfflineAccountException(
        'The saved account profile is invalid.',
      );
    }
    return RetivoxUser.fromJson(decoded);
  }

  Future<void> cacheValue(RetivoxUser user, String key, Object value) async {
    final dataKey = await _readDataKey(user.id);
    await database.cacheValue(
      user.id,
      key,
      await _seal(jsonEncode(value), dataKey),
    );
  }

  Future<void> updateCachedProfile(RetivoxUser user) async {
    await _saveProfile(user, await _readDataKey(user.id));
  }

  Future<T?> readCachedValue<T>(RetivoxUser user, String key) async {
    final ciphertext = await database.readCachedValue(user.id, key);
    if (ciphertext == null) return null;
    return jsonDecode(await _open(ciphertext, await _readDataKey(user.id)))
        as T;
  }

  Future<DateTime?> cachedValueUpdatedAt(RetivoxUser user, String key) async {
    final value = await database.cachedValueUpdatedAt(user.id, key);
    return value == null ? null : DateTime.tryParse(value)?.toLocal();
  }

  Future<String> encryptForAccount(String accountId, Object value) async {
    return _seal(jsonEncode(value), await _readDataKey(accountId));
  }

  Future<Map<String, dynamic>> decryptForAccount(
    String accountId,
    String ciphertext,
  ) async {
    return jsonDecode(await _open(ciphertext, await _readDataKey(accountId)))
        as Map<String, dynamic>;
  }

  Future<void> signOutOfflineAccess(String accountId) async {
    final accounts = await _readAccounts();
    accounts.remove(accountId);
    await _secureStorage.write(key: _accountsKey, value: jsonEncode(accounts));
  }

  Future<void> _saveProfile(RetivoxUser user, SecretKey dataKey) async {
    await database.cacheAccount(
      user.id,
      await _seal(jsonEncode(user.toJson()), dataKey),
    );
  }

  Future<Map<String, Map<String, dynamic>>> _readAccounts() async {
    final value = await _secureStorage.read(key: _accountsKey);
    if (value == null || value.isEmpty) return {};
    final decoded = jsonDecode(value);
    if (decoded is! Map<String, dynamic>) {
      throw const OfflineAccountException(
        'Saved offline account data is invalid.',
      );
    }
    return decoded.map((key, value) {
      if (value is! Map<String, dynamic>) {
        throw const OfflineAccountException(
          'Saved offline account data is invalid.',
        );
      }
      return MapEntry(key, value);
    });
  }

  Future<SecretKey> _getOrCreateDataKey(String accountId) async {
    final existing = await _secureStorage.read(
      key: '$_dataKeyPrefix$accountId',
    );
    if (existing != null) return SecretKey(base64Decode(existing));
    final bytes = _secureRandomBytes(32);
    await _secureStorage.write(
      key: '$_dataKeyPrefix$accountId',
      value: base64Encode(bytes),
    );
    return SecretKey(bytes);
  }

  Future<SecretKey> _readDataKey(String accountId) async {
    final value = await _secureStorage.read(key: '$_dataKeyPrefix$accountId');
    if (value == null) {
      throw const OfflineAccountException(
        'This computer no longer has the local encryption key for this account.',
      );
    }
    return SecretKey(base64Decode(value));
  }

  Future<List<int>> _derivePin(String pin, List<int> salt) async {
    final key = await _kdf.deriveKey(
      secretKey: SecretKey(utf8.encode(pin)),
      nonce: salt,
    );
    return key.extractBytes();
  }

  Future<String> _seal(String value, SecretKey key) async {
    final box = await _cipher.encrypt(
      utf8.encode(value),
      secretKey: key,
      nonce: _secureRandomBytes(12),
    );
    return [
      'v1',
      base64Encode(box.nonce),
      base64Encode(box.cipherText),
      base64Encode(box.mac.bytes),
    ].join('.');
  }

  Future<String> _open(String value, SecretKey key) async {
    final parts = value.split('.');
    if (parts.length != 4 || parts.first != 'v1') {
      throw const OfflineAccountException(
        'Saved offline data has an unsupported format.',
      );
    }
    final box = SecretBox(
      base64Decode(parts[2]),
      nonce: base64Decode(parts[1]),
      mac: Mac(base64Decode(parts[3])),
    );
    try {
      return utf8.decode(await _cipher.decrypt(box, secretKey: key));
    } on SecretBoxAuthenticationError {
      throw const OfflineAccountException(
        'Saved offline data could not be authenticated.',
      );
    }
  }

  static String _randomBase64(int length) =>
      base64Encode(_secureRandomBytes(length));

  static List<int> _secureRandomBytes(int length) {
    final random = Random.secure();
    return List<int>.generate(length, (_) => random.nextInt(256));
  }

  static bool _constantTimeEquals(List<int> first, List<int> second) {
    if (first.length != second.length) return false;
    var difference = 0;
    for (var index = 0; index < first.length; index++) {
      difference |= first[index] ^ second[index];
    }
    return difference == 0;
  }

  static void _validatePin(String pin) {
    if (!RegExp(r'^\d{6}$').hasMatch(pin)) {
      throw const OfflineAccountException('Use a six-digit offline PIN.');
    }
  }
}

class OfflineAccountException implements Exception {
  const OfflineAccountException(this.message);

  final String message;

  @override
  String toString() => message;
}
