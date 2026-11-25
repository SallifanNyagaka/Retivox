import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:retivox_client/core/network/backend_health_check.dart';

void main() {
  late HttpServer server;
  late int requestCount;
  late int responseStatus;

  setUp(() async {
    requestCount = 0;
    responseStatus = HttpStatus.ok;
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      requestCount++;
      await Future<void>.delayed(const Duration(milliseconds: 60));
      request.response.statusCode = responseStatus;
      await request.response.close();
    });
  });

  tearDown(() async {
    await server.close(force: true);
  });

  BackendHealthCheck checker() => BackendHealthCheck(
    supabaseUrl: 'http://${server.address.address}:${server.port}',
    publishableKey: 'test-key',
  );

  test(
    'reports each completed probe result without retaining stale status',
    () async {
      final healthCheck = checker();

      expect(await healthCheck.isReachable(), isTrue);
      responseStatus = HttpStatus.serviceUnavailable;
      expect(await healthCheck.isReachable(), isFalse);
      expect(requestCount, 2);
    },
  );

  test('simultaneous callers share one in-flight probe', () async {
    final healthCheck = checker();

    final results = await Future.wait([
      healthCheck.isReachable(),
      healthCheck.isReachable(),
    ]);

    expect(results, [isTrue, isTrue]);
    expect(requestCount, 1);
  });
}
