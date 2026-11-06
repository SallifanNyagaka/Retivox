import 'dart:io';

class AppConfig {
  const AppConfig({
    required this.supabaseUrl,
    required this.supabasePublishableKey,
    required this.webApiBaseUrl,
  });

  final String supabaseUrl;
  final String supabasePublishableKey;
  final String webApiBaseUrl;

  bool get hasSupabase =>
      supabaseUrl.isNotEmpty && supabasePublishableKey.isNotEmpty;

  static Future<AppConfig> load({
    File? envFile,
    Map<String, String>? environment,
    String? buildUrl,
    String? buildPublishableKey,
    String? buildWebApiBaseUrl,
  }) async {
    final file =
        envFile ??
        File(
          '${File(Platform.resolvedExecutable).parent.path}${Platform.pathSeparator}.env',
        );
    final fileValues = await _readEnvFile(file);
    final processValues = environment ?? Platform.environment;

    return AppConfig(
      supabaseUrl: _firstValue([
        fileValues['SUPABASE_URL'],
        processValues['SUPABASE_URL'],
        buildUrl,
      ]),
      supabasePublishableKey: _firstValue([
        fileValues['SUPABASE_PUBLISHABLE_KEY'],
        fileValues['SUPABASE_ANON_KEY'],
        processValues['SUPABASE_PUBLISHABLE_KEY'],
        processValues['SUPABASE_ANON_KEY'],
        buildPublishableKey,
      ]),
      webApiBaseUrl: _firstValue([
        fileValues['RETIVOX_WEB_API_URL'],
        processValues['RETIVOX_WEB_API_URL'],
        buildWebApiBaseUrl,
      ]),
    );
  }

  static Future<Map<String, String>> _readEnvFile(File file) async {
    if (!await file.exists()) return const {};

    final values = <String, String>{};
    final lines = await file.readAsLines();
    for (var index = 0; index < lines.length; index++) {
      final line = lines[index].trim();
      if (line.isEmpty || line.startsWith('#')) continue;
      final separator = line.indexOf('=');
      if (separator <= 0) {
        throw FormatException('Invalid .env entry on line ${index + 1}.');
      }

      final name = line.substring(0, separator).trim();
      if (name != 'SUPABASE_URL' &&
          name != 'SUPABASE_PUBLISHABLE_KEY' &&
          name != 'SUPABASE_ANON_KEY' &&
          name != 'RETIVOX_WEB_API_URL') {
        continue;
      }

      var value = line.substring(separator + 1).trim();
      if (value.length >= 2 &&
          ((value.startsWith("'") && value.endsWith("'")) ||
              (value.startsWith('"') && value.endsWith('"')))) {
        value = value.substring(1, value.length - 1);
      }
      values[name] = value.trim();
    }
    return values;
  }

  static String _firstValue(List<String?> candidates) {
    for (final candidate in candidates) {
      final value = candidate?.trim();
      if (value != null && value.isNotEmpty) return value;
    }
    return '';
  }
}
