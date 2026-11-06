import 'package:flutter/material.dart';

import '../core/database/app_database.dart';
import '../core/auth/auth_repository.dart';
import '../core/auth/retivox_user.dart';
import '../features/dashboard/dashboard_repository.dart';
import '../features/sales/sale_repository.dart';
import 'screens/login_screen.dart';
import 'screens/role_home_screen.dart';

class RetivoxApp extends StatefulWidget {
  const RetivoxApp({
    required this.authRepository,
    required this.isOnlineSignInConfigured,
    required this.dashboardRepository,
    required this.saleRepository,
    required this.database,
    super.key,
  });

  final AuthRepository authRepository;
  final bool isOnlineSignInConfigured;
  final DashboardRepository dashboardRepository;
  final SaleRepository saleRepository;
  final AppDatabase database;

  @override
  State<RetivoxApp> createState() => _RetivoxAppState();
}

class _RetivoxAppState extends State<RetivoxApp> {
  RetivoxUser? _user;
  bool _darkMode = false;

  @override
  void initState() {
    super.initState();
    _loadAppearancePreference();
  }

  Future<void> _loadAppearancePreference() async {
    try {
      final preference = await widget.database.readPreference('dark_mode');
      if (mounted) setState(() => _darkMode = preference == 'true');
    } catch (error, stackTrace) {
      FlutterError.reportError(
        FlutterErrorDetails(
          exception: error,
          stack: stackTrace,
          library: 'Retivox appearance settings',
          context: ErrorDescription('while loading the saved theme preference'),
        ),
      );
    }
  }

  Future<void> _setDarkMode(bool enabled) async {
    await widget.database.writePreference('dark_mode', enabled.toString());
    if (mounted) setState(() => _darkMode = enabled);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Retivox',
      debugShowCheckedModeBanner: false,
      themeMode: _darkMode ? ThemeMode.dark : ThemeMode.light,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF176B5B)),
        useMaterial3: true,
        inputDecorationTheme: const InputDecorationTheme(
          border: OutlineInputBorder(),
        ),
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF176B5B),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
        inputDecorationTheme: const InputDecorationTheme(
          border: OutlineInputBorder(),
        ),
      ),
      home: _user == null
          ? LoginScreen(
              repository: widget.authRepository,
              onlineSignInConfigured: widget.isOnlineSignInConfigured,
              onAuthenticated: (user) => setState(() => _user = user),
            )
          : RoleHomeScreen(
              user: _user!,
              repository: widget.authRepository,
              dashboardRepository: widget.dashboardRepository,
              saleRepository: widget.saleRepository,
              darkMode: _darkMode,
              onDarkModeChanged: _setDarkMode,
              onSignedOut: () => setState(() => _user = null),
            ),
    );
  }
}
