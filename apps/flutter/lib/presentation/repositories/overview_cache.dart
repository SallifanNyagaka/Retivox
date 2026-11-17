import 'package:hive/hive.dart';

import '../models/overview_snapshot.dart';

class OverviewCache {
  static const _boxName = 'overviewCache';
  final Box _box = Hive.box(_boxName);

  Future<void> save(String accountId, OverviewSnapshot snapshot) async {
    await _box.put(accountId, snapshot.toJson());
  }

  OverviewSnapshot? load(String accountId) {
    final raw = _box.get(accountId);
    return raw != null
        ? OverviewSnapshot.fromJson(Map<String, dynamic>.from(raw as Map))
        : null;
  }
}
