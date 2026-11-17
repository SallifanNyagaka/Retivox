import 'package:connectivity_plus/connectivity_plus.dart';

/// Service for monitoring network connectivity state.
class ConnectivityService {
  final Connectivity _connectivity = Connectivity();

  /// Checks if the device has network connectivity.
  Future<bool> get isConnected async {
    try {
      final results = await _connectivity.checkConnectivity();
      return results.any((result) => result != ConnectivityResult.none);
    } catch (_) {
      return false;
    }
  }

  /// Returns the current connectivity status stream.
  Stream<List<ConnectivityResult>> get connectivityStatus =>
      _connectivity.onConnectivityChanged;
}