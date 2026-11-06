import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:retivox_client/core/config/app_config.dart';

void main() {
  late Directory directory;
  late File envFile;

  setUp(() async {
    directory = await Directory.systemTemp.createTemp('retivox-config-');
    envFile = File('${directory.path}${Platform.pathSeparator}.env');
  });

  tearDown(() async {
    await directory.delete(recursive: true);
  });

  test(
    'reads URL and publishable key from .env including quoted values',
    () async {
      await envFile.writeAsString(
        "SUPABASE_URL='https://project.supabase.co'\n"
        'SUPABASE_PUBLISHABLE_KEY="sb_publishable_test"\n',
        mode: FileMode.append,
      );
      await envFile.writeAsString(
        'RETIVOX_WEB_API_URL="https://retivox.example.com"\n',
        mode: FileMode.append,
      );

      final config = await AppConfig.load(
        envFile: envFile,
        environment: const {},
      );

      expect(config.supabaseUrl, 'https://project.supabase.co');
      expect(config.supabasePublishableKey, 'sb_publishable_test');
      expect(config.webApiBaseUrl, 'https://retivox.example.com');
      expect(config.hasSupabase, isTrue);
    },
  );

  test('uses the key and URL from environment when .env is absent', () async {
    final config = await AppConfig.load(
      envFile: envFile,
      environment: const {
        'SUPABASE_URL': 'https://environment.supabase.co',
        'SUPABASE_PUBLISHABLE_KEY': 'environment-key',
        'RETIVOX_WEB_API_URL': 'https://environment.example.com',
      },
    );

    expect(config.supabaseUrl, 'https://environment.supabase.co');
    expect(config.supabasePublishableKey, 'environment-key');
    expect(config.webApiBaseUrl, 'https://environment.example.com');
  });
}
