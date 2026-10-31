import 'package:flutter/material.dart';
import '../api.dart';
import '../theme.dart';

/// Floors → rooms drill-down. The web shows this inside the 3D scene; on a
/// phone a typed list is faster to read and works offline-ish.
class BuildingDetailScreen extends StatefulWidget {
  const BuildingDetailScreen({super.key, required this.id, required this.name});
  final String id, name;

  @override
  State<BuildingDetailScreen> createState() => _BuildingDetailScreenState();
}

class _BuildingDetailScreenState extends State<BuildingDetailScreen> {
  late Future<BuildingDetail> _future;

  @override
  void initState() {
    super.initState();
    _future = Api.building(widget.id);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.name)),
      body: FutureBuilder<BuildingDetail>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(
                child: CircularProgressIndicator(color: T.accent, strokeWidth: 2));
          }
          if (snap.hasError) {
            return Center(
              child: Text('Failed: ${snap.error}',
                  style: const TextStyle(color: T.muted, fontSize: 12)),
            );
          }
          final b = snap.data!;
          return ListView(
            padding: const EdgeInsets.all(12),
            children: [
              for (final f in b.floors)
                Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  child: Theme(
                    data: Theme.of(context)
                        .copyWith(dividerColor: Colors.transparent),
                    child: ExpansionTile(
                      tilePadding: const EdgeInsets.symmetric(horizontal: 14),
                      title: Text('Floor ${f.level}',
                          style: const TextStyle(
                              fontWeight: FontWeight.w700, fontSize: 14)),
                      subtitle: Mono('${f.rooms.length} rooms'),
                      children: [
                        for (final r in f.rooms)
                          ListTile(
                            dense: true,
                            title: Text(r.name,
                                style: const TextStyle(fontSize: 13)),
                            subtitle: Text(r.type,
                                style: const TextStyle(
                                    fontSize: 10, color: T.muted)),
                            trailing: Container(
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(
                                color: T.forStatus(r.status),
                                shape: BoxShape.circle,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
