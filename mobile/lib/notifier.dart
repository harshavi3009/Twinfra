// Local notifications for new alerts.
//
// Scope, stated honestly: these are LOCAL notifications. They fire from a
// Timer in this app, so they only arrive while the app is running (foreground,
// or briefly backgrounded before Android kills it). Closing the app stops
// them. Real push-while-closed needs FCM, which is a later add-on.
import 'dart:async';
import 'package:flutter/material.dart' show Color;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'api.dart';

class AlertNotifier {
  static final _plugin = FlutterLocalNotificationsPlugin();
  static Timer? _timer;
  static final _seen = <String>{};
  static bool _first = true;

  static Future<void> init() async {
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    await _plugin.initialize(
      settings: const InitializationSettings(android: android),
    );

    // Android 13+ requires the runtime POST_NOTIFICATIONS permission.
    await _plugin
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.requestNotificationsPermission();
  }

  /// Poll the alerts endpoint and notify for anything we haven't seen.
  /// The first poll only records a baseline — otherwise the app would fire a
  /// notification for every historical alert on launch.
  static void start({Duration every = const Duration(seconds: 30)}) {
    _timer?.cancel();
    _timer = Timer.periodic(every, (_) => _poll());
    _poll();
  }

  static void stop() => _timer?.cancel();

  static Future<void> _poll() async {
    List<AlertItem> alerts;
    try {
      alerts = await Api.alerts();
    } catch (_) {
      return; // network hiccup — try again next tick
    }

    final keys = alerts.map((a) => '${a.entityId}|${a.kind}|${a.ts}').toList();

    if (_first) {
      _seen.addAll(keys);
      _first = false;
      return;
    }

    for (var i = 0; i < alerts.length; i++) {
      if (_seen.contains(keys[i])) continue;
      _seen.add(keys[i]);
      await _show(alerts[i]);
    }
  }

  static Future<void> _show(AlertItem a) async {
    final important = a.severity == 'critical' || a.severity == 'high';
    await _plugin.show(
      id: a.ts.hashCode & 0x7fffffff,
      title: '${a.severity.toUpperCase()} · ${a.title}',
      body: a.explanation ??
          '${a.actual.toStringAsFixed(1)} vs '
              '${a.expected.toStringAsFixed(1)} expected '
              '(${a.ratio.toStringAsFixed(2)}x)',
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          important ? 'alerts_high' : 'alerts_normal',
          important ? 'Critical alerts' : 'Alerts',
          channelDescription: 'Campus anomaly alerts',
          importance: important ? Importance.max : Importance.defaultImportance,
          priority: important ? Priority.high : Priority.defaultPriority,
          color: important ? const Color(0xFFEF4444) : const Color(0xFF22D3EE),
        ),
      ),
    );
  }
}
