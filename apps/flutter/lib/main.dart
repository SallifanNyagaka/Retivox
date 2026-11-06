import 'dart:io';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/auth/auth_repository.dart';
import 'core/auth/offline_account_vault.dart';
import 'core/auth/secure_supabase_storage.dart';
import 'core/config/app_config.dart';
import 'core/network/web_api_client.dart';
import 'core/database/app_database.dart';
import 'core/sync/background_sale_sync.dart';
import 'features/dashboard/dashboard_repository.dart';
import 'features/sales/sale_repository.dart';
import 'presentation/retivox_app.dart';

Future<void> main(List<String> arguments) async {
  final backgroundSync = arguments.contains('--background-sync');
  WidgetsFlutterBinding.ensureInitialized();

  final database = AppDatabase();
  try {
    await database.customSelect('SELECT 1').getSingle();
    final vault = OfflineAccountVault(database: database);
    final config = await AppConfig.load(
      buildUrl: const String.fromEnvironment('SUPABASE_URL'),
      buildPublishableKey: const String.fromEnvironment(
        'SUPABASE_PUBLISHABLE_KEY',
        defaultValue: String.fromEnvironment('SUPABASE_ANON_KEY'),
      ),
      buildWebApiBaseUrl: const String.fromEnvironment('RETIVOX_WEB_API_URL'),
    );
    SupabaseClient? client;

    if (config.hasSupabase) {
      await Supabase.initialize(
        url: config.supabaseUrl,
        publishableKey: config.supabasePublishableKey,
        authOptions: FlutterAuthClientOptions(
          localStorage: SecureSupabaseStorage(),
        ),
      );
      client = Supabase.instance.client;
    }

    final saleRepository = SaleRepository(
      database: database,
      vault: vault,
      client: client,
    );
    if (backgroundSync) {
      final result = await BackgroundSaleSync(
        client: client,
        vault: vault,
        database: database,
        repository: saleRepository,
      ).run();
      await database.close();
      exit(result);
    }

    runApp(
      RetivoxApp(
        authRepository: AuthRepository(vault: vault, client: client),
        dashboardRepository: DashboardRepository(
          vault: vault,
          client: client,
          webApiClient: WebApiClient(
            baseUrl: config.webApiBaseUrl,
            supabase: client,
          ),
        ),
        database: database,
        saleRepository: saleRepository,
        isOnlineSignInConfigured: client != null,
      ),
    );
  } catch (error, stackTrace) {
    if (backgroundSync) {
      stderr.writeln('Background sync startup failed: ${error.runtimeType}.');
      stderr.writeln(stackTrace);
      try {
        await database.close();
      } catch (closeError) {
        stderr.writeln('Could not close background sync database: $closeError');
      }
      exit(1);
    }
    rethrow;
  }
}
