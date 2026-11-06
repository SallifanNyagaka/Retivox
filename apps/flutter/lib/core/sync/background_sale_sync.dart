import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../auth/offline_account_vault.dart';
import '../database/app_database.dart';
import '../../features/sales/sale_repository.dart';

class BackgroundSaleSync {
  const BackgroundSaleSync({
    required this.client,
    required this.vault,
    required this.database,
    required this.repository,
  });

  final SupabaseClient? client;
  final OfflineAccountVault vault;
  final AppDatabase database;
  final SaleRepository repository;

  Future<int> run() async {
    try {
      final supabase = client;
      if (supabase == null) {
        await _log('Skipped: Supabase is not configured.');
        return 0;
      }
      if (supabase.auth.currentSession == null) {
        await _log('Skipped: no authenticated account is available.');
        return 0;
      }

      final session = await supabase.auth.getUser();
      final accountId = session.user?.id;
      if (accountId == null) {
        await _log('Skipped: no authenticated account is available.');
        return 0;
      }

      final user = await vault.loadAuthorizedAccount(accountId);
      if (user == null) {
        await _log('Skipped: no authorized offline profile is available.');
        return 0;
      }

      final before = await database.countSalesForAccount(accountId);
      if (before == 0) {
        await _log('Completed: no pending sales.');
        return 0;
      }

      await repository.syncPending(user);
      final after = await database.countSalesForAccount(accountId);
      await _log('Completed: pending sales before=$before after=$after.');
      return 0;
    } catch (error, stackTrace) {
      await _log('Failed: ${error.runtimeType}.', stackTrace: stackTrace);
      return 1;
    }
  }

  Future<void> _log(String message, {StackTrace? stackTrace}) async {
    final localAppData = Platform.environment['LOCALAPPDATA'];
    if (localAppData == null || localAppData.isEmpty) {
      throw const FileSystemException('LOCALAPPDATA is not configured.');
    }
    final directory = Directory(
      '$localAppData${Platform.pathSeparator}Retivox${Platform.pathSeparator}logs',
    );
    await directory.create(recursive: true);
    final file = File(
      '${directory.path}${Platform.pathSeparator}background-sale-sync.log',
    );
    if (await file.exists() && await file.length() > 262144) {
      final previous = File('${file.path}.1');
      if (await previous.exists()) await previous.delete();
      await file.rename(previous.path);
    }
    final timestamp = DateTime.now().toUtc().toIso8601String();
    final trace = stackTrace == null ? '' : '\n$stackTrace';
    await file.writeAsString(
      '[$timestamp] $message$trace\n',
      mode: FileMode.append,
      flush: true,
    );
  }
}
