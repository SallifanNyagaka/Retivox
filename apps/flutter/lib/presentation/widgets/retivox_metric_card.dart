import 'package:flutter/material.dart';

import '../theme/retivox_theme.dart';
import 'retivox_card.dart';

enum RetivoxDeltaType { up, down, neutral }

/// MetricCard component matching apps/web/components/dashboard/MetricCard.tsx.
class RetivoxMetricCard extends StatelessWidget {
  const RetivoxMetricCard({
    required this.label,
    required this.value,
    this.delta,
    this.deltaType = RetivoxDeltaType.neutral,
    this.icon,
    this.accentColor,
    this.valueColor,
    super.key,
  });

  final String label;
  final String value;
  final String? delta;
  final RetivoxDeltaType deltaType;
  final Widget? icon;
  final Color? accentColor;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final normalizedLabel = label.toLowerCase();
    final tone = accentColor ?? _toneFor(normalizedLabel);
    final displayIcon = icon ?? Icon(_iconFor(normalizedLabel), size: 17);

    final defaultTextColor = isDark
        ? RetivoxTheme.textPrimaryDark
        : RetivoxTheme.textPrimaryLight;
    final mutedColor = isDark
        ? RetivoxTheme.textMutedDark
        : RetivoxTheme.textMutedLight;

    Color deltaColor;
    String prefix = '';
    switch (deltaType) {
      case RetivoxDeltaType.up:
        deltaColor = isDark ? const Color(0xFF34D399) : RetivoxTheme.success;
        prefix = '↑ ';
      case RetivoxDeltaType.down:
        deltaColor = isDark ? const Color(0xFFF87171) : RetivoxTheme.danger;
        prefix = '↓ ';
      case RetivoxDeltaType.neutral:
        deltaColor = mutedColor;
    }

    return RetivoxCard(
      padding: RetivoxCardPadding.sm,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: mutedColor,
                  ),
                ),
              ),
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: tone.withValues(alpha: isDark ? 0.2 : 0.12),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: tone.withValues(alpha: 0.45)),
                ),
                alignment: Alignment.center,
                child: IconTheme.merge(
                  data: IconThemeData(color: tone),
                  child: displayIcon,
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 19,
              fontWeight: FontWeight.w700,
              color: valueColor ?? defaultTextColor,
              letterSpacing: -0.5,
            ),
          ),
          if (delta != null) ...[
            const SizedBox(height: 6),
            Text(
              '$prefix$delta',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: deltaColor,
              ),
            ),
          ],
        ],
      ),
    );
  }

  static Color _toneFor(String label) {
    if (label.contains('loss') ||
        label.contains('alert') ||
        label.contains('overdue')) {
      return RetivoxTheme.danger;
    }
    if (label.contains('profit') ||
        label.contains('cash') ||
        label.contains('sale')) {
      return RetivoxTheme.success;
    }
    if (label.contains('lent') ||
        label.contains('mpesa') ||
        label.contains('pending')) {
      return RetivoxTheme.accent;
    }
    if (label.contains('stock') || label.contains('product')) {
      return const Color(0xFF7C3AED);
    }
    return const Color(0xFF2563EB);
  }

  static IconData _iconFor(String label) {
    if (label.contains('loss') ||
        label.contains('alert') ||
        label.contains('overdue')) {
      return Icons.warning_amber_rounded;
    }
    if (label.contains('profit')) return Icons.trending_up_rounded;
    if (label.contains('cash') ||
        label.contains('payment') ||
        label.contains('sale')) {
      return Icons.payments_outlined;
    }
    if (label.contains('lent') || label.contains('balance')) {
      return Icons.account_balance_wallet_outlined;
    }
    if (label.contains('stock') || label.contains('product')) {
      return Icons.inventory_2_outlined;
    }
    if (label.contains('transaction')) return Icons.receipt_long_outlined;
    if (label.contains('employee') || label.contains('admin'))
      return Icons.person_outline_rounded;
    if (label.contains('branch') || label.contains('store'))
      return Icons.storefront_outlined;
    return Icons.analytics_outlined;
  }
}
