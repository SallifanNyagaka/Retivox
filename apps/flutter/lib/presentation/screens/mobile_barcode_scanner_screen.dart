import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class MobileBarcodeScannerScreen extends StatefulWidget {
  const MobileBarcodeScannerScreen({required this.onBarcode, super.key});

  final bool Function(String value) onBarcode;

  @override
  State<MobileBarcodeScannerScreen> createState() =>
      _MobileBarcodeScannerScreenState();
}

class _MobileBarcodeScannerScreenState
    extends State<MobileBarcodeScannerScreen> {
  final _manualCode = TextEditingController();
  late final MobileScannerController _controller;
  String _feedback = 'Align a product barcode inside the frame.';
  String? _lastCode;
  DateTime? _lastDetectedAt;
  bool _processing = false;

  @override
  void initState() {
    super.initState();
    _controller = MobileScannerController(
      detectionSpeed: DetectionSpeed.noDuplicates,
      facing: CameraFacing.back,
      torchEnabled: false,
    );
  }

  @override
  void dispose() {
    _manualCode.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _handleCapture(BarcodeCapture capture) {
    for (final barcode in capture.barcodes) {
      final value = barcode.rawValue?.trim();
      if (value == null || value.isEmpty) continue;

      final now = DateTime.now();
      if (value == _lastCode &&
          _lastDetectedAt != null &&
          now.difference(_lastDetectedAt!) <
              const Duration(milliseconds: 900)) {
        return;
      }
      _lastCode = value;
      _lastDetectedAt = now;
      _processCode(value);
      return;
    }
  }

  void _processCode(String value) {
    if (_processing) return;
    _processing = true;
    final added = widget.onBarcode(value);
    if (!mounted) return;
    if (added) {
      _controller.stop();
      Navigator.of(context).pop(value);
      return;
    }
    _processing = false;
    setState(() {
      _feedback =
          'No product matches $value. Scan again or enter a barcode below.';
    });
  }

  void _submitManualCode() {
    final value = _manualCode.text.trim();
    if (value.isEmpty) return;
    _processCode(value);
    _manualCode.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: const Text('Scan product barcode'),
        actions: [
          ValueListenableBuilder<MobileScannerState>(
            valueListenable: _controller,
            builder: (context, state, child) => IconButton(
              tooltip: state.torchState == TorchState.on
                  ? 'Turn flashlight off'
                  : 'Turn flashlight on',
              onPressed: state.torchState == TorchState.unavailable
                  ? null
                  : _controller.toggleTorch,
              icon: Icon(
                state.torchState == TorchState.on
                    ? Icons.flash_on_rounded
                    : Icons.flash_off_rounded,
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                MobileScanner(
                  controller: _controller,
                  onDetect: _handleCapture,
                  errorBuilder: (context, error) => ColoredBox(
                    color: Colors.black,
                    child: Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          error.errorCode ==
                                  MobileScannerErrorCode.permissionDenied
                              ? 'Camera permission is off. Allow Retivox to use the camera in your device settings, or enter a barcode below.'
                              : 'The camera could not start. Check that no other app is using it, or enter a barcode below.',
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.white),
                        ),
                      ),
                    ),
                  ),
                ),
                IgnorePointer(
                  child: Center(
                    child: Container(
                      width: MediaQuery.sizeOf(context).width * 0.76,
                      height: 150,
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.white, width: 2),
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    _feedback,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _manualCode,
                          style: const TextStyle(color: Colors.white),
                          textInputAction: TextInputAction.done,
                          onSubmitted: (_) => _submitManualCode(),
                          decoration: InputDecoration(
                            labelText: 'Enter barcode manually',
                            labelStyle: const TextStyle(color: Colors.white70),
                            enabledBorder: OutlineInputBorder(
                              borderSide: const BorderSide(
                                color: Colors.white54,
                              ),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderSide: const BorderSide(color: Colors.white),
                              borderRadius: BorderRadius.circular(10),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed: _submitManualCode,
                        child: const Text('Add'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
