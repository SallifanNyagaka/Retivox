import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:retivox_client/core/auth/offline_account_vault.dart';
import 'package:retivox_client/core/auth/retivox_user.dart';
import 'package:retivox_client/core/database/app_database.dart';
import 'package:retivox_client/core/network/backend_health_check.dart';
import 'package:retivox_client/features/dashboard/dashboard_repository.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _userId = '11111111-1111-4111-8111-111111111111';
const _businessId = '22222222-2222-4222-8222-222222222222';
const _owner = RetivoxUser(
  id: _userId,
  businessId: _businessId,
  name: 'Owner',
  email: 'owner@example.test',
  businessName: 'Sample business',
  role: RetivoxRole.owner,
  branches: [],
  currency: 'KES',
);
const _employee = RetivoxUser(
  id: _userId,
  businessId: _businessId,
  name: 'Employee',
  email: 'owner@example.test',
  businessName: 'Sample business',
  role: RetivoxRole.employee,
  branches: [],
  currency: 'KES',
);

void main() {
  late AppDatabase database;
  late OfflineAccountVault vault;
  late HttpServer healthServer;
  late SupabaseClient supabase;
  late List<Uri> requests;
  late List<Map<String, dynamic>> requestBodies;
  var failCreditAlerts = false;
  var delayOwnerOverviewReads = false;
  var releaseOwnerOverviewReadsTogether = false;
  var ownerOverviewReadDelay = const Duration(milliseconds: 60);
  var activeOwnerOverviewReads = 0;
  var maxActiveOwnerOverviewReads = 0;
  late Completer<void> ownerOverviewReadsStarted;

  Map<String, dynamic> responseBody(http.Request request) {
    final uri = request.url;
    requests.add(uri);
    if (uri.path == '/auth/v1/user') {
      return {
        'id': _userId,
        'app_metadata': <String, dynamic>{},
        'user_metadata': <String, dynamic>{},
        'aud': 'authenticated',
        'role': 'authenticated',
        'email': 'owner@example.test',
        'created_at': '2025-01-01T00:00:00.000Z',
      };
    }
    if (uri.path == '/rest/v1/rpc/desktop_overview_detailed') return {};
    if (uri.path == '/rest/v1/receivable_account_balances') {
      if (uri.queryParameters.containsKey('due_date')) {
        if (failCreditAlerts) throw const SocketException('simulated timeout');
        return {
          'rows': [
            {
              'id': 'credit-1',
              'customer_name': 'Sample customer',
              'customer_phone': '0712345678',
              'due_date': '2026-11-26',
              'balance_due': 40,
              'account_status': 'open',
              'branch_name': 'Sample branch',
            },
          ],
        };
      }
      return {
        'rows': [
          {'balance_due': 60.5},
          {'balance_due': 39.5},
        ],
      };
    }
    if (uri.path == '/rest/v1/payments') {
      return {
        'rows': [
          {
            'payment_method': 'cash',
            'amount': 75,
            'status': 'confirmed',
            'transactions': {'branch_id': 'branch-1', 'status': 'completed'},
          },
          {
            'payment_method': 'cash',
            'amount': 25,
            'status': 'confirmed',
            'transactions': {'branch_id': 'branch-1', 'status': 'voided'},
          },
          {
            'payment_method': 'mpesa_manual',
            'amount': 30,
            'status': 'confirmed',
            'transactions': {'branch_id': 'branch-1', 'status': 'completed'},
          },
        ],
      };
    }
    throw StateError('Unexpected test request: ${request.method} $uri');
  }

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    database = AppDatabase(executor: NativeDatabase.memory());
    await database.customSelect('SELECT 1').getSingle();
    vault = OfflineAccountVault(database: database);
    await vault.authorizeAccount(_owner);
    requests = [];
    requestBodies = [];
    failCreditAlerts = false;
    delayOwnerOverviewReads = false;
    releaseOwnerOverviewReadsTogether = false;
    ownerOverviewReadDelay = const Duration(milliseconds: 60);
    activeOwnerOverviewReads = 0;
    maxActiveOwnerOverviewReads = 0;
    ownerOverviewReadsStarted = Completer<void>();

    healthServer = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    unawaited(
      healthServer.forEach((request) async {
        request.response.statusCode = HttpStatus.ok;
        await request.response.close();
      }),
    );
    supabase = SupabaseClient(
      'http://${healthServer.address.address}:${healthServer.port}',
      'test-publishable-key',
      httpClient: MockClient((request) async {
        if (delayOwnerOverviewReads &&
            {
              '/rest/v1/receivable_account_balances',
              '/rest/v1/payments',
            }.contains(request.url.path)) {
          activeOwnerOverviewReads++;
          if (activeOwnerOverviewReads > maxActiveOwnerOverviewReads) {
            maxActiveOwnerOverviewReads = activeOwnerOverviewReads;
          }
          try {
            if (releaseOwnerOverviewReadsTogether) {
              if (activeOwnerOverviewReads == 3 &&
                  !ownerOverviewReadsStarted.isCompleted) {
                ownerOverviewReadsStarted.complete();
              }
              await ownerOverviewReadsStarted.future.timeout(
                const Duration(seconds: 2),
              );
            }
            await Future<void>.delayed(ownerOverviewReadDelay);
          } finally {
            activeOwnerOverviewReads--;
          }
        }
        final body = responseBody(request);
        if (request.body.isNotEmpty) {
          requestBodies.add(jsonDecode(request.body) as Map<String, dynamic>);
        }
        final rows = body['rows'];
        return http.Response(
          jsonEncode(rows ?? body),
          HttpStatus.ok,
          headers: {'content-type': 'application/json'},
          request: request,
        );
      }),
    );
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    String base64UrlJson(Map<String, Object> value) =>
        base64Url.encode(utf8.encode(jsonEncode(value))).replaceAll('=', '');
    final accessToken =
        '${base64UrlJson({'alg': 'HS256', 'typ': 'JWT'})}.'
        '${base64UrlJson({'sub': _userId, 'exp': now + 3600, 'iat': now, 'aud': 'authenticated'})}.'
        'dGVzdA';
    await supabase.auth.setSession(
      'test-refresh-token',
      accessToken: accessToken,
    );
  });

  tearDown(() async {
    await supabase.dispose();
    await healthServer.close(force: true);
    await database.close();
  });

  DashboardRepository repository() => DashboardRepository(
    vault: vault,
    client: supabase,
    backendHealthCheck: BackendHealthCheck(
      supabaseUrl:
          'http://${healthServer.address.address}:${healthServer.port}',
      publishableKey: 'test-publishable-key',
    ),
  );

  List<Future<dynamic>> ownerOverviewReadRequests() {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final dueThrough = today.add(const Duration(days: 2));
    final localNow = DateTime.now();
    final todayStart = DateTime(
      localNow.year,
      localNow.month,
      localNow.day,
    ).toUtc().toIso8601String();
    return [
      supabase
          .from('receivable_account_balances')
          .select('balance_due')
          .eq('business_id', _owner.businessId)
          .gt('balance_due', 0),
      supabase
          .from('receivable_account_balances')
          .select(
            'id, customer_name, customer_phone, due_date, balance_due, account_status, branch_name',
          )
          .eq('business_id', _owner.businessId)
          .gt('balance_due', 0)
          .lte('due_date', dueThrough.toIso8601String().substring(0, 10))
          .order('due_date')
          .range(0, 99),
      supabase
          .from('payments')
          .select(
            'payment_method, amount, status, transactions!inner(branch_id, status)',
          )
          .eq('business_id', _owner.businessId)
          .gte('payment_at', todayStart)
          .neq('status', 'rejected'),
    ];
  }

  test(
    'owner overview keeps its query scope and assembles all three summaries',
    () async {
      final snapshot = await repository().loadOverview(_owner);

      expect(snapshot.isCached, isFalse);
      expect(snapshot.totalLent, 100);
      expect(snapshot.creditDueAlerts, hasLength(1));
      expect(snapshot.paymentMethodsToday, {'cash': 75, 'mpesa_manual': 30});

      final overviewRequest = requests.singleWhere(
        (uri) => uri.path.endsWith('/rpc/desktop_overview_detailed'),
      );
      expect(
        overviewRequest.path,
        endsWith('/rpc/desktop_overview_detailed'),
      );
      expect(
        requests.where((uri) => uri.path.startsWith('/rest/v1/')),
        hasLength(4),
      );
      expect(
        requestBodies.any((body) => body['business_id'] == _businessId),
        isTrue,
      );
      final receivableRequests = requests
          .where((uri) => uri.path.endsWith('/receivable_account_balances'))
          .toList();
      expect(receivableRequests, hasLength(2));
      for (final uri in receivableRequests) {
        expect(uri.queryParameters['business_id'], 'eq.$_businessId');
        expect(uri.queryParameters['balance_due'], 'gt.0');
      }
      expect(
        receivableRequests.any(
          (uri) => uri.queryParameters.containsKey('due_date'),
        ),
        isTrue,
      );
      final dueRequest = receivableRequests.singleWhere(
        (uri) => uri.queryParameters.containsKey('due_date'),
      );
      expect(dueRequest.queryParameters['due_date'], startsWith('lte.'));
      expect(dueRequest.queryParameters['order'], 'due_date.desc.nullslast');
      final paymentsRequest = requests.singleWhere(
        (uri) => uri.path.endsWith('/payments'),
      );
      expect(paymentsRequest.queryParameters['business_id'], 'eq.$_businessId');
      expect(paymentsRequest.queryParameters['status'], 'neq.rejected');
      expect(paymentsRequest.queryParameters['payment_at'], startsWith('gte.'));
    },
  );

  test(
    'non-owner overview does not issue owner-only enrichment reads',
    () async {
      await repository().loadOverview(_employee);

      expect(
        requests.where((uri) => uri.path.startsWith('/rest/v1/')),
        hasLength(1),
      );
      expect(
        requests.singleWhere(
          (uri) => uri.path.endsWith('/rpc/desktop_overview_detailed'),
        ),
        isNotNull,
      );
    },
  );

  test(
    'starts all owner overview enrichment reads before awaiting any result',
    () async {
      delayOwnerOverviewReads = true;

      final snapshot = await repository().loadOverview(_owner);

      expect(snapshot.totalLent, 100);
      expect(maxActiveOwnerOverviewReads, 3);
    },
  );

  test('measures serial versus concurrent owner-read latency with fixed mock delay', () async {
    delayOwnerOverviewReads = true;
    const sampleCount = 4;
    final serialTimes = <int>[];
    for (var sample = 0; sample < sampleCount; sample++) {
      activeOwnerOverviewReads = 0;
      maxActiveOwnerOverviewReads = 0;
      requests.clear();
      final stopwatch = Stopwatch()..start();
      for (final request in ownerOverviewReadRequests()) {
        await request;
      }
      serialTimes.add(stopwatch.elapsedMilliseconds);
      expect(requests, hasLength(3));
    }

    releaseOwnerOverviewReadsTogether = true;
    final parallelTimes = <int>[];
    for (var sample = 0; sample < sampleCount; sample++) {
      activeOwnerOverviewReads = 0;
      maxActiveOwnerOverviewReads = 0;
      ownerOverviewReadsStarted = Completer<void>();
      requests.clear();
      final stopwatch = Stopwatch()..start();
      await Future.wait<dynamic>(ownerOverviewReadRequests());
      parallelTimes.add(stopwatch.elapsedMilliseconds);
      expect(requests, hasLength(3));
      expect(maxActiveOwnerOverviewReads, 3);
    }
    final serialMean =
        serialTimes.reduce((sum, elapsed) => sum + elapsed) / sampleCount;
    final parallelMean =
        parallelTimes.reduce((sum, elapsed) => sum + elapsed) / sampleCount;
    // This is a controlled local mock measurement, not production latency.
    // ignore: avoid_print
    print(
      'Owner overview enrichment mock: serial ${serialMean.toStringAsFixed(1)} ms; '
      'parallel ${parallelMean.toStringAsFixed(1)} ms; 3 requests in each case.',
    );
    expect(parallelMean, lessThan(serialMean));
  });

  test('owner overview falls back to its last complete cached snapshot on read failure', () async {
    final repo = repository();
    final online = await repo.loadOverview(_owner);
    failCreditAlerts = true;

    final result = await repo.loadOverview(_owner);

    expect(result.isCached, isTrue);
    expect(result.totalLent, online.totalLent);
    expect(result.creditDueAlerts, online.creditDueAlerts);
    expect(result.paymentMethodsToday, online.paymentMethodsToday);
  });
}
