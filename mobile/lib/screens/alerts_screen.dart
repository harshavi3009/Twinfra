import 'package:flutter/material.dart';
import '../api.dart';
import '../theme.dart';

class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key});

  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  late Future<List<AlertItem>> _future;
  bool _activeOnly = true;

  @override
  void initState() {
    super.initState();
    _future = Api.alerts(active: _activeOnly);
  }

  void _load(bool activeOnly) {
    setState(() {
      _activeOnly = activeOnly;
      _future = Api.alerts(active: activeOnly);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
          child: Row(
            children: [
              _Tab(
                label: 'Active',
                selected: _activeOnly,
                onTap: () => _load(true),
              ),
              const SizedBox(width: 8),
              _Tab(
                label: 'History',
                selected: !_activeOnly,
                onTap: () => _load(false),
              ),
            ],
          ),
        ),
        Expanded(
          child: FutureBuilder<List<AlertItem>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return const Center(
                    child: CircularProgressIndicator(
                        color: T.accent, strokeWidth: 2));
              }
              if (snap.hasError) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text('Failed to load alerts\n${snap.error}',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 11, color: T.muted)),
                  ),
                );
              }
              final alerts = snap.data!;
              if (alerts.isEmpty) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.check_circle_outline,
                            color: T.ok, size: 36),
                        const SizedBox(height: 10),
                        Text(
                          _activeOnly
                              ? 'No active alerts.\nCampus is nominal.'
                              : 'No alert history yet.',
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: T.muted, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                );
              }
              return RefreshIndicator(
                onRefresh: () async => _load(_activeOnly),
                child: ListView.separated(
                  padding: const EdgeInsets.all(12),
                  itemCount: alerts.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (_, i) => _AlertCard(alert: alerts[i]),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _AlertCard extends StatelessWidget {
  const _AlertCard({required this.alert});
  final AlertItem alert;

  @override
  Widget build(BuildContext context) {
    final c = T.forSeverity(alert.severity);
    final over = alert.expected > 0 ? alert.actual - alert.expected : 0.0;
    return Card(
      child: Container(
        decoration: BoxDecoration(
          border: Border(left: BorderSide(color: c, width: 3)),
          borderRadius: BorderRadius.circular(12),
        ),
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: c.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(alert.severity.toUpperCase(),
                      style: TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                          color: c,
                          letterSpacing: 0.5)),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(alert.title,
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 13)),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (alert.explanation != null)
              Text(alert.explanation!,
                  style: const TextStyle(fontSize: 12, color: T.muted, height: 1.35)),
            const SizedBox(height: 8),
            Row(
              children: [
                Mono(
                  '${alert.actual.toStringAsFixed(1)} ${alert.metric}',
                  color: T.text,
                  size: 11,
                ),
                Mono(' vs ${alert.expected.toStringAsFixed(1)} expected'),
                const Spacer(),
                if (over > 0)
                  Mono('${alert.ratio.toStringAsFixed(2)}x', color: c, size: 11),
              ],
            ),
            if (alert.ticketId != null) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  const Icon(Icons.confirmation_num_outlined,
                      size: 12, color: T.muted),
                  const SizedBox(width: 4),
                  Mono(alert.ticketId!),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
          decoration: BoxDecoration(
            color: selected ? T.accent.withValues(alpha: 0.15) : T.panel,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
                color: selected ? T.accent.withValues(alpha: 0.5) : T.line),
          ),
          child: Text(label,
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: selected ? T.accent : T.muted)),
        ),
      );
}
