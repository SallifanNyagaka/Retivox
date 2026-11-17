import 'package:flutter/material.dart';

import '../theme/retivox_theme.dart';

enum RetivoxButtonVariant {
  primary,
  outline,
  danger,
  success;
}

/// Reusable Button matching Retivox web buttons (btn-primary, btn-outline, btn-danger).
class RetivoxButton extends StatelessWidget {
  const RetivoxButton({
    required this.label,
    required this.onPressed,
    this.variant = RetivoxButtonVariant.primary,
    this.icon,
    this.isLoading = false,
    this.dense = false,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final RetivoxButtonVariant variant;
  final Widget? icon;
  final bool isLoading;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    Color bg;
    Color fg;
    BorderSide borderSide = BorderSide.none;

    switch (variant) {
      case RetivoxButtonVariant.primary:
        bg = isDark ? RetivoxTheme.primaryDarkMode : RetivoxTheme.primaryLightMode;
        fg = Colors.white;
      case RetivoxButtonVariant.outline:
        bg = isDark ? RetivoxTheme.surfaceDark : RetivoxTheme.surfaceLight;
        fg = isDark ? RetivoxTheme.textPrimaryDark : RetivoxTheme.textPrimaryLight;
        borderSide = BorderSide(
          color: isDark ? RetivoxTheme.borderDark : RetivoxTheme.borderLight,
        );
      case RetivoxButtonVariant.danger:
        bg = isDark ? RetivoxTheme.dangerDark : RetivoxTheme.dangerLight;
        fg = isDark ? const Color(0xFFF87171) : RetivoxTheme.danger;
        borderSide = BorderSide(
          color: isDark ? const Color(0xFF991B1B) : const Color(0xFFFECACA),
        );
      case RetivoxButtonVariant.success:
        bg = isDark ? RetivoxTheme.successDark : RetivoxTheme.successLight;
        fg = isDark ? const Color(0xFF34D399) : const Color(0xFF047857);
        borderSide = BorderSide(
          color: isDark ? const Color(0xFF065F46) : const Color(0xFFA7F3D0),
        );
    }

    final padH = dense ? 10.0 : 16.0;
    final padV = dense ? 6.0 : 10.0;
    final fontSize = dense ? 12.0 : 13.0;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: isLoading ? null : onPressed,
        borderRadius: BorderRadius.circular(RetivoxTheme.radiusButton),
        child: Container(
          padding: EdgeInsets.symmetric(horizontal: padH, vertical: padV),
          decoration: BoxDecoration(
            color: onPressed == null ? bg.withValues(alpha: 0.5) : bg,
            borderRadius: BorderRadius.circular(RetivoxTheme.radiusButton),
            border: borderSide != BorderSide.none ? Border.fromBorderSide(borderSide) : null,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              if (isLoading) ...[
                SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(fg),
                  ),
                ),
                const SizedBox(width: 8),
              ] else if (icon != null) ...[
                IconTheme(
                  data: IconThemeData(color: fg, size: dense ? 14 : 16),
                  child: icon!,
                ),
                const SizedBox(width: 6),
              ],
              Text(
                label,
                style: TextStyle(
                  fontSize: fontSize,
                  fontWeight: FontWeight.w600,
                  color: fg,
                  letterSpacing: 0.1,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
