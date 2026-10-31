// Mirrors frontend/src/api/client.js — same endpoints, same JSON shapes.
// The phone is a read-only viewer: detection runs on the campus server.
import 'dart:convert';
import 'package:http/http.dart' as http;

class Api {
  // LAN default. Editable in Settings — the laptop IP changes when you switch
  // networks, and rebuilding the APK to fix an IP is not a thing you want to do
  // on demo day.
  static String baseUrl = 'http://127.0.0.1:8010';

  static Future<dynamic> _get(String path) async {
    final res = await http
        .get(Uri.parse('$baseUrl$path'))
        .timeout(const Duration(seconds: 60));
    if (res.statusCode != 200) {
      throw Exception('GET $path failed: ${res.statusCode}');
    }
    return jsonDecode(res.body);
  }

  static Future<Campus> campus() async => Campus.fromJson(await _get('/api/campus'));

  static Future<List<AlertItem>> alerts({bool active = true}) async {
    final raw = await _get('/api/insights/alerts?active=$active') as List;
    return raw.map((e) => AlertItem.fromJson(e as Map<String, dynamic>)).toList();
  }

  static Future<List<Ticket>> tickets() async {
    final raw = await _get('/api/tickets') as List;
    return raw.map((e) => Ticket.fromJson(e as Map<String, dynamic>)).toList();
  }

  static Future<BuildingDetail> building(String id) async =>
      BuildingDetail.fromJson(await _get('/api/buildings/$id'));
}

// ------------------------------------------------------------------ models

class Building {
  final String id, name, status;
  final double powerKw, baselineKw, waterLpm;
  final int occupancy, activeAlerts, floors;
  final double x, z, w, d;

  Building.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        name = j['name'],
        status = j['status'] ?? 'ok',
        powerKw = (j['power_kw'] as num?)?.toDouble() ?? 0,
        baselineKw = (j['baseline_kw'] as num?)?.toDouble() ?? 0,
        waterLpm = (j['water_lpm'] as num?)?.toDouble() ?? 0,
        occupancy = (j['occupancy'] as num?)?.toInt() ?? 0,
        activeAlerts = (j['active_alerts'] as num?)?.toInt() ?? 0,
        floors = (j['floors'] as num?)?.toInt() ?? 0,
        x = (j['position']?['x'] as num?)?.toDouble() ?? 0,
        z = (j['position']?['z'] as num?)?.toDouble() ?? 0,
        w = (j['size']?['w'] as num?)?.toDouble() ?? 10,
        d = (j['size']?['d'] as num?)?.toDouble() ?? 10;

  /// Load vs baseline, matching the web app's colouring intent.
  double get loadRatio => baselineKw <= 0 ? 1 : powerKw / baselineKw;
}

class CampusTotals {
  final double powerKw, baselineKw, waterLpm;
  final int occupancy, activeAlerts, openTickets;

  CampusTotals.fromJson(Map<String, dynamic> j)
      : powerKw = (j['power_kw'] as num?)?.toDouble() ?? 0,
        baselineKw = (j['baseline_kw'] as num?)?.toDouble() ?? 0,
        waterLpm = (j['water_lpm'] as num?)?.toDouble() ?? 0,
        occupancy = (j['occupancy'] as num?)?.toInt() ?? 0,
        activeAlerts = (j['active_alerts'] as num?)?.toInt() ?? 0,
        openTickets = (j['open_tickets'] as num?)?.toInt() ?? 0;
}

class Campus {
  final List<Building> buildings;
  final CampusTotals totals;

  Campus.fromJson(Map<String, dynamic> j)
      : buildings = (j['buildings'] as List)
            .map((e) => Building.fromJson(e as Map<String, dynamic>))
            .toList(),
        totals = CampusTotals.fromJson(j['totals'] as Map<String, dynamic>);
}

class AlertItem {
  final String entityId, metric, kind, severity;
  final String? explanation, ticketId;
  final double actual, expected, ratio;
  final String ts;

  AlertItem.fromJson(Map<String, dynamic> j)
      : entityId = j['entity_id'] ?? '',
        metric = j['metric'] ?? '',
        kind = j['kind'] ?? '',
        severity = j['severity'] ?? 'medium',
        explanation = j['explanation'],
        ticketId = j['ticket_id'],
        actual = (j['actual'] as num?)?.toDouble() ?? 0,
        expected = (j['expected'] as num?)?.toDouble() ?? 0,
        ratio = (j['ratio'] as num?)?.toDouble() ?? 0,
        ts = j['ts'] ?? j['created_at'] ?? '';

  String get title => '$entityId · ${kind.replaceAll('_', ' ')}';
}

class Ticket {
  final String id, title, status, priority;
  final String? entityId, equipmentId, verification;

  Ticket.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        title = j['title'] ?? '',
        status = j['status'] ?? 'open',
        priority = j['priority'] ?? 'medium',
        entityId = j['entity_id'],
        equipmentId = j['equipment_id'],
        verification = j['verification']?.toString();
}

class RoomSummary {
  final String id, name, type, status;

  RoomSummary.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        name = j['name'] ?? j['id'],
        type = j['type'] ?? '',
        status = j['status'] ?? 'ok';
}

class FloorSummary {
  final String id;
  final int level;
  final List<RoomSummary> rooms;

  FloorSummary.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        level = (j['level'] as num?)?.toInt() ?? 0,
        rooms = (j['rooms'] as List? ?? [])
            .map((e) => RoomSummary.fromJson(e as Map<String, dynamic>))
            .toList();
}

class BuildingDetail {
  final String id, name, status;
  final List<FloorSummary> floors;

  BuildingDetail.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        name = j['name'] ?? j['id'],
        status = j['status'] ?? 'ok',
        floors = (j['floors'] as List? ?? [])
            .map((e) => FloorSummary.fromJson(e as Map<String, dynamic>))
            .toList();
}
