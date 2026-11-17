import 'package:flutter/material.dart';
import 'dart:io';

class RetivoxTheme {
  static ThemeData lightTheme = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    primaryColor: Color(0xFF0F7B5A),
    primaryColorLight: Color(0xFFD1FAE5),
    primaryColorDark: Color(0xFF1DB37A),
    scaffoldBackgroundColor: Color(0xFFF8FAFC),
  );
  static ThemeData darkTheme = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    primaryColor: Color(0xFF1DB37A),
    primaryColorLight: Color(0xFF064E3B),
    primaryColorDark: Color(0xFF0F7B5A),
    scaffoldBackgroundColor: Color(0xFF0F172A),
  );
}