import 'package:flutter/material.dart';

// Design tokens copied from frontend/src/index.css so the app reads as the
// same product: "dark campus control room".
class T {
  static const bg = Color(0xFF0B1220);
  static const panel = Color(0xFF111A2E);
  static const panel2 = Color(0xFF16223B);
  static const line = Color(0xFF22304D);
  static const text = Color(0xFFE6EDF7);
  static const muted = Color(0xFF8EA0BD);
  static const accent = Color(0xFF22D3EE);
  static const ok = Color(0xFF22C55E);
  static const warning = Color(0xFFF59E0B);
  static const critical = Color(0xFFEF4444);
  static const offline = Color(0xFF64748B);

  static Color forStatus(String s) => switch (s) {
        'ok' => ok,
        'warning' => warning,
        'critical' => critical,
        'offline' => offline,
        _ => muted,
      };

  static Color forSeverity(String s) => switch (s) {
        'critical' => critical,
        'high' => warning,
        'medium' => accent,
        _ => muted,
      };

  static ThemeData theme() {
    final base = ThemeData.dark(useMaterial3: true);
    return base.copyWith(
      scaffoldBackgroundColor: bg,
      colorScheme: base.colorScheme.copyWith(
        primary: accent,
        surface: panel,
        error: critical,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: bg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: text,
          fontSize: 18,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.2,
        ),
      ),
      cardTheme: CardThemeData(
        color: panel,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: line),
        ),
      ),
      textTheme: base.textTheme.apply(
        bodyColor: text,
        displayColor: text,
      ),
    );
  }
}

/// Small monospace label, used for ids and units — matches the web's font-mono.
class Mono extends StatelessWidget {
  const Mono(this.text, {super.key, this.color, this.size = 11});
  final String text;
  final Color? color;
  final double size;

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: TextStyle(
          fontFamily: 'monospace',
          fontSize: size,
          color: color ?? T.muted,
        ),
      );
}
