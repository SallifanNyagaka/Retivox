import 'package:flutter/material.dart';

import '../theme/retivox_theme.dart';

enum RetivoxBadgeVariant {
  success,
  warning,
  danger,
  muted,
  info,
  primary,
}

enum RetivoxBadgeSize {
  sm(fontSize: 10, padH: 6, padV: 2),
  md(fontSize: 11, padH: 8, padV: 3),
  lg(fontSize: 12, padH: 10, padV: 4);

  final double fontSize;
  final double padH;
  final double padV;
  const RetivoxBadgeSize({
    required this.fontSize,
    required this.padH,
    required this.padV,
  });
}

/// Reusable Badge component matching apps/web/components/ui/Badge.tsx.
class RetivoxBadge extends StatelessWidget {
  const RetivoxBadge({
    required this.label,
    this.variant = RetivoxBadgeVariant.muted,
    this.size = RetivoxBadgeSize.md,
    this.leading,
    super.key,
  });

  final String label;
  final RetivoxBadgeVariant variant;
  final RetivoxBadgeSize size;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    Color bg;
    Color fg;
    Color? border;

    switch (variant) {
      case RetivoxBadgeVariant.success:
        bg = isDark ? RetivoxTheme.successDark : RetivoxTheme.successLight;
        fg = isDark ? const Color(0xFF34D399) : const Color(0xFF047857);
        border = isDark ? const Color(0xFF065F46) : const Color(0xFFA7F3D0);
      case RetivoxBadgeVariant.warning:
        bg = isDark ? RetivoxTheme.accentDark : RetivoxTheme.accentLight;
        fg = isDark ? const Color(0xFFFBBF24) : const Color(0xFFB45309);
        border = isDark ? const Color(0xFF92400E) : const Color(0xFFFDE68A);
      case RetivoxBadgeVariant.danger:
        bg = isDark ? RetivoxTheme.dangerDark : RetivoxTheme.dangerLight;
        fg = isDark ? const Color(0xFFF87171) : const Color(0xFFB91C1C);
        border = isDark ? const Color(0xFF991B1B) : const Color(0xFFFECACA);
      case RetivoxBadgeVariant.info:
      case RetivoxBadgeVariant.primary:
        bg = isDark ? RetivoxTheme.successDark : RetivoxTheme.primaryLight;
        fg = isDark ? RetivoxTheme.primaryDarkMode : RetivoxTheme.primaryLightMode;
        border = isDark ? RetivoxTheme.primaryDarkMode.withValues(alpha: 0.3) : const Color(0xFFA7F3D0);
      case RetivoxBadgeVariant.muted:
        bg = isDark ? RetivoxTheme.surfaceDark : RetivoxTheme.backgroundLight;
        fg = isDark ? RetivoxTheme.textMutedDark : RetivoxTheme.textMutedLight;
        border = isDark ? RetivoxTheme.borderDark : RetivoxTheme.borderLight;
    }

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: size.padH,
        vertical: size.padV,
      ),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(RetivoxTheme.radiusBadge),
        border: Border.all(color: border, width: 1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          if (leading != null) ...[
            leading!,
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: size.fontSize,
              fontWeight: FontWeight.w600,
              color: fg,
              height: 1.2,
            ),
          ),
        ],
      ),
    );
  }
}
