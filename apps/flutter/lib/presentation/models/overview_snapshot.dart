// This file defines the OverviewSnapshot model used by the desktop POS.
// It mirrors the JSON structure returned by the web API and supports
// serialization for offline caching.

import 'package:flutter/foundation.dart';

@immutable
class OverviewSnapshot {
  const OverviewSnapshot({
    required this.updatedAt,
    this.isCached = false,
    required this.totalSalesToday,
    required this.verifiedSales,
    required this.unverifiedSales,
    required this.totalTransactionsToday,
    required this.mpesaTransactions,
    required this.cashTransactions,
    required this.activeBranches,
    required this.pendingApprovals,
    required this.branchOverview,
    required this.stockAlerts,
    required this.operationalAlerts,
    required this.totalProfitToday,
    required this.totalLosses,
    required this.bestEmployees,
    required this.bestStores,
    required this.bestAdmins,
    required this.lowSellingItems,
    required this.bestSellingItems,
    required this.mySalesToday,
    required this.myTransactionsToday,
    required this.mpesaSalesToday,
    required this.cashSalesToday,
    this.totalLent = 0,
    this.paymentMethodsToday = const {},
    this.creditDueAlerts = const [],
    required this.recentTransactions,
  });

  final DateTime? updatedAt;
  final bool isCached;
  final double totalSalesToday;
  final int verifiedSales;
  final int unverifiedSales;
  final int totalTransactionsToday;
  final int mpesaTransactions;
  final int cashTransactions;
  final int activeBranches;
  final int pendingApprovals;
  final List<Map<String, dynamic>> branchOverview;
  final List<Map<String, dynamic>> stockAlerts;
  final List<Map<String, dynamic>> operationalAlerts;
  final double totalProfitToday;
  final double totalLosses;
  final List<Map<String, dynamic>> bestEmployees;
  final List<Map<String, dynamic>> bestStores;
  final List<Map<String, dynamic>> bestAdmins;
  final List<Map<String, dynamic>> lowSellingItems;
  final List<Map<String, dynamic>> bestSellingItems;
  final double mySalesToday;
  final int myTransactionsToday;
  final double mpesaSalesToday;
  final double cashSalesToday;
  final double totalLent;
  final Map<String, double> paymentMethodsToday;
  final List<Map<String, dynamic>> creditDueAlerts;
  final List<Map<String, dynamic>> recentTransactions;

  // Serialization helpers for the encrypted local overview cache.
  Map<String, dynamic> toJson() => {
    'updatedAt': updatedAt?.toIso8601String(),
    'isCached': isCached,
    'totalSalesToday': totalSalesToday,
    'verifiedSales': verifiedSales,
    'unverifiedSales': unverifiedSales,
    'totalTransactionsToday': totalTransactionsToday,
    'mpesaTransactions': mpesaTransactions,
    'cashTransactions': cashTransactions,
    'activeBranches': activeBranches,
    'pendingApprovals': pendingApprovals,
    'branchOverview': branchOverview,
    'stockAlerts': stockAlerts,
    'operationalAlerts': operationalAlerts,
    'totalProfitToday': totalProfitToday,
    'totalLosses': totalLosses,
    'bestEmployees': bestEmployees,
    'bestStores': bestStores,
    'bestAdmins': bestAdmins,
    'lowSellingItems': lowSellingItems,
    'bestSellingItems': bestSellingItems,
    'mySalesToday': mySalesToday,
    'myTransactionsToday': myTransactionsToday,
    'mpesaSalesToday': mpesaSalesToday,
    'cashSalesToday': cashSalesToday,
    'totalLent': totalLent,
    'paymentMethodsToday': paymentMethodsToday,
    'creditDueAlerts': creditDueAlerts,
    'recentTransactions': recentTransactions,
  };

  factory OverviewSnapshot.fromJson(Map<String, dynamic> json) =>
      OverviewSnapshot(
        updatedAt: json['updatedAt'] != null
            ? DateTime.parse(json['updatedAt'] as String)
            : null,
        isCached: json['isCached'] == true,
        totalSalesToday: _number(json['totalSalesToday']),
        verifiedSales: _integer(json['verifiedSales']),
        unverifiedSales: _integer(json['unverifiedSales']),
        totalTransactionsToday: _integer(json['totalTransactionsToday']),
        mpesaTransactions: _integer(json['mpesaTransactions']),
        cashTransactions: _integer(json['cashTransactions']),
        activeBranches: _integer(json['activeBranches']),
        pendingApprovals: _integer(json['pendingApprovals']),
        branchOverview: _rows(json['branchOverview']),
        stockAlerts: _rows(json['stockAlerts']),
        operationalAlerts: _rows(json['operationalAlerts']),
        totalProfitToday: _number(json['totalProfitToday']),
        totalLosses: _number(json['totalLosses']),
        bestEmployees: _rows(json['bestEmployees']),
        bestStores: _rows(json['bestStores']),
        bestAdmins: _rows(json['bestAdmins']),
        lowSellingItems: _rows(json['lowSellingItems']),
        bestSellingItems: _rows(json['bestSellingItems']),
        mySalesToday: _number(json['mySalesToday']),
        myTransactionsToday: _integer(json['myTransactionsToday']),
        mpesaSalesToday: _number(json['mpesaSalesToday']),
        cashSalesToday: _number(json['cashSalesToday']),
        totalLent: _number(json['totalLent']),
        paymentMethodsToday: json['paymentMethodsToday'] is Map
            ? (json['paymentMethodsToday'] as Map).map(
                (key, value) => MapEntry(key.toString(), _number(value)),
              )
            : const {},
        creditDueAlerts: _rows(json['creditDueAlerts']),
        recentTransactions: _rows(json['recentTransactions']),
      );

  static double _number(Object? value) => value is num
      ? value.toDouble()
      : double.tryParse(value?.toString() ?? '') ?? 0;

  static int _integer(Object? value) =>
      value is num ? value.toInt() : int.tryParse(value?.toString() ?? '') ?? 0;

  static List<Map<String, dynamic>> _rows(Object? value) => value is List
      ? value
            .whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .toList()
      : const [];

  OverviewSnapshot copyWith({DateTime? updatedAt, bool? isCached}) =>
      OverviewSnapshot(
        updatedAt: updatedAt ?? this.updatedAt,
        isCached: isCached ?? this.isCached,
        totalSalesToday: totalSalesToday,
        verifiedSales: verifiedSales,
        unverifiedSales: unverifiedSales,
        totalTransactionsToday: totalTransactionsToday,
        mpesaTransactions: mpesaTransactions,
        cashTransactions: cashTransactions,
        activeBranches: activeBranches,
        pendingApprovals: pendingApprovals,
        branchOverview: branchOverview,
        stockAlerts: stockAlerts,
        operationalAlerts: operationalAlerts,
        totalProfitToday: totalProfitToday,
        totalLosses: totalLosses,
        bestEmployees: bestEmployees,
        bestStores: bestStores,
        bestAdmins: bestAdmins,
        lowSellingItems: lowSellingItems,
        bestSellingItems: bestSellingItems,
        mySalesToday: mySalesToday,
        myTransactionsToday: myTransactionsToday,
        mpesaSalesToday: mpesaSalesToday,
        cashSalesToday: cashSalesToday,
        totalLent: totalLent,
        paymentMethodsToday: paymentMethodsToday,
        creditDueAlerts: creditDueAlerts,
        recentTransactions: recentTransactions,
      );
}
