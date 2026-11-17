import 'dart:io';

/// Checks whether this installation can reach the configured Supabase Auth
/// service. A connected Wi-Fi/Ethernet interface alone is not sufficient.
class BackendHealthCheck {
  const BackendHealthCheck({
    required this.supabaseUrl,
    required this.publishableKey,
  });

  final String supabaseUrl;
  final String publishableKey;

  bool get isConfigured =>
      supabaseUrl.trim().isNotEmpty && publishableKey.trim().isNotEmpty;

  Future<bool> isReachable() async {
    if (!isConfigured) return false;

    final httpClient = HttpClient();
    if (Platform.isWindows) {
      // A stale local proxy can be present even when the Supabase host is
      // directly reachable from this machine.
      httpClient.findProxy = (_) => 'DIRECT';
    }

    try {
      final root = supabaseUrl.trim().replaceFirst(RegExp(r'/$'), '');
      final request = await httpClient
          .getUrl(Uri.parse('$root/auth/v1/health'))
          .timeout(const Duration(seconds: 4));
      request.headers.set('apikey', publishableKey.trim());
      final response = await request.close().timeout(
        const Duration(seconds: 4),
      );
      await response.drain<void>();
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (_) {
      return false;
    } finally {
      httpClient.close(force: true);
    }
  }
}
