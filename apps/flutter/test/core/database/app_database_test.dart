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
      accountId: 'account-1',
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

  test(
    'cached records are isolated by account even with the same cache key',
    () async {
      await database.cacheValue(
        'account-1',
        'dashboard:branches',
        'ciphertext-a',
      );
      await database.cacheValue(
        'account-2',
        'dashboard:branches',
        'ciphertext-b',
      );

      expect(
        await database.readCachedValue('account-1', 'dashboard:branches'),
        'ciphertext-a',
      );
      expect(
        await database.readCachedValue('account-2', 'dashboard:branches'),
        'ciphertext-b',
      );
      expect(
        await database.readCachedValue('account-3', 'dashboard:branches'),
        isNull,
      );
    },
  );

  test('barcode index is isolated by account and branch', () async {
    await database.replaceProductBarcodeIndex('account-1', 'branch-1', [
      {'barcode_hash': 'hash-a', 'product_option_id': 'option-a'},
    ]);
    await database.replaceProductBarcodeIndex('account-2', 'branch-1', [
      {'barcode_hash': 'hash-a', 'product_option_id': 'option-b'},
    ]);

    expect(
      await database.productOptionForBarcodeHash(
        'account-1',
        'branch-1',
        'hash-a',
      ),
      'option-a',
    );
    expect(
      await database.productOptionForBarcodeHash(
        'account-2',
        'branch-1',
        'hash-a',
      ),
      'option-b',
    );
    expect(
      await database.productOptionForBarcodeHash(
        'account-1',
        'branch-2',
        'hash-a',
      ),
      isNull,
    );

    await database.replaceProductBarcodeIndex('account-1', 'branch-1', []);
    expect(
      await database.productOptionForBarcodeHash(
        'account-1',
        'branch-1',
        'hash-a',
      ),
      isNull,
    );
    expect(
      await database.productOptionForBarcodeHash(
        'account-2',
        'branch-1',
        'hash-a',
      ),
      'option-b',
    );
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
        accountId: 'account-1',
        localId: 'local-sale-2',
        status: 'needs_correction',
        errorMessage: 'Insufficient stock',
      );
      expect(await database.countSalesForAccount('account-1'), 1);
      expect(await database.pendingSales('account-1'), isEmpty);

      await database.updateSale(
        accountId: 'account-1',
        localId: 'local-sale-2',
        status: 'cancelled',
      );
      expect(await database.countSalesForAccount('account-1'), 0);
    },
  );

  test(
    'offline inventory query includes only active local sales by branch',
    () async {
      for (final sale in const [
        ('sale-pending', 'branch-1', 'pending_sync'),
        ('sale-correction', 'branch-1', 'needs_correction'),
        ('sale-synced', 'branch-1', 'synced'),
        ('sale-cancelled', 'branch-1', 'cancelled'),
        ('sale-other-branch', 'branch-2', 'pending_sync'),
      ]) {
        await database.enqueueSale(
          localId: sale.$1,
          accountId: 'account-1',
          branchId: sale.$2,
          encryptedPayload: 'encrypted-${sale.$1}',
          recordedAt: DateTime.utc(2025).toIso8601String(),
        );
        if (sale.$3 != 'pending_sync') {
          await database.updateSale(
            accountId: 'account-1',
            localId: sale.$1,
            status: sale.$3,
          );
        }
      }

      final affecting = await database.inventoryAffectingSales(
        'account-1',
        'branch-1',
      );
      expect(affecting.map((row) => row.read<String>('local_id')).toSet(), {
        'sale-pending',
        'sale-correction',
      });
    },
  );

  test(
    'offline sales overview reports sync, correction, and last sync states',
    () async {
      for (final sale in const [
        ('sale-pending', 'pending_sync'),
        ('sale-syncing', 'syncing'),
        ('sale-failed', 'needs_correction'),
        ('sale-synced', 'synced'),
      ]) {
        await database.enqueueSale(
          localId: sale.$1,
          accountId: 'account-1',
          branchId: 'branch-1',
          encryptedPayload: 'encrypted-${sale.$1}',
          recordedAt: DateTime.utc(2025).toIso8601String(),
        );
        await database.updateSale(
          accountId: 'account-1',
          localId: sale.$1,
          status: sale.$2,
        );
      }

      final summary = await database.offlineSalesOverviewCounts('account-1');
      expect(summary.read<int>('pending_count'), 2);
      expect(summary.read<int>('failed_count'), 1);
      expect(summary.read<int>('synced_count'), 1);
      expect(summary.readNullable<String>('last_synced_at'), isNotNull);
    },
  );
}
