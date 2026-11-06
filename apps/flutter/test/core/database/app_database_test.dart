import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:retivox_client/core/database/app_database.dart';

void main() {
  late AppDatabase database;

  setUp(() async {
    database = AppDatabase(executor: NativeDatabase.memory());
    await database.customSelect('SELECT 1').getSingle();
  });

  tearDown(() async {
    await database.close();
  });

  test('sales stay pending until explicitly marked synced', () async {
    await database.enqueueSale(
      localId: 'local-sale-1',
      accountId: 'account-1',
      branchId: 'branch-1',
      encryptedPayload: 'encrypted-sale',
      recordedAt: DateTime.utc(2025).toIso8601String(),
    );

    final pending = await database.pendingSales('account-1');
    expect(pending, hasLength(1));
    expect(pending.single.read<String>('status'), 'pending_sync');

    await database.updateSale(
      localId: 'local-sale-1',
      status: 'synced',
      serverId: 'server-sale-1',
    );

    expect(await database.pendingSales('account-1'), isEmpty);
    expect(await database.countSalesForAccount('account-1'), 0);
  });

  test('appearance preferences persist in local database', () async {
    expect(await database.readPreference('dark_mode'), isNull);
    await database.writePreference('dark_mode', 'true');
    expect(await database.readPreference('dark_mode'), 'true');
    await database.writePreference('dark_mode', 'false');
    expect(await database.readPreference('dark_mode'), 'false');
  });

  test('only one process can own an account sale sync lease', () async {
    final expiry = DateTime.now().toUtc().add(const Duration(minutes: 1));

    expect(
      await database.tryAcquireSaleSyncLock(
        accountId: 'account-1',
        ownerId: 'worker-1',
        expiresAt: expiry,
      ),
      isTrue,
    );
    expect(
      await database.tryAcquireSaleSyncLock(
        accountId: 'account-1',
        ownerId: 'worker-2',
        expiresAt: expiry,
      ),
      isFalse,
    );

    await database.releaseSaleSyncLock(
      accountId: 'account-1',
      ownerId: 'worker-1',
    );
    expect(
      await database.tryAcquireSaleSyncLock(
        accountId: 'account-1',
        ownerId: 'worker-2',
        expiresAt: expiry,
      ),
      isTrue,
    );
  });

  test(
    'correctable sales stay visible and cancelled sales are excluded',
    () async {
      await database.enqueueSale(
        localId: 'local-sale-2',
        accountId: 'account-1',
        branchId: 'branch-1',
        encryptedPayload: 'encrypted-sale',
        recordedAt: DateTime.utc(2025).toIso8601String(),
      );
      await database.updateSale(
        localId: 'local-sale-2',
        status: 'needs_correction',
        errorMessage: 'Insufficient stock',
      );
      expect(await database.countSalesForAccount('account-1'), 1);
      expect(await database.pendingSales('account-1'), isEmpty);

      await database.updateSale(localId: 'local-sale-2', status: 'cancelled');
      expect(await database.countSalesForAccount('account-1'), 0);
    },
  );
}
