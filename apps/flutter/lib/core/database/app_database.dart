import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

class AppDatabase extends GeneratedDatabase {
  AppDatabase({QueryExecutor? executor})
    : super(executor ?? driftDatabase(name: 'retivox_local'));

  @override
  int get schemaVersion => 3;

  @override
  Iterable<TableInfo> get allTables => const [];

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (_) async {
      await customStatement('''
            CREATE TABLE local_accounts (
              account_id TEXT PRIMARY KEY NOT NULL,
              encrypted_profile TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
          ''');
      await customStatement('''
            CREATE TABLE cached_data (
              account_id TEXT NOT NULL,
              cache_key TEXT NOT NULL,
              encrypted_payload TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (account_id, cache_key)
            )
          ''');
      await customStatement('''
            CREATE TABLE offline_sales (
              local_id TEXT PRIMARY KEY NOT NULL,
              account_id TEXT NOT NULL,
              branch_id TEXT NOT NULL,
              status TEXT NOT NULL,
              encrypted_payload TEXT NOT NULL,
              server_id TEXT,
              error_message TEXT,
              recorded_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
          ''');
      await customStatement(
        'CREATE INDEX offline_sales_account_status ON offline_sales(account_id, status, recorded_at)',
      );
      await customStatement('''
            CREATE TABLE app_preferences (
              preference_key TEXT PRIMARY KEY NOT NULL,
              preference_value TEXT NOT NULL
            )
          ''');
      await customStatement('''
            CREATE TABLE offline_sale_sync_locks (
              account_id TEXT PRIMARY KEY NOT NULL,
              owner_id TEXT NOT NULL,
              expires_at TEXT NOT NULL
            )
          ''');
    },
    onUpgrade: (migrator, from, to) async {
      if (from < 1) {
        await migrator.database.customStatement('''
              CREATE TABLE local_accounts (
                account_id TEXT PRIMARY KEY NOT NULL,
                encrypted_profile TEXT NOT NULL,
                updated_at TEXT NOT NULL
              )
            ''');
        await migrator.database.customStatement('''
              CREATE TABLE cached_data (
                account_id TEXT NOT NULL,
                cache_key TEXT NOT NULL,
                encrypted_payload TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (account_id, cache_key)
              )
            ''');
        await migrator.database.customStatement('''
              CREATE TABLE offline_sales (
                local_id TEXT PRIMARY KEY NOT NULL,
                account_id TEXT NOT NULL,
                branch_id TEXT NOT NULL,
                status TEXT NOT NULL,
                encrypted_payload TEXT NOT NULL,
                server_id TEXT,
                error_message TEXT,
                recorded_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
              )
            ''');
        await migrator.database.customStatement(
          'CREATE INDEX offline_sales_account_status ON offline_sales(account_id, status, recorded_at)',
        );
      }
      if (from < 2) {
        await migrator.database.customStatement('''
              CREATE TABLE app_preferences (
                preference_key TEXT PRIMARY KEY NOT NULL,
                preference_value TEXT NOT NULL
              )
            ''');
      }
      if (from < 3) {
        await migrator.database.customStatement('''
              CREATE TABLE offline_sale_sync_locks (
                account_id TEXT PRIMARY KEY NOT NULL,
                owner_id TEXT NOT NULL,
                expires_at TEXT NOT NULL
              )
            ''');
      }
    },
  );

  Future<String?> readPreference(String key) async {
    final rows = await customSelect(
      'SELECT preference_value FROM app_preferences WHERE preference_key = ?',
      variables: [Variable.withString(key)],
    ).get();
    return rows.isEmpty ? null : rows.first.read<String>('preference_value');
  }

  Future<void> writePreference(String key, String value) async {
    await customStatement(
      '''
      INSERT INTO app_preferences(preference_key, preference_value)
      VALUES (?, ?)
      ON CONFLICT(preference_key) DO UPDATE SET preference_value = excluded.preference_value
      ''',
      [key, value],
    );
  }

  Future<void> cacheAccount(String accountId, String encryptedProfile) async {
    await customStatement(
      '''
      INSERT INTO local_accounts(account_id, encrypted_profile, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        encrypted_profile = excluded.encrypted_profile,
        updated_at = excluded.updated_at
      ''',
      [accountId, encryptedProfile, DateTime.now().toUtc().toIso8601String()],
    );
  }

  Future<String?> readAccount(String accountId) async {
    final rows = await customSelect(
      'SELECT encrypted_profile FROM local_accounts WHERE account_id = ?',
      variables: [Variable.withString(accountId)],
    ).get();
    return rows.isEmpty ? null : rows.first.read<String>('encrypted_profile');
  }

  Future<void> cacheValue(
    String accountId,
    String key,
    String encryptedPayload,
  ) async {
    await customStatement(
      '''
      INSERT INTO cached_data(account_id, cache_key, encrypted_payload, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id, cache_key) DO UPDATE SET
        encrypted_payload = excluded.encrypted_payload,
        updated_at = excluded.updated_at
      ''',
      [
        accountId,
        key,
        encryptedPayload,
        DateTime.now().toUtc().toIso8601String(),
      ],
    );
  }

  Future<String?> readCachedValue(String accountId, String key) async {
    final rows = await customSelect(
      'SELECT encrypted_payload FROM cached_data WHERE account_id = ? AND cache_key = ?',
      variables: [Variable.withString(accountId), Variable.withString(key)],
    ).get();
    return rows.isEmpty ? null : rows.first.read<String>('encrypted_payload');
  }

  Future<String?> cachedValueUpdatedAt(String accountId, String key) async {
    final rows = await customSelect(
      'SELECT updated_at FROM cached_data WHERE account_id = ? AND cache_key = ?',
      variables: [Variable.withString(accountId), Variable.withString(key)],
    ).get();
    return rows.isEmpty ? null : rows.first.read<String>('updated_at');
  }

  Future<void> enqueueSale({
    required String localId,
    required String accountId,
    required String branchId,
    required String encryptedPayload,
    required String recordedAt,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await customStatement(
      '''
      INSERT INTO offline_sales(
        local_id, account_id, branch_id, status, encrypted_payload, recorded_at, updated_at
      ) VALUES (?, ?, ?, 'pending_sync', ?, ?, ?)
      ''',
      [localId, accountId, branchId, encryptedPayload, recordedAt, now],
    );
  }

  Future<List<QueryRow>> pendingSales(String accountId) => customSelect(
    '''
        SELECT local_id, branch_id, status, encrypted_payload, recorded_at
        FROM offline_sales
        WHERE account_id = ? AND status IN ('pending_sync', 'syncing')
        ORDER BY recorded_at ASC
        ''',
    variables: [Variable.withString(accountId)],
  ).get();

  Future<List<QueryRow>> salesForAccount(String accountId) => customSelect(
    '''
        SELECT local_id, branch_id, status, encrypted_payload, server_id, error_message, recorded_at
        FROM offline_sales
        WHERE account_id = ?
        ORDER BY recorded_at DESC
        LIMIT 100
        ''',
    variables: [Variable.withString(accountId)],
  ).get();

  Future<void> replaceSalePayload(
    String localId,
    String encryptedPayload,
  ) async {
    await customStatement(
      'UPDATE offline_sales SET encrypted_payload = ?, updated_at = ? WHERE local_id = ?',
      [encryptedPayload, DateTime.now().toUtc().toIso8601String(), localId],
    );
  }

  Future<int> countSalesForAccount(String accountId) async {
    final row = await customSelect(
      "SELECT COUNT(*) AS count FROM offline_sales WHERE account_id = ? AND status NOT IN ('synced', 'cancelled')",
      variables: [Variable.withString(accountId)],
    ).getSingle();
    return row.read<int>('count');
  }

  Future<bool> tryAcquireSaleSyncLock({
    required String accountId,
    required String ownerId,
    required DateTime expiresAt,
  }) async {
    final now = DateTime.now().toUtc().toIso8601String();
    await customStatement(
      '''
      INSERT INTO offline_sale_sync_locks(account_id, owner_id, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        owner_id = excluded.owner_id,
        expires_at = excluded.expires_at
      WHERE offline_sale_sync_locks.expires_at <= ?
      ''',
      [accountId, ownerId, expiresAt.toUtc().toIso8601String(), now],
    );
    final rows = await customSelect(
      'SELECT owner_id FROM offline_sale_sync_locks WHERE account_id = ?',
      variables: [Variable.withString(accountId)],
    ).get();
    return rows.isNotEmpty && rows.first.read<String>('owner_id') == ownerId;
  }

  Future<void> releaseSaleSyncLock({
    required String accountId,
    required String ownerId,
  }) => customStatement(
    'DELETE FROM offline_sale_sync_locks WHERE account_id = ? AND owner_id = ?',
    [accountId, ownerId],
  );

  Future<void> updateSale({
    required String localId,
    required String status,
    String? serverId,
    String? errorMessage,
  }) async {
    await customStatement(
      '''
      UPDATE offline_sales
      SET status = ?, server_id = COALESCE(?, server_id),
          error_message = ?, updated_at = ?
      WHERE local_id = ?
      ''',
      [
        status,
        serverId,
        errorMessage,
        DateTime.now().toUtc().toIso8601String(),
        localId,
      ],
    );
  }
}
