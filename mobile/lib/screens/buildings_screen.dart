import 'package:flutter/material.dart';
import '../api.dart';
import '../theme.dart';
import 'building_detail_screen.dart';

class BuildingsScreen extends StatefulWidget {
  const BuildingsScreen({super.key});

  @override
  State<BuildingsScreen> createState() => _BuildingsScreenState();
}

class _BuildingsScreenState extends State<BuildingsScreen> {
  late Future<Campus> _future;

  @override
  void initState() {
    super.initState();
    _future = Api.campus();
  }

  void _reload() => setState(() => _future = Api.campus());

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Campus>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const _Loading();
        }
        if (snap.hasError) {
          return _ErrorView(error: snap.error!, onRetry: _reload);
        }
        final campus = snap.data!;
        return RefreshIndicator(
          onRefresh: () async => _reload(),
          child: ListView(
            padding: const EdgeInsets.all(12),
            children: [
              _TotalsCard(totals: campus.totals),
              const SizedBox(height: 12),
              for (final b in campus.buildings) ...[
                _BuildingTile(building: b),
                const SizedBox(height: 10),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _TotalsCard extends StatelessWidget {
  const _TotalsCard({required this.totals});
  final CampusTotals totals;

  @override
  Widget build(BuildContext context) {
    final over = totals.baselineKw > 0 && totals.powerKw > totals.baselineKw * 1.1;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Text('Campus right now',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                const Spacer(),
                if (totals.activeAlerts > 0)
                  _Pill(
                    '${totals.activeAlerts} alerts',
                    T.critical,
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                _Stat(
                  '${totals.powerKw.toStringAsFixed(0)} kW',
                  'power',
                  over ? T.warning : T.text,
                ),
                _Stat('${totals.waterLpm.toStringAsFixed(0)}',
                    'water L/min', T.text),
                _Stat('${totals.occupancy}', 'people', T.text),
                _Stat('${totals.openTickets}', 'tickets', T.text),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.value, this.label, this.color);
  final String value, label;
  final Color color;

  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(value,
                style: TextStyle(
                    fontSize: 17, fontWeight: FontWeight.w700, color: color)),
            const SizedBox(height: 2),
            Text(label, style: const TextStyle(fontSize: 10, color: T.muted)),
          ],
        ),
      );
}

class _BuildingTile extends StatelessWidget {
  const _BuildingTile({required this.building});
  final Building building;

  @override
  Widget build(BuildContext context) {
    final c = T.forStatus(building.status);
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => BuildingDetailScreen(id: building.id, name: building.name),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(color: c, shape: BoxShape.circle),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(building.name,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, fontSize: 15)),
                  ),
                  Mono(building.id),
                  const SizedBox(width: 4),
                  const Icon(Icons.chevron_right, size: 18, color: T.muted),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  _Stat('${building.powerKw.toStringAsFixed(1)} kW', 'power',
                      building.loadRatio > 1.1 ? T.warning : T.text),
                  _Stat('${building.baselineKw.toStringAsFixed(1)}', 'baseline', T.muted),
                  _Stat('${building.occupancy}', 'people', T.text),
                  _Stat('${building.floors}F', 'floors', T.muted),
                ],
              ),
              if (building.activeAlerts > 0) ...[
                const SizedBox(height: 8),
                _Pill('${building.activeAlerts} active alerts', T.critical),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill(this.text, this.color);
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Text(text,
            style: TextStyle(
                fontSize: 10, fontWeight: FontWeight.w600, color: color)),
      );
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) => const Center(
        child: CircularProgressIndicator(color: T.accent, strokeWidth: 2),
      );
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.cloud_off, color: T.critical, size: 36),
              const SizedBox(height: 12),
              const Text('Could not reach the campus server',
                  style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              Text('$error',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 11, color: T.muted)),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: onRetry,
                style: FilledButton.styleFrom(backgroundColor: T.accent),
                child: const Text('Retry', style: TextStyle(color: T.bg)),
              ),
            ],
          ),
        ),
      );
}
