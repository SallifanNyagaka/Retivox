import 'dart:async';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';

import '../auth/offline_account_vault.dart';
import '../database/app_database.dart';
import '../../features/sales/sale_repository.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'connectivity_service.dart';

/// Service for handling offline data sync with the Retivox web backend.
class SyncService {
  SyncService({
    required AppDatabase database,
    required OfflineAccountVault vault,
    required SupabaseClient? supabase,
    required SaleRepository saleRepository,
    required ConnectivityService connectivityService,
  })  : _database = database,
        _vault = vault,
        _supabase = supabase,
        _saleRepository = saleRepository,
        _connectivityService = connectivityService;

  final AppDatabase _database;
  final OfflineAccountVault _vault;
  final SupabaseClient? _supabase;
  final SaleRepository _saleRepository;
  final ConnectivityService _connectivityService;

  /// Checks if the device is currently online.
  Future<bool> get isOnline => _connectivityService.isConnected;

  /// Syncs pending sales to the backend.
  Future<int> syncPendingSales(String accountId) async {
    if (_supabase == null) {
      await _log('Skipped: Supabase is not configured.');
      return 0;
    }

    if (_supabase.auth.currentSession == null) {
      await _log('Skipped: No authenticated session available.');
      return 0;
    }

    // Check connectivity
    if (!await isOnline) {
      await _log('Skipped: Device is offline.');
      return 0;
    }

    try {
      final user = await _vault.loadAuthorizedAccount(accountId);
      if (user == null) {
        await _log('Skipped: No authorized offline profile available.');
        return 0;
      }

      final before = await _database.countSalesForAccount(accountId);
      if (before == 0) {
        await _log('Completed: no pending sales.');
        return 0;
      }

      // Perform the sync
      await _saleRepository.syncPending(user);
      final after = await _database.countSalesForAccount(accountId);
      await _log('Completed: pending sales before=$before after=$after.');

      return before - after;
    } catch (error, stackTrace) {
      await _log('Failed: ${error.runtimeType}.', stackTrace: stackTrace);
      return 1;
    }
  }

  /// Periodic sync check - runs when connectivity changes
  StreamSubscription<List<ConnectivityResult>> startPeriodicSync(
    String accountId, {
    Duration interval = const Duration(hours: 1),
  }) {
    return _connectivityService.connectivityStatus.listen((results) {
      if (results.any((result) => result != ConnectivityResult.none)) {
        // Small delay to ensure connection is stable
        unawaited(Future<void>(() async {
          await Future<void>.delayed(const Duration(seconds: 2));
          try {
            await syncPendingSales(accountId);
          } catch (error, stackTrace) {
            await _log('Failed: ${error.runtimeType}.', stackTrace: stackTrace);
          }
        }));
      }
    });
  }

  Future<void> _log(String message, {StackTrace? stackTrace}) async {
    try {
      final localAppData = Platform.environment['LOCALAPPDATA'];
      if (localAppData == null || localAppData.isEmpty) return;

      final directory = Directory(
        '$localAppData${Platform.pathSeparator}Retivox${Platform.pathSeparator}logs',
      );
      await directory.create(recursive: true);

      final file = File(
        '${directory.path}${Platform.pathSeparator}sync-service.log',
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
    } catch (_) {
      // Log failures are non-critical
    }
  }
}