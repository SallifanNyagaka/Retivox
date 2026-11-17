import 'package:flutter/material.dart';

import '../theme/retivox_theme.dart';

enum RetivoxCardPadding {
  none(0),
  sm(12),
  md(16),
  lg(24);

  final double value;
  const RetivoxCardPadding(this.value);
}

/// Reusable card component matching apps/web/components/ui/Card.tsx.
class RetivoxCard extends StatelessWidget {
  const RetivoxCard({
    required this.child,
    this.padding = RetivoxCardPadding.md,
    this.hoverable = false,
    this.backgroundColor,
    this.borderColor,
    super.key,
  });

  final Widget child;
  final RetivoxCardPadding padding;
  final bool hoverable;
  final Color? backgroundColor;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final surface = backgroundColor ?? (isDark ? RetivoxTheme.surfaceDark : RetivoxTheme.surfaceLight);
    final border = borderColor ?? (isDark ? RetivoxTheme.borderDark : RetivoxTheme.borderLight);

    return Container(
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(RetivoxTheme.radiusCard),
        border: Border.all(color: border),
        boxShadow: isDark ? null : RetivoxTheme.cardShadow,
      ),
      padding: EdgeInsets.all(padding.value),
      child: child,
    );
  }
}

/// CardHeader matching apps/web/components/ui/Card.tsx CardHeader.
class RetivoxCardHeader extends StatelessWidget {
  const RetivoxCardHeader({
    required this.title,
    this.action,
    this.subtitle,
    super.key,
  });

  final String title;
  final Widget? action;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final textColor = isDark ? RetivoxTheme.textPrimaryDark : RetivoxTheme.textPrimaryLight;
    final mutedColor = isDark ? RetivoxTheme.textMutedDark : RetivoxTheme.textMutedLight;

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: textColor,
                    letterSpacing: -0.2,
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: TextStyle(
                      fontSize: 12,
                      color: mutedColor,
                    ),
                  ),
                ],
              ],
            ),
          ),
          ?action,
        ],
      ),
    );
  }
}
