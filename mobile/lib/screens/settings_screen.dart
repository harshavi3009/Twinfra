import 'package:flutter/material.dart';
import '../api.dart';
import '../theme.dart';
import '../notifier.dart';

/// Server URL is editable and persisted, because the address changes between
/// networks and rebuilding an APK to fix an IP is not something you want to do
/// on demo day.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _url =
      TextEditingController(text: Api.baseUrl);
  String _status = '';
  Color _statusColor = T.muted;

  Future<void> _test() async {
    setState(() {
      _status = 'Checking…';
      _statusColor = T.muted;
    });
    final saved = Api.baseUrl;
    Api.baseUrl = _url.text.trim().replaceAll(RegExp(r'/+$'), '');
    try {
      final campus = await Api.campus();
      // Persist only after a successful check, so a typo can't leave the app
      // pointing at a dead host on next launch.
      await Api.saveBaseUrl(_url.text);
      setState(() {
        _status = 'Connected · ${campus.buildings.length} buildings, '
            '${campus.totals.openTickets} open tickets';
        _statusColor = T.ok;
      });
    } catch (e) {
      Api.baseUrl = saved;
      setState(() {
        _status = 'Failed: $e';
        _statusColor = T.critical;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Campus server',
                    style:
                        TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                const SizedBox(height: 4),
                const Text(
                  'The FastAPI instance on the campus network. Detection and '
                  'verification run there; this phone only reads.',
                  style: TextStyle(fontSize: 11, color: T.muted, height: 1.35),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _url,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                  decoration: InputDecoration(
                    isDense: true,
                    hintText: 'http://192.168.1.63:8010',
                    filled: true,
                    fillColor: T.panel2,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: const BorderSide(color: T.line),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: const BorderSide(color: T.line),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _test,
                    style: FilledButton.styleFrom(backgroundColor: T.accent),
                    child: const Text('Save & test',
                        style: TextStyle(color: T.bg)),
                  ),
                ),
                if (_status.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(_status,
                      style: TextStyle(fontSize: 11, color: _statusColor)),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Notifications',
                    style:
                        TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                const SizedBox(height: 8),
                const Text(
                  'Alerts are delivered as local notifications while the app is '
                  'running — the app polls every 30s and notifies on anything '
                  'new. Alerts do not arrive while the app is closed.',
                  style: TextStyle(fontSize: 11, color: T.muted, height: 1.4),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () async {
                    await AlertNotifier.init();
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Permission requested')),
                    );
                  },
                  icon: const Icon(Icons.notifications_active_outlined,
                      size: 16, color: T.accent),
                  label: const Text('Re-request permission',
                      style: TextStyle(fontSize: 12, color: T.accent)),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: T.line),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 4),
          child: Text(
            'Twinfra · Campus Digital Twin\n'
            'Read-only viewer for guards and staff.',
            style: TextStyle(fontSize: 10, color: T.muted, height: 1.5),
          ),
        ),
      ],
    );
  }
}
