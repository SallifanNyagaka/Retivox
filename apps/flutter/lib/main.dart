import 'dart:io';
import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/io_client.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'core/auth/auth_repository.dart';
import 'core/auth/offline_account_vault.dart';
import 'core/auth/secure_supabase_storage.dart';
import 'core/config/app_config.dart';
import 'core/network/backend_health_check.dart';
import 'core/network/web_api_client.dart';
import 'core/database/app_database.dart';
import 'features/dashboard/dashboard_repository.dart';
import 'features/sales/sale_repository.dart';
import 'core/sync/background_sale_sync.dart';
import 'presentation/retivox_app.dart';

Future<void> main(List<String> arguments) async {
  final backgroundSync = arguments.contains('--background-sync');
  WidgetsFlutterBinding.ensureInitialized();
  _installRuntimeErrorReporting();

  if (Platform.isAndroid || Platform.isIOS) {
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersive);
  }

  // Offline sales and active dashboard caches use SQLite. Hive was only used
  // by a retired dashboard repository; opening it here creates a process-wide
  // file lock that prevents the scheduled sync instance and POS from coexisting.

  final database = AppDatabase();
  await database.customSelect('SELECT 1').getSingle();

  final offlineVault = OfflineAccountVault(
    database: database,
    secureStorage: const FlutterSecureStorage(),
  );

  final envFile = File(
    '${File(Platform.resolvedExecutable).parent.path}${Platform.pathSeparator}.env',
  );

  AppConfig config;
  try {
    config = await AppConfig.load(envFile: envFile);
  } catch (e) {
    config = const AppConfig(
      supabaseUrl: '',
      supabasePublishableKey: '',
      webApiBaseUrl: '',
    );
  }
  final backendHealthCheck = BackendHealthCheck(
    supabaseUrl: config.supabaseUrl,
    publishableKey: config.supabasePublishableKey,
  );

  SupabaseClient? supabaseClient;
  if (config.hasSupabase) {
    // Windows desktop environments can expose a stale loopback proxy through
    // HTTPS_PROXY. Supabase is directly reachable, so use a direct transport
    // there; otherwise backend health checks incorrectly force offline login.
    final httpClient = Platform.isWindows
        ? IOClient(HttpClient()..findProxy = (_) => 'DIRECT')
        : null;
    try {
      await Supabase.initialize(
        url: config.supabaseUrl,
        publishableKey: config.supabasePublishableKey,
        httpClient: httpClient,
        authOptions: FlutterAuthClientOptions(
          localStorage: SecureSupabaseStorage(),
        ),
      );
      supabaseClient = Supabase.instance.client;
    } catch (error, stackTrace) {
      // A backend configuration or secure-storage issue must not prevent
      // staff from opening the app and using their saved offline account.
      _writeRuntimeError(error, stackTrace);
    }
  }

  final secureStorage = SecureSupabaseStorage();
  if (supabaseClient != null) {
    await secureStorage.initialize();
  }

  final saleRepository = SaleRepository(
    database: database,
    vault: offlineVault,
    client: supabaseClient,
    backendHealthCheck: backendHealthCheck,
  );

  if (backgroundSync) {
    final result = await BackgroundSaleSync(
      client: supabaseClient,
      vault: offlineVault,
      database: database,
      repository: saleRepository,
    ).run();
    await database.close();
    exit(result);
  }

  runApp(
    RetivoxApp(
      authRepository: AuthRepository(
        vault: offlineVault,
        client: supabaseClient,
        backendHealthCheck: backendHealthCheck,
      ),
      isOnlineSignInConfigured: supabaseClient != null,
      dashboardRepository: DashboardRepository(
        vault: offlineVault,
        client: supabaseClient,
        backendHealthCheck: backendHealthCheck,
        webApiClient: supabaseClient != null
            ? WebApiClient(
                baseUrl: config.webApiBaseUrl,
                supabase: supabaseClient,
              )
            : null,
      ),
      saleRepository: saleRepository,
      database: database,
    ),
  );
}

void _installRuntimeErrorReporting() {
  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    _writeRuntimeError(details.exception, details.stack ?? StackTrace.current);
  };
  PlatformDispatcher.instance.onError = (error, stackTrace) {
    _writeRuntimeError(error, stackTrace);
    return true;
  };
  ErrorWidget.builder = (details) {
    final message = details.exceptionAsString();
    _writeRuntimeError(details.exception, details.stack ?? StackTrace.current);
    return ColoredBox(
      color: const Color(0xFFF3F4F6),
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: SelectableText(
            'This screen could not be displayed.\n\n$message\n\n'
            'A diagnostic log was saved in the Retivox application data folder.',
            style: const TextStyle(color: Color(0xFF7F1D1D)),
          ),
        ),
      ),
    );
  };
}

void _writeRuntimeError(Object error, StackTrace stackTrace) {
  try {
    final appData = Platform.environment['LOCALAPPDATA'];
    final root = appData == null || appData.isEmpty
        ? Directory.systemTemp
        : Directory('$appData${Platform.pathSeparator}Retivox');
    final logs = Directory('${root.path}${Platform.pathSeparator}logs');
    logs.createSync(recursive: true);
    File('${logs.path}${Platform.pathSeparator}flutter-errors.log')
        .writeAsStringSync(
          '${DateTime.now().toIso8601String()}\n$error\n$stackTrace\n\n',
          mode: FileMode.append,
          flush: true,
        );
  } catch (_) {
    // Error reporting must never prevent the app from starting or rendering.
  }
}
