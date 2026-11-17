import 'package:flutter/material.dart';

import '../theme/retivox_theme.dart';

/// RoleBadge matching RoleBadge in apps/web/app/dashboard/layout.tsx.
class RetivoxRoleBadge extends StatelessWidget {
  const RetivoxRoleBadge({
    required this.role,
    super.key,
  });

  final String role;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final r = role.toLowerCase();

    Color bgColor;
    Color textColor;

    if (r == 'owner') {
      bgColor = isDark ? const Color(0xFF065F46) : RetivoxTheme.success;
      textColor = Colors.white;
    } else if (r == 'admin') {
      bgColor = isDark ? const Color(0xFF92400E) : RetivoxTheme.accent;
      textColor = Colors.white;
    } else {
      bgColor = isDark ? RetivoxTheme.borderDark : RetivoxTheme.borderLight;
      textColor = isDark ? RetivoxTheme.textMutedDark : RetivoxTheme.textMutedLight;
    }

    final label = role.isNotEmpty
        ? role[0].toUpperCase() + role.substring(1)
        : 'Employee';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2.5),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(RetivoxTheme.radiusBadge),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w500,
          color: textColor,
          height: 1.2,
        ),
      ),
    );
  }
}
