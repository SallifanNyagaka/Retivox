import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

class WebApiClient {
  const WebApiClient({required this.baseUrl, required this.supabase});

  final String baseUrl;
  final SupabaseClient? supabase;

  Future<Map<String, dynamic>> get(String path) => _send('GET', path);

  Future<Map<String, dynamic>> post(String path, Map<String, Object?> body) =>
      _send('POST', path, body: body);

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Map<String, Object?>? body,
  }) async {
    final base = Uri.tryParse(baseUrl.trim());
    if (base == null ||
        !base.hasAuthority ||
        base.userInfo.isNotEmpty ||
        base.hasQuery ||
        base.hasFragment ||
        (base.scheme != 'https' &&
            !(base.scheme == 'http' &&
                (base.host == 'localhost' || base.host == '127.0.0.1')))) {
      throw const WebApiException(
        'Configure RETIVOX_WEB_API_URL with the deployed Retivox web app URL.',
      );
    }

    final accessToken = supabase?.auth.currentSession?.accessToken;
    if (accessToken == null || accessToken.isEmpty) {
      throw const WebApiException('Sign in online before continuing.');
    }

    final endpoint = base.resolve(path);
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    try {
      final request = await client
          .openUrl(method, endpoint)
          .timeout(const Duration(seconds: 20));
      request.followRedirects = false;
      request.headers.set(
        HttpHeaders.authorizationHeader,
        'Bearer $accessToken',
      );
      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(body));
      }
      final response = await request.close().timeout(
        const Duration(seconds: 20),
      );
      final bytes = await response
          .fold<List<int>>(<int>[], (buffer, chunk) {
            if (buffer.length + chunk.length > 65536) {
              throw const WebApiException(
                'The server response was unexpectedly large.',
              );
            }
            return buffer..addAll(chunk);
          })
          .timeout(const Duration(seconds: 20));
      final decoded = bytes.isEmpty
          ? null
          : jsonDecode(utf8.decode(bytes, allowMalformed: false));
      if (decoded is! Map<String, dynamic>) {
        throw WebApiException(
          'The server returned an invalid response (${response.statusCode}).',
        );
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw WebApiException(
          decoded['error']?.toString() ??
              'The server rejected the request (${response.statusCode}).',
        );
      }
      if (decoded['success'] != true) {
        throw WebApiException(
          decoded['error']?.toString() ??
              'The server could not complete the request.',
        );
      }
      return decoded;
    } on WebApiException {
      rethrow;
    } on SocketException {
      throw const WebApiException(
        'Unable to reach the Retivox web service. Check your connection and try again.',
      );
    } on HttpException {
      throw const WebApiException(
        'Unable to reach the Retivox web service. Check your connection and try again.',
      );
    } on FormatException {
      throw const WebApiException(
        'The Retivox web service returned invalid data.',
      );
    } on HandshakeException {
      throw const WebApiException(
        'A secure connection to the Retivox web service could not be established.',
      );
    } on TimeoutException {
      throw const WebApiException(
        'The Retivox web service took too long to respond. Try again.',
      );
    } finally {
      client.close(force: true);
    }
  }
}

class WebApiException implements Exception {
  const WebApiException(this.message);

  final String message;

  @override
  String toString() => message;
}
